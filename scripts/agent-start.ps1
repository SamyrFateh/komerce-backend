[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Agent,
    [int]$LeaseMinutes = 120
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State

if ($state.status -ne "READY") {
    throw "$TaskId n'est pas READY. Statut actuel : $($state.status)"
}

foreach ($dep in @($state.depends_on)) {
    $depPath = (Get-AgTaskPaths -Root $root -TaskId $dep).State
    $depState = Read-AgJson $depPath
    if ($depState.status -ne "DONE") {
        throw "Dépendance non terminée : $dep ($($depState.status))"
    }
}

$manifest = Read-AgJson (Join-Path $root ".agent\MANIFEST.json")
$git = Get-AgGitInfo -Root $root
$inventory = Get-AgProjectInventory -Root $root
Write-AgJson -Object $inventory -Path $paths.Runtime

$state.status = "IN_PROGRESS"
$state.agent = $Agent
$state.base_package_id = $manifest.package_id
$state.started_at = (Get-Date).ToString("o")
$state.lease_until = (Get-Date).AddMinutes($LeaseMinutes).ToString("o")
$state.base_commit = $git.Commit
$state.branch = $git.Branch
$state.blocking_reason = $null
$state.next_action = $null
Write-AgJson -Object $state -Path $paths.State

Add-AgAuditLog -Root $root -Action "TASK_STARTED" -TaskId $TaskId -Actor $Agent -Details "Lease $LeaseMinutes minutes"
Update-AgDashboard -Root $root | Out-Null

Write-Host "$TaskId démarrée par $Agent."
Write-Host "Package de base : $($manifest.package_id)"
Write-Host "Commit de base : $($git.Commit)"
Write-Host "Baseline SHA-256 : $($paths.Runtime)"
