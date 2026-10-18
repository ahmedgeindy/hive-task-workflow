# HiveTask.psm1 — pure helpers for hive-task.ps1 (no git, no az, no I/O).
# Kept side-effect free so scripts/test/HiveTask.tests.ps1 can exercise them
# without a repo or an Azure DevOps login.

$script:HiveTypes = @('feat', 'fix', 'hotfix', 'chore', 'refactor', 'docs', 'test', 'ci', 'release')

# Branch grammar from team AGENTS.md (same regex the team git-guard hook enforces).
# The regex does NOT bound the word count; Test-HiveBranchName adds the 2-5 word rule on top.
$script:BranchRe = '^(' + ($script:HiveTypes -join '|') + ')/([0-9]+|noref)-[a-z0-9]+(-[a-z0-9]+)*$'

# Long-lived branches that must never be used as a task branch name.
# Team AGENTS.md lists dev, main, hivecfm-main, ucc-uat, release/*, customer/*;
# development/ucc-main/stg/prd are the other live long-lived branches on the remote.
$script:Reserved = @('development', 'dev', 'main', 'hivecfm-main', 'ucc-main', 'ucc-uat', 'staging', 'stg', 'prd')

# Commit scopes named in team AGENTS.md. An Area-Path-derived scope is only trusted
# when it is one of these; anything else must come from -Scope.
$script:KnownScopes = @('sso', 'migrator', 'bot-connector', 'contacts', 'db', 'nps')

# Words dropped when a work-item title is turned into a branch slug.
$script:StopWords = @('a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'at', 'by', 'with',
  'when', 'is', 'are', 'be', 'should', 'from', 'into', 'as', 'it', 'its', 'this', 'that')

function Get-HiveTypes { $script:HiveTypes }
function Get-HiveKnownScopes { $script:KnownScopes }
function Get-HiveReserved { $script:Reserved }

function Get-HiveTypeFromWorkItem {
  # Maps an Azure Boards work-item type to a branch/commit type.
  # Returns $null when the mapping is ambiguous — the caller must ask or take -Type.
  param([string]$WorkItemType, [string[]]$Tags = @())
  if ($Tags -contains 'hotfix') { return 'hotfix' }
  switch ($WorkItemType) {
    'Bug'                   { return 'fix' }
    'Issue'                 { return 'fix' }
    'User Story'            { return 'feat' }
    'Product Backlog Item'  { return 'feat' }
    'Feature'               { return 'feat' }
    default                 { return $null }   # Task, Epic, custom types: intent unknown
  }
}

function ConvertTo-HiveSlug {
  # Title -> 2..5 lowercase hyphenated words. Returns $null if fewer than 2 survive.
  param([Parameter(Mandatory)][string]$Text, [int]$MaxWords = 5)
  $clean = $Text.ToLowerInvariant() -replace "[’']", '' -replace '[^a-z0-9]+', ' '
  $words = @($clean.Split(' ', [StringSplitOptions]::RemoveEmptyEntries) |
      Where-Object { $script:StopWords -notcontains $_ })
  if ($words.Count -lt 2) { return $null }
  return (($words | Select-Object -First $MaxWords) -join '-')
}

