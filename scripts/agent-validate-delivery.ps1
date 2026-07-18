[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State

if ($state.status -ne "REVIEW") {
    throw "$TaskId doit être en REVIEW après import. Statut : $($state.status)"
}
if (-not ($state.PSObject.Properties.Name -contains "integration_delivery_id")) {
    throw "Aucune livraison importée n’est associée à $TaskId."
}

$results = @()
foreach ($gate in @($state.gates)) {
    if ([string]::IsNullOrWhiteSpace($gate)) { continue }
    Write-Host "Gate local : $gate"
    $results += Invoke-AgCommand -Root $root -Command $gate
}

$failed = @($results | Where-Object { $_.result -eq "FAIL" })
$evidenceFile = Join-Path $paths.Evidence "integration-gates.json"
Write-AgJson -Object @($results) -Path $evidenceFile

Set-AgProperty -Object $state -Name "integration_gate_results" -Value @($results)
Set-AgProperty -Object $state -Name "integration_validated_at" -Value (Get-Date).ToString("o")

if ($failed.Count -gt 0) {
    $state.status = "BLOCKED"
    $state.blocking_reason = "Échec de validation locale après import."
    $state.next_action = "Corriger les gates en échec puis remettre la tâche en REVIEW."
    Set-AgProperty -Object $state -Name "integration_validation" -Value "FAIL"
    $auditAction = "DELIVERY_VALIDATION_FAILED"
}
else {
    $state.status = "REVIEW"
    $state.blocking_reason = $null
    $state.next_action = "Inspecter le diff puis approuver avec agent-review.ps1."
    Set-AgProperty -Object $state -Name "integration_validation" -Value "PASS"
    $auditAction = "DELIVERY_VALIDATED"
}

Write-AgJson -Object $state -Path $paths.State
Add-AgAuditLog -Root $root -Action $auditAction -TaskId $TaskId `
    -Actor $env:USERNAME -Details $state.integration_delivery_id
Update-AgDashboard -Root $root | Out-Null

$results | Format-Table command, result, exit_code -AutoSize
if ($failed.Count -gt 0) {
    throw "$($failed.Count) gate(s) local(aux) en échec."
}
Write-Host "Validation locale PASS. La tâche reste en REVIEW jusqu’à approbation humaine."
