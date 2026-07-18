[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Agent,
    [string]$OutputDirectory
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId
$state = Read-AgJson $paths.State
$manifest = Read-AgJson (Join-Path $root ".agent\MANIFEST.json")

if ($state.status -notin @("REVIEW","BLOCKED")) {
    throw "$TaskId doit être REVIEW ou BLOCKED avant export. Statut : $($state.status)"
}
if ($state.agent -ne $Agent) {
    throw "$TaskId appartient à '$($state.agent)', pas à '$Agent'."
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $root ".agent\deliveries\outbox"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$allowedPatterns = @($state.allowed_files)
$generatedOutputsPath = Join-Path $root ".agent\GENERATED_OUTPUTS.json"
if (Test-Path $generatedOutputsPath) {
    $generatedOutputs = Read-AgJson $generatedOutputsPath
    $allowedPatterns += @($generatedOutputs.allowed_patterns)
}

$baselineMap = @{}
if (Test-Path $paths.Runtime) {
    foreach ($entry in @(Read-AgJson $paths.Runtime)) {
        $baselineMap[(Normalize-AgPath $entry.path)] = $entry
    }
}

$projectChanges = @()
foreach ($pathValue in @($state.changed_files)) {
    if ([string]::IsNullOrWhiteSpace($pathValue)) { continue }
    $relative = Normalize-AgPath $pathValue
    if ($relative.StartsWith(".agent/")) { continue }

    if (-not (Test-AgPathAllowed -Path $relative -Patterns @($allowedPatterns))) {
        throw "Fichier modifié hors périmètre autorisé : $relative"
    }

    $target = Join-Path $root ($relative.Replace('/','\'))
    $baseEntry = $baselineMap[$relative]
    $baseHash = if ($baseEntry) { $baseEntry.sha256 } else { $null }

    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $currentHash = Get-AgFileHashValue $target
        $action = if ($baseHash) { "MODIFIED" } else { "ADDED" }
        $length = (Get-Item -LiteralPath $target).Length
    }
    else {
        $currentHash = $null
        $action = "DELETED"
        $length = 0
    }

    $projectChanges += [pscustomobject]@{
        path = $relative
        action = $action
        base_sha256 = $baseHash
        delivered_sha256 = $currentHash
        length = $length
    }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeAgent = ($Agent -replace '[^A-Za-z0-9_.-]','-')
$deliveryId = "DEL-$TaskId-$stamp-$safeAgent"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ag-delivery-" + [guid]::NewGuid())
$stage = Join-Path $tempRoot "delivery"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "payload\files") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "governance\evidence") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "governance\config") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "changes") -Force | Out-Null

try {
    $deletions = @()
    foreach ($change in $projectChanges) {
        if ($change.action -eq "DELETED") {
            $deletions += $change.path
            continue
        }
        $sourcePath = Join-Path $root ($change.path.Replace('/','\'))
        $destPath = Join-Path $stage ("payload\files\" + $change.path.Replace('/','\'))
        New-Item -ItemType Directory -Path (Split-Path $destPath -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destPath -Force
    }
    Write-AgJson -Object @($deletions) -Path (Join-Path $stage "payload\deletions.json")

    Copy-Item -LiteralPath $paths.State -Destination (Join-Path $stage "governance\state.json") -Force
    if (Test-Path $generatedOutputsPath) {
        Copy-Item -LiteralPath $generatedOutputsPath `
            -Destination (Join-Path $stage "governance\config\GENERATED_OUTPUTS.json") -Force
    }
    if (Test-Path $paths.Handoff) {
        Copy-Item -LiteralPath $paths.Handoff -Destination (Join-Path $stage "governance\handoff.md") -Force
    }
    if (Test-Path $paths.Evidence) {
        Copy-Item -Path (Join-Path $paths.Evidence "*") `
            -Destination (Join-Path $stage "governance\evidence") -Recurse -Force -ErrorAction SilentlyContinue
    }

    $patchPath = Join-Path $root ".agent\changes\$TaskId.patch"
    if (Test-Path $patchPath) {
        Copy-Item -LiteralPath $patchPath -Destination (Join-Path $stage "changes\$TaskId.patch") -Force
    }

    $delivery = [ordered]@{
        schema_version = 1
        delivery_id = $deliveryId
        project = $manifest.project
        worksite = $manifest.worksite
        task_id = $TaskId
        task_title = $state.title
        agent = $Agent
        task_status = $state.status
        source_package_id = $state.base_package_id
        current_package_id = $manifest.package_id
        base_commit = $state.base_commit
        result_commit = $state.last_commit
        created_at = (Get-Date).ToString("o")
        changed_files = @($projectChanges)
        agent_gate_results = @($state.gate_results)
        summary = $state.summary
        next_action = $state.next_action
    }
    Write-AgJson -Object $delivery -Path (Join-Path $stage "delivery.json")

    $checksums = @()
    Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
        if ($_.Name -eq "checksums.json") { return }
        $checksums += [pscustomobject]@{
            path = (Get-AgRelativePath -BasePath $stage -Path $_.FullName).Replace('\','/')
            sha256 = Get-AgFileHashValue $_.FullName
            length = $_.Length
        }
    }
    Write-AgJson -Object @($checksums) -Path (Join-Path $stage "checksums.json")

    $zipPath = Join-Path $OutputDirectory ($deliveryId + ".zip")
    if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

    $zipHash = Get-AgFileHashValue $zipPath
    "$zipHash  $([System.IO.Path]::GetFileName($zipPath))" |
        Set-Content -LiteralPath ($zipPath + ".sha256.txt") -Encoding UTF8

    Add-AgAuditLog -Root $root -Action "DELIVERY_EXPORTED" -TaskId $TaskId -Actor $Agent -Details $deliveryId
    Write-Host "Livraison créée : $zipPath"
    Write-Host "SHA-256 : $zipHash"
    Write-Host "Remettre ce ZIP à l'utilisateur. Ne pas copier-coller les fichiers dans le chat."
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