function New-HiveBranchName {
  param([Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Ticket, [Parameter(Mandatory)][string]$Slug)
  return "$Type/$Ticket-$Slug"
}

function Test-HiveBranchName {
  # Returns an array of violation strings; empty array = valid.
  param([Parameter(Mandatory)][string]$Name)
  $errors = @()
  if ($Name -cnotmatch $script:BranchRe) {
    $errors += "does not match <type>/<ticket>-<kebab-desc> (type in $($script:HiveTypes -join '|'); ticket = digits or 'noref'; lowercase a-z0-9 and hyphens only)"
  }
  if ($Name -match '^[^/]+/([0-9]+|noref)-(.+)$') {
    $n = $Matches[2].Split('-').Count
    if ($n -lt 2 -or $n -gt 5) { $errors += "description has $n word(s); must be 2-5" }
  }
  # release/* is reserved for long-lived release lines; a release-PREP task branch
  # (release/<ticket>-<desc>) is the one release/ shape allowed.
  $isReservedRelease = ($Name -like 'release/*') -and ($Name -notmatch '^release/([0-9]+|noref)-')
  if (($script:Reserved -contains $Name) -or $isReservedRelease -or ($Name -like 'customer/*')) {
    $errors += 'is a reserved long-lived branch name'
  }
  return , $errors
}

function ConvertTo-HiveSummaryCase {
  # AGENTS.md: summary is lowercase. Lowercase plain words (Title Case from Azure Boards),
  # keep acronyms / mixed tokens (SSO, SSO-only, v4.6, iOS) as written.
  param([Parameter(Mandatory)][string]$Text)
  $words = $Text.Trim().TrimEnd('.') -split '\s+'
  return (($words | ForEach-Object { if ($_ -cmatch '^[A-Z][a-z]+[,:;]?$') { $_.ToLowerInvariant() } else { $_ } }) -join ' ')
}

function New-HiveCommitSubject {
  # <type>(<scope>): <summary>, <=72 chars, cut on a word boundary.
  param([Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Scope, [Parameter(Mandatory)][string]$Summary)
  $subject = "${Type}(${Scope}): $(ConvertTo-HiveSummaryCase $Summary)"
  if ($subject.Length -gt 72) {
    $cut = $subject.Substring(0, 73).LastIndexOf(' ')
    $subject = $subject.Substring(0, [Math]::Max($cut, $Type.Length + $Scope.Length + 4))
  }
  return $subject.TrimEnd(' ', '.', ',', ';', ':')
}

function New-HiveCommitTemplate {
  param([Parameter(Mandatory)][string]$Subject, [Parameter(Mandatory)][string]$Ticket)
  $footer = if ($Ticket -eq 'noref') { '' } else { "AB#$Ticket" }
  return @"
$Subject

# Body: WHAT changed and WHY (not how). Wrap at 72 chars. Delete if not needed.

$footer
# ---- rules (lines starting with # are dropped by git) ----
# subject: <type>(<scope>): <imperative summary>, <=72 chars, lowercase, no period
# types:   $($script:HiveTypes -join ' ')
# footer:  AB#<id> links the commit to Azure Boards (team convention); 'BREAKING CHANGE: ...' if needed
"@
}

function New-HivePrDraft {
  # Description body only (title goes to its own file) so it can be passed as-is to
  # az repos pr create --description. Azure DevOps caps descriptions at 4000 chars.
  param(
    [Parameter(Mandatory)][string]$Ticket,
    [Parameter(Mandatory)][string]$Branch,
    [Parameter(Mandatory)][string]$Base,
    [string]$WorkItemTitle = ''
  )
  $link = if ($Ticket -eq 'noref') { '_No work item (noref) - say why._' } else { "AB#$Ticket $WorkItemTitle".TrimEnd() }
  $abLine = if ($Ticket -eq 'noref') { '' } else { "`n- [ ] Commits carry the AB#$Ticket footer (team convention)" }
  return @"
## Work item / spec
$link
<!-- add product spec / design link if there is one -->

## Problem
<!-- what was wrong / missing, one paragraph -->

## Solution
<!-- what this PR changes and why this approach -->

## Scope audit
<!-- one line per file in: git diff --stat origin/$Base...$Branch  ->  path - why it must change.
     Revert drift / formatting hunks. -->

## Commands run (paste output)
<!-- relevant commands: pnpm test, pnpm lint, pnpm db:migrate:dev (if migrations changed).
     apps/web tests are red at baseline: paste the before/after delta on touched files
     (pnpm --filter @hivecfm/web exec vitest run <path>) and npx tsc --noEmit in the touched package.
     Long logs: attach as a file or comment (4000-char description limit). -->

## Migrations / env changes
<!-- none | list them -->

## Screenshots / gifs (UI changes)
<!-- before / after -->

## Reviewer checklist
- [ ] $Branch -> $Base
- [ ] Every commit subject is <type>(<scope>): <imperative lowercase summary>$abLine
- [ ] Diff contains only this task (no drift, no CI scaffolding)
- [ ] Commands above were actually run and pasted
- [ ] UI change has screenshots/gifs; migrations or env changes are listed
"@
}

Export-ModuleMember -Function Get-HiveTypes, Get-HiveKnownScopes, Get-HiveReserved, ConvertTo-HiveSummaryCase, Get-HiveTypeFromWorkItem, ConvertTo-HiveSlug, New-HiveBranchName,
  Test-HiveBranchName, New-HiveCommitSubject, New-HiveCommitTemplate, New-HivePrDraft
