# Plain-assert tests for HiveTask.psm1 (no Pester dependency — PS 5.1 ships Pester 3).
# Run: powershell -NoProfile -File scripts\test\HiveTask.tests.ps1     exit 0 = all pass
Import-Module (Join-Path $PSScriptRoot '..\HiveTask.psm1') -Force -ErrorAction Stop

$script:fail = 0; $script:pass = 0
function Assert-Eq($Name, $Expected, $Actual) {
  if ("$Expected" -ceq "$Actual") { $script:pass++ }
  else { $script:fail++; Write-Host "FAIL $Name`n  expected: $Expected`n  actual:   $Actual" -ForegroundColor Red }
}

# --- branch names: valid (first three are the team AGENTS.md examples; release/<ticket>-<desc>
#     is this workspace's reading of AGENTS.md's release type vs reserved release/* lines) ---
foreach ($ok in 'feat/4821-sso-only-login-toggle', 'fix/4790-expire-card', 'ci/4612-acr-push-set-e',
  'chore/noref-drop-tracked-migrations', 'release/5001-prepare-v4-6', 'hotfix/9-fix-login') {
  Assert-Eq "valid $ok" 0 (Test-HiveBranchName -Name $ok).Count
}

# --- branch names: invalid ---------------------------------------------------
$bad = @{
  'feature/4821-sso-toggle'          = 'feature/ is not a type'
  'feat/AB1234-sso-toggle'           = 'AB prefix in branch'
  'feat/AB#1234-sso-toggle'          = 'AB# in branch'
  'feat/4821-SsoToggle'              = 'CamelCase'
  'feat/4821-sso_toggle'             = 'underscore'
  'feat/4821-toggle'                 = '1 word'
  'feat/4821-one-two-three-four-five-six' = '6 words'
  'ahmed/4821-sso-toggle'            = 'personal-name prefix'
  'feat/sso-toggle'                  = 'no ticket'
  'development'                      = 'reserved'
  'hivecfm-main'                     = 'reserved'
  'release/v4.6'                     = 'reserved release line'
  'customer/acme'                    = 'reserved customer line'
}
foreach ($k in $bad.Keys) {
  if ((Test-HiveBranchName -Name $k).Count -eq 0) { $script:fail++; Write-Host "FAIL accepted invalid '$k' ($($bad[$k]))" -ForegroundColor Red } else { $script:pass++ }
}

# --- slug from work-item title ----------------------------------------------
Assert-Eq 'slug stopwords'   'add-sso-only-login-toggle'       (ConvertTo-HiveSlug 'Add the SSO-only login toggle')
Assert-Eq 'slug max 5'       'expire-card-shows-wrong-date'    (ConvertTo-HiveSlug 'Expire card shows the wrong date when the survey is closed')
Assert-Eq 'slug 5 words'     5                                 ((ConvertTo-HiveSlug 'one two three four five six seven').Split('-').Count)
Assert-Eq 'slug punctuation' 'contacts-cant-import-csv'        (ConvertTo-HiveSlug "Contacts: can't import CSV!")
Assert-Eq 'slug too short'   ''                                (ConvertTo-HiveSlug 'The bug')
Assert-Eq 'slug arabic-only' ''                                (ConvertTo-HiveSlug 'إصلاح الخطأ')

# --- type mapping ------------------------------------------------------------
Assert-Eq 'Bug->fix'          'fix'    (Get-HiveTypeFromWorkItem 'Bug')
Assert-Eq 'Story->feat'       'feat'   (Get-HiveTypeFromWorkItem 'User Story')
Assert-Eq 'Task->ask'         ''       (Get-HiveTypeFromWorkItem 'Task')
Assert-Eq 'hotfix tag wins'   'hotfix' (Get-HiveTypeFromWorkItem 'Bug' -Tags @('ui', 'hotfix'))

# --- commit subject ----------------------------------------------------------
Assert-Eq 'subject form'   'feat(sso): add SSO-only login toggle' (New-HiveCommitSubject 'feat' 'sso' 'Add SSO-only login toggle.')
Assert-Eq 'subject acronym' 'feat(sso): SSO-only login toggle' (New-HiveCommitSubject 'feat' 'sso' 'SSO-only login toggle')
Assert-Eq 'subject title case' 'feat(contacts): add bulk contact import for iOS v4.6' (New-HiveCommitSubject 'feat' 'contacts' 'Add Bulk Contact Import For iOS v4.6')
$long = New-HiveCommitSubject 'fix' 'contacts' 'make the contacts import page handle extremely large csv uploads without timing out ever'
Assert-Eq 'subject word cut' $true (($long.Length -le 72) -and ($long -match ' [a-z]+$') -and ('make the contacts import page handle extremely large csv uploads without timing out ever' -match [regex]::Escape(($long -replace '^fix\(contacts\): ', '')) + '( |$)'))
Assert-Eq 'subject <=72'   $true ((New-HiveCommitSubject 'fix' 'contacts' ('x' * 100)).Length -le 72)
$tpl = New-HiveCommitTemplate -Subject 'fix(db): x y' -Ticket '4790'
Assert-Eq 'template footer' $true ($tpl -match '(?m)^AB#4790$')
Assert-Eq 'noref no footer' $false ((New-HiveCommitTemplate -Subject 'chore(db): x y' -Ticket 'noref') -match 'AB#noref')
$pr = New-HivePrDraft -Ticket '4790' -Branch 'fix/4790-x-y' -Base 'development'
Assert-Eq 'pr links AB#'    $true ($pr -match 'AB#4790')
Assert-Eq 'pr no claude footer' $false ($pr -match 'Claude Code')
Assert-Eq 'pr noref no AB line' $false ((New-HivePrDraft -Ticket 'noref' -Branch 'chore/noref-x-y' -Base 'development') -match 'AB#')

Write-Host "$script:pass passed, $script:fail failed"
exit $script:fail
