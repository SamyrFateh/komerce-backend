[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Reviewer,
    [Parameter(Mandatory)][ValidateSet("APPROVE","REJECT")][string]$Decision,
    [string]$Reason
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State

if ($state.status -ne "REVIEW") {
    throw "$TaskId n'est pas en REVIEW. Statut actuel : $($state.status)"
}
if ($Reviewer -eq $state.agent) {
    throw "Le reviewer doit être distinct de l'agent exécutant."
}
if ($Decision -eq "REJECT" -and [string]::IsNullOrWhiteSpace($Reason)) {
    throw "Une raison est obligatoire pour REJECT."
}

$state.reviewer = $Reviewer
$state.reviewed_at = (Get-Date).ToString("o")
$state.review_decision = $Decision
if ($Decision -eq "APPROVE") {
    if (($state.PSObject.Properties.Name -contains "integration_delivery_id") -and
        $state.integration_validation -ne "PASS") {
        throw "La livraison importée doit être validée localement avant APPROVE."
    }
    $state.status = "DONE"
    $state.next_action = "Aucune. Tâche approuvée."
}
else {
    $state.status = "READY"
    $state.blocking_reason = $Reason
    $state.next_action = "Corriger les remarques du reviewer."
    $state.agent = $null
}
Write-AgJson -Object $state -Path $paths.State

$reviewNote = Join-Path $paths.Evidence "reviewer-notes.md"
$note = @"
# Revue — $TaskId

- Reviewer : $Reviewer
- Décision : $Decision
- Date : $((Get-Date).ToString("o"))

## Motif ou observations

$Reason
"@
[System.IO.File]::WriteAllText($reviewNote, $note, [System.Text.UTF8Encoding]::new($false))
Add-AgAuditLog -Root $root -Action "TASK_REVIEWED" -TaskId $TaskId -Actor $Reviewer -Details $Decision
Update-AgDashboard -Root $root | Out-Null
Write-Host "$TaskId revue : $Decision. Nouveau statut : $($state.status)"
