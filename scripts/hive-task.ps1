<#
.SYNOPSIS
  Start an Azure Boards task the HiveCFM way: branch name, branch, commit template, PR draft.

.DESCRIPTION
  Run from inside a HiveCFM repo checkout (hivecfm-core, hivecfm-hub, hivecfm-dev-hub).
    1. Checks the origin remote is reachable with your credential (git ls-remote).
    2. Reads the work item (Azure DevOps REST via your az login, or AZURE_DEVOPS_EXT_PAT)
       -> type + title + area. -Type/-Title/-Scope override it, so it works offline.
    3. Generates <type>/<ticket>-<2-5-word-desc> and validates it against the team rules.
    4. Refuses on uncommitted tracked changes, an existing branch, or a non-development base.
    5. Fetches origin/<base> and creates the branch from it (no upstream tracking).
    6. Writes a commit template, PR title and PR description under $(git rev-parse --git-path hive-task).
  It NEVER pushes and NEVER opens a pull request.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File hive-task.ps1 4821 -Scope sso
  powershell -NoProfile -ExecutionPolicy Bypass -File hive-task.ps1 4821 -Type fix -Title "Expire card shows wrong date" -Scope nps -WhatIf
  powershell -NoProfile -ExecutionPolicy Bypass -File hive-task.ps1 noref -Type chore -Title "Drop tracked migrations folder" -Scope db
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory, Position = 0)][ValidatePattern('^([0-9]+|noref)$')][string]$WorkItem,
  [ValidateSet('feat', 'fix', 'hotfix', 'chore', 'refactor', 'docs', 'test', 'ci', 'release')][string]$Type,
  [string]$Title,
  [string]$Desc,          # explicit 2-5 word kebab description; overrides the title-derived slug
  [string]$Scope,         # commit scope (sso, migrator, bot-connector, contacts, db, nps, ...)
  [string]$Base,          # base branch; default: development if origin has it, else origin HEAD
  [switch]$AllowNonDevelopmentBase,
  [string]$Org,           # Azure DevOps org URL; default: derived from the origin URL
  [string]$Project        # Azure DevOps project; default: derived from the origin URL
)

# 'Continue', not 'Stop': under PS 5.1, 'Stop' turns ANY native stderr line (even with
# 2>$null) into a terminating error. Every native call below checks $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
Import-Module (Join-Path $PSScriptRoot 'HiveTask.psm1') -Force -ErrorAction Stop

function Stop-Task([string]$What, [string]$Cause, [string]$Next) {
  Write-Host ''
  Write-Host "FAILED: $What" -ForegroundColor Red
  Write-Host "  cause: $Cause"
  Write-Host "  next:  $Next"
  exit 1
}

function Write-Note([string]$Text) { Write-Host "NOTE: $Text" -ForegroundColor Yellow }

function Invoke-Git {
  # Runs git, returns output lines as strings; throws a self-describing error on non-zero exit.
  param([Parameter(ValueFromRemainingArguments)][string[]]$GitArgs)
  $out = & git @GitArgs 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') -> exit $LASTEXITCODE`n$($out -join "`n")" }
  return $out
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  # PS 5.1 Set-Content -Encoding utf8 writes a BOM, which git would keep in the message.
  [System.IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))
}

function Get-WorkItemFields([string]$Id) {
  # REST, not 'az boards': az pipes ANSI (cp1252) text that PS 5.1 decodes as OEM, which
  # garbles non-ASCII titles and cannot carry Arabic at all. Invoke-RestMethod reads UTF-8.
  $headers = $null
  if ($env:AZURE_DEVOPS_EXT_PAT) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$($env:AZURE_DEVOPS_EXT_PAT)"))
    $headers = @{ Authorization = "Basic $b64" }
  } elseif (Get-Command az -ErrorAction SilentlyContinue) {
    # 499b84ac-... is the fixed Azure DevOps resource id.
    $token = & az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $token) { $headers = @{ Authorization = "Bearer $token" } }
  }
  if (-not $headers -or -not $Org) { return $null }
  try {
    $uri = "$($Org.TrimEnd('/'))/_apis/wit/workitems/${Id}?fields=System.WorkItemType,System.Title,System.AreaPath,System.Tags&api-version=7.0"
    return (Invoke-RestMethod -Uri $uri -Headers $headers -UseBasicParsing -ErrorAction Stop).fields
  } catch { Write-Note "work item AB#$Id lookup failed: $($_.Exception.Message)"; return $null }
}

# Normalise case once into plain variables (validated params throw on reassignment,
# and ValidateSet/ValidatePattern accept FIX / NOREF case-insensitively).
$ticket = $WorkItem.ToLowerInvariant()
$resolvedType = if ($Type) { $Type.ToLowerInvariant() } else { $null }

