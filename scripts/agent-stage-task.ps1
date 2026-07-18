[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State
$git = Get-AgGitInfo -Root $root

if (-not $git.Available) {
    throw "Git local est requis pour préparer le commit."
}
if ($state.status -ne "DONE") {
    throw "$TaskId doit être DONE avant staging. Statut : $($state.status)"
}
if (($state.PSObject.Properties.Name -contains "integration_delivery_id") -and
    $state.integration_validation -ne "PASS") {
    throw "La validation locale de la livraison n’est pas PASS."
}

$pathsToStage = @()
foreach ($file in @($state.changed_files)) {
    if (-not [string]::IsNullOrWhiteSpace($file)) {
        $pathsToStage += (Normalize-AgPath $file)
    }
}
$pathsToStage += ".agent/state/$TaskId.json"
$pathsToStage += ".agent/handoffs/$TaskId.md"
$pathsToStage += ".agent/evidence/$TaskId"
$pathsToStage += ".agent/changes/$TaskId.patch"
$pathsToStage += ".agent/generated/STATE.md"
$pathsToStage += ".agent/GENERATED_OUTPUTS.json"
$pathsToStage += ".agent/logs/audit.ndjson"

if ($state.PSObject.Properties.Name -contains "integration_delivery_id") {
    $pathsToStage += ".agent/deliveries/records/$($state.integration_delivery_id)"
}

$pathsToStage = @($pathsToStage | Sort-Object -Unique)

Push-Location $root
try {
    foreach ($relative in $pathsToStage) {
        & git add -A -- $relative
        if ($LASTEXITCODE -ne 0) {
            throw "Échec git add pour : $relative"
        }
    }

    $staged = @(& git diff --cached --name-status)
    if ($staged.Count -eq 0) {
        throw "Aucun changement stagé pour $TaskId."
    }

    Write-Host ""
    Write-Host "Fichiers préparés pour $TaskId :"
    $staged | ForEach-Object { Write-Host $_ }

    $prefix = if ($state.finding_id -eq "PRECHECK" -or $state.finding_id -eq "FINAL") {
        "chore"
    } else {
        "feat"
    }
    $suggested = "$prefix(pdp): $TaskId — $($state.title)"
    Write-Host ""
    Write-Host "Inspecter : git diff --cached"
    Write-Host "Commit suggéré :"
    Write-Host "git commit -m `"$suggested`""
}
finally {
    Pop-Location
}
