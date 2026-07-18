[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Agent,
    [Parameter(Mandatory)][string]$Reason,
    [Parameter(Mandatory)][string]$NextAction
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State

if ($state.status -notin @("IN_PROGRESS","READY","CLAIMED")) {
    throw "$TaskId ne peut pas être bloquée depuis le statut $($state.status)."
}
if ($state.agent -and $state.agent -ne $Agent) {
    throw "$TaskId est attribuée à '$($state.agent)', pas à '$Agent'."
}

$git = Get-AgGitInfo -Root $root
$changed = @()
$inventoryChanges = @()
if (Test-Path $paths.Runtime) {
    $before = @(Read-AgJson $paths.Runtime)
    $after = @(Get-AgProjectInventory -Root $root)
    $inventoryChanges = @(Compare-AgInventory -Before $before -After $after)
    $changed = @($inventoryChanges | ForEach-Object { $_.path } | Sort-Object -Unique)
}

$state.status = "BLOCKED"
$state.agent = $Agent
$state.finished_at = (Get-Date).ToString("o")
$state.last_commit = $git.Commit
$state.changed_files = @($changed)
$state.blocking_reason = $Reason
$state.next_action = $NextAction
Write-AgJson -Object $state -Path $paths.State

New-Item -ItemType Directory -Path $paths.Evidence -Force | Out-Null
[System.IO.File]::WriteAllLines(
    (Join-Path $paths.Evidence "partial-diff-summary.txt"),
    @($inventoryChanges | ForEach-Object { "$($_.change)`t$($_.path)" }),
    [System.Text.UTF8Encoding]::new($false)
)

$handoff = @"
# HANDOFF — $TaskId

- Agent : $Agent
- Statut : BLOCKED
- Date : $((Get-Date).ToString("o"))
- Package de base : $($state.base_package_id)
- Commit de départ : $($state.base_commit)
- Dernier commit observé : $($state.last_commit)

## Blocage

$Reason

## Prochaine action exacte

$NextAction

## Travail partiel transporté

$(@($changed) -join "`n")
"@
[System.IO.File]::WriteAllText(
    $paths.Handoff,
    $handoff,
    [System.Text.UTF8Encoding]::new($false)
)

Add-AgAuditLog -Root $root -Action "TASK_BLOCKED" -TaskId $TaskId `
    -Actor $Agent -Details $Reason
Update-AgDashboard -Root $root | Out-Null

Write-Host "$TaskId passée à BLOCKED."
Write-Host "Le travail partiel peut être livré avec agent-export-delivery.ps1."