# --- 1. repo + remote --------------------------------------------------------
$top = & git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0) { Stop-Task 'not inside a git repo' "cwd = $(Get-Location)" 'cd into your hivecfm-core / hivecfm-hub / hivecfm-dev-hub checkout and re-run' }
$gitVer = ((& git --version) -replace '^\D*(\d+)\.(\d+).*$', '$1.$2').Split('.')
if ([int]$gitVer[0] -lt 2 -or ([int]$gitVer[0] -eq 2 -and [int]$gitVer[1] -lt 31)) { Stop-Task 'git too old' "git $($gitVer -join '.')" 'install Git 2.31 or newer' }
$remote = (& git remote get-url origin 2>$null)
if (-not $remote) { Stop-Task 'no origin remote' "repo $top has no 'origin'" 'git remote add origin <Azure DevOps clone URL>' }
if ($remote -match '://[^/@]+:[^/@]+@') { Write-Note 'origin URL embeds a credential (PAT). Move it to a credential helper - see team guide.' }
$heads = @(& git ls-remote --heads origin 2>&1 | ForEach-Object { "$_" })
if ($LASTEXITCODE -ne 0) {
  $why = @($heads | Where-Object { $_ -match '^(fatal|error|remote):' } | Select-Object -First 1)
  if (-not $why) { $why = $heads -join ' ' }
  Stop-Task "cannot reach origin ($($remote -replace '://[^@/]+@', '://***@'))" "$why" 'check the origin URL, then refresh your Azure DevOps PAT / Git Credential Manager login and re-run'
}
# Org + project from the origin URL (https://dev.azure.com/<org>/<project>/_git/<repo>,
# git@ssh.dev.azure.com:v3/<org>/<project>/<repo>, https://<org>.visualstudio.com/<project>/_git/<repo>).
$p = $null
if ($remote -match 'dev\.azure\.com[:/](?:v3/)?([^/]+)/([^/]+)/') { $p = @("https://dev.azure.com/$($Matches[1])", $Matches[2]) }
elseif ($remote -match '://(?:[^@/]+@)?([^./]+)\.visualstudio\.com/(?:DefaultCollection/)?([^/]+)/_git/') { $p = @("https://$($Matches[1]).visualstudio.com", $Matches[2]) }
if (-not $Org -and $p) { $Org = $p[0] }
if (-not $Project -and $p) { $Project = [uri]::UnescapeDataString($p[1]) }

$remoteBranches = @($heads | Where-Object { $_ -match "`t" } | ForEach-Object { ($_ -split "`t")[1] -replace '^refs/heads/', '' })

# --- 2. base branch ----------------------------------------------------------
$hasDevelopment = $remoteBranches -contains 'development'
if (-not $Base) {
  if ($hasDevelopment) { $Base = 'development' }
  else {
    $sym = & git ls-remote --symref origin HEAD 2>$null | Select-Object -First 1
    if ($sym -match 'refs/heads/(\S+)') { $Base = $Matches[1]; Write-Note "origin has no 'development'; using its default branch '$Base'." }
    else { Stop-Task 'cannot detect base branch' 'origin has no development branch and no HEAD symref' 'pass -Base <branch>' }
  }
}
if ($remoteBranches -notcontains $Base) { Stop-Task "base '$Base' not on origin" "remote branches do not include $Base" 'pass -Base <existing branch>' }
if ($hasDevelopment -and $Base -ne 'development' -and -not $AllowNonDevelopmentBase) {
  Stop-Task "base '$Base' is not the integration branch" 'task branches are cut from development' 'drop -Base (defaults to development); add -AllowNonDevelopmentBase only if your lead asked for it'
}

