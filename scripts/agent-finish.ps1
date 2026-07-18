[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Agent,
    [Parameter(Mandatory)][string]$Summary,
    [string]$NextAction = "Faire relire la tâche.",
    [switch]$SkipGates
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State

if ($state.status -ne "IN_PROGRESS") {
    throw "$TaskId n'est pas IN_PROGRESS. Statut actuel : $($state.status)"
}
if ($state.agent -ne $Agent) {
    throw "$TaskId est attribuée à '$($state.agent)', pas à '$Agent'."
}
if (-not (Test-Path $paths.Runtime)) {
    throw "Baseline absente pour $TaskId. Relancer agent-start.ps1 proprement."
}

$git = Get-AgGitInfo -Root $root
$before = @(Read-AgJson $paths.Runtime)
$after = @(Get-AgProjectInventory -Root $root)
$inventoryChanges = @(Compare-AgInventory -Before $before -After $after)
$changed = @($inventoryChanges | ForEach-Object { $_.path } | Sort-Object -Unique)

$gateResults = @()
if ($SkipGates) {
    foreach ($gate in @($state.gates)) {
        $gateResults += [pscustomobject]@{
            command = $gate
            result = "NOT_RUN"
            exit_code = $null
            output = "SkipGates demandé"
        }
    }
}
else {
    foreach ($gate in @($state.gates)) {
        if ([string]::IsNullOrWhiteSpace($gate)) { continue }
        Write-Host "Gate agent : $gate"
        $gateResults += Invoke-AgCommand -Root $root -Command $gate
    }
}

$failed = @($gateResults | Where-Object { $_.result -eq "FAIL" })
$state.status = if ($failed.Count -gt 0) { "BLOCKED" } else { "REVIEW" }
$state.finished_at = (Get-Date).ToString("o")
$state.last_commit = $git.Commit
$state.changed_files = @($changed)
$state.gate_results = @($gateResults)
$state.summary = $Summary
$state.next_action = $NextAction
$state.blocking_reason = if ($failed.Count -gt 0) {
    "Un ou plusieurs gates ont échoué dans la copie de l’agent."
} else {
    $null
}
Write-AgJson -Object $state -Path $paths.State

$handoffTemplate = Get-Content -LiteralPath `
    (Join-Path $root ".agent\handoffs\HANDOFF-TEMPLATE.md") -Raw -Encoding UTF8
$handoff = $handoffTemplate.Replace("{{TASK_ID}}", $TaskId)

$details = @()
$details += ""
$details += "---"
$details += ""
$details += "## Données générées automatiquement"
$details += ""
$details += "- Agent : $Agent"
$details += "- Statut : $($state.status)"
$details += "- Résumé : $Summary"
$details += "- Prochaine action : $NextAction"
$details += "- Package de base : $($state.base_package_id)"
$details += "- Commit de départ : $($state.base_commit)"
$details += "- Dernier commit observé : $($state.last_commit)"
$details += "- Fichiers projet modifiés :"
if ($changed.Count -eq 0) {
    $details += "  - Aucun fichier projet ; livraison de preuves/gouvernance uniquement."
}
else {
    foreach ($file in $changed) { $details += "  - ``$file``" }
}
$details += "- Gates agent :"
foreach ($gateResult in $gateResults) {
    $details += "  - ``$($gateResult.command)`` → **$($gateResult.result)**"
}
[System.IO.File]::WriteAllText(
    $paths.Handoff,
    $handoff + ($details -join "`n"),
    [System.Text.UTF8Encoding]::new($false)
)

New-Item -ItemType Directory -Path $paths.Evidence -Force | Out-Null
[System.IO.File]::WriteAllLines(
    (Join-Path $paths.Evidence "diff-summary.txt"),
    @($inventoryChanges | ForEach-Object { "$($_.change)`t$($_.path)" }),
    [System.Text.UTF8Encoding]::new($false)
)
Write-AgJson -Object @($gateResults) -Path (Join-Path $paths.Evidence "agent-gates.json")

# Patch Git des fichiers suivis. Les fichiers non suivis restent transportés dans payload/files.
if ($git.Available -and $state.base_commit) {
    Push-Location $root
    try {
        $patchLines = @(& git diff --binary $state.base_commit --)
        [System.IO.File]::WriteAllLines(
            (Join-Path $root ".agent\changes\$TaskId.patch"),
            $patchLines,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
    finally {
        Pop-Location
    }
}

Add-AgAuditLog -Root $root -Action "TASK_FINISHED" -TaskId $TaskId `
    -Actor $Agent -Details $state.status
Update-AgDashboard -Root $root | Out-Null

Write-Host "$TaskId terminée avec statut $($state.status)."
Write-Host "Fichiers projet détectés : $($changed.Count)"
Write-Host "Étape suivante : agent-export-delivery.ps1 -TaskId $TaskId -Agent `"$Agent`""