# --- 3. work item -> type + title + scope ------------------------------------
$wiType = $null; $tags = @()
if ($ticket -ne 'noref' -and (-not $resolvedType -or -not $Title -or -not $Scope)) {
  $f = Get-WorkItemFields $ticket
  if ($f) {
    $wiType = $f.'System.WorkItemType'
    if (-not $Title) { $Title = $f.'System.Title' }
    if ($f.'System.Tags') { $tags = @($f.'System.Tags' -split ';\s*' | ForEach-Object { $_.Trim().ToLowerInvariant() }) }
    if (-not $Scope -and $f.'System.AreaPath') {
      $area = ((($f.'System.AreaPath' -split '\\')[-1]).ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
      if ((Get-HiveKnownScopes) -contains $area) { $Scope = $area }
    }
    Write-Host "Work item AB#${ticket}: [$wiType] $Title"
  } else {
    $hint = if ($Org) { "run 'az login', or set AZURE_DEVOPS_EXT_PAT" } else { 'origin is not an Azure DevOps URL; pass -Org' }
    Write-Note "could not read AB#$ticket ($hint). Falling back to -Type/-Title."
  }
}
if (-not $resolvedType) { $resolvedType = Get-HiveTypeFromWorkItem -WorkItemType $wiType -Tags $tags }
if (-not $resolvedType) {
  Stop-Task 'cannot decide the branch type' "work item type '$wiType' does not imply one" "re-run with -Type <$((Get-HiveTypes) -join '|')>"
}
if (-not $Desc -and -not $Title) { Stop-Task 'no description' 'no -Title/-Desc and the work item could not be read' 're-run with -Title "<short summary>" or -Desc <two-to-five-words>' }
if (-not $Scope) { Stop-Task 'no commit scope' 'no -Scope given and the work item area is not a known module' "re-run with -Scope <module>, e.g. $((Get-HiveKnownScopes) -join ', ')" }

# --- 4. branch name ----------------------------------------------------------
$slug = if ($Desc) { $Desc.ToLowerInvariant() } else { ConvertTo-HiveSlug -Text $Title }
if (-not $slug) { Stop-Task 'title too short for a 2-5 word description' "title: '$Title'" 're-run with -Desc <two-to-five-words>' }
$branch = New-HiveBranchName -Type $resolvedType -Ticket $ticket -Slug $slug
$violations = Test-HiveBranchName -Name $branch
if ($violations.Count -gt 0) { Stop-Task "branch name '$branch' breaks the rules" ($violations -join '; ') 'fix -Desc / -Type and re-run' }
if ($branch -match '^(.+)-v[0-9]+$') {
  $stem = $Matches[1]
  if (($remoteBranches -contains $stem) -or (& git branch --list $stem)) {
    Stop-Task "'$branch' re-cuts existing branch '$stem'" 'never re-cut a branch as -vN' "git switch $stem and rebase it on origin/$Base"
  }
}
$summary = if ($Title) { $Title } else { $slug -replace '-', ' ' }
$subject = New-HiveCommitSubject -Type $resolvedType -Scope $Scope -Summary $summary

# --- 5. safety checks --------------------------------------------------------
if (& git status --porcelain --untracked-files=no) { Stop-Task 'uncommitted tracked changes' 'they would ride into the new branch' 'commit them on their own branch (or a WIP commit), then re-run' }
if (& git status --porcelain) { Write-Note 'untracked files present; they stay in the working tree and are not part of the new branch until you add them.' }
& git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0 -or $remoteBranches -contains $branch) {
  Stop-Task "branch '$branch' already exists" 'one branch per task; never re-cut as -v2' "git switch $branch   (and rebase it on origin/$Base if needed)"
}

# --- 6. create branch + drafts ----------------------------------------------
try { $draftDir = [string](Invoke-Git rev-parse --path-format=absolute --git-path hive-task) }
catch { Stop-Task 'cannot locate the git dir' $_.Exception.Message 'run from inside the repo checkout' }
$key = $branch -replace '/', '__'
$tplPath = Join-Path $draftDir "$key.commit.txt"
$titlePath = Join-Path $draftDir "$key.pr-title.txt"
$prPath = Join-Path $draftDir "$key.pr.md"

Write-Host ''
Write-Host "  branch : $branch"
Write-Host "  base   : origin/$Base"
Write-Host "  commit : $subject"

if ($PSCmdlet.ShouldProcess("$top", "fetch origin/$Base and create $branch from it")) {
  try {
    # Explicit refspec: a single-branch clone's default refspec would only write FETCH_HEAD.
    Invoke-Git fetch origin "+refs/heads/${Base}:refs/remotes/origin/${Base}" | Out-Null
    # --no-track: a bare 'git push' must never target the base branch.
    Invoke-Git switch --no-track -c $branch "origin/$Base" | Out-Null
  } catch { Stop-Task 'git branch creation failed' $_.Exception.Message 'read the git error above; nothing was pushed' }

  New-Item -ItemType Directory -Force -Path $draftDir | Out-Null
  Write-Utf8NoBom $tplPath (New-HiveCommitTemplate -Subject $subject -Ticket $ticket)
  Write-Utf8NoBom $titlePath $subject
  Write-Utf8NoBom $prPath (New-HivePrDraft -Ticket $ticket -Branch $branch -Base $Base -WorkItemTitle $Title)

  $wi = if ($ticket -eq 'noref') { '' } else { " --work-items $ticket" }
  Write-Host ''
  Write-Host 'Ready. Next:' -ForegroundColor Green
  Write-Host "  commit  : git commit -e -F `"$tplPath`""
  Write-Host "  push    : git push -u origin $branch"
  Write-Host "  PR (only when asked; target = $Base):"
  $orgArg = if ($Org) { $Org } else { '<org-url>' }
  $projArg = if ($Project) { $Project } else { '<project>' }
  Write-Host "    az repos pr create --org $orgArg --project `"$projArg`" --source-branch $branch --target-branch $Base --title `"$subject`" --description `"@$prPath`" --squash true --delete-source-branch true$wi"
}
