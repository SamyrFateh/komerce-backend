[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DeliveryZip,
    [switch]$Apply
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
if (-not (Test-Path -LiteralPath $DeliveryZip -PathType Leaf)) {
    throw "Bundle introuvable : $DeliveryZip"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ag-import-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Expand-Archive -LiteralPath $DeliveryZip -DestinationPath $tempRoot -Force
    $deliveryPath = Join-Path $tempRoot "delivery.json"
    $checksumsPath = Join-Path $tempRoot "checksums.json"
    if (-not (Test-Path $deliveryPath)) { throw "delivery.json absent du bundle." }
    if (-not (Test-Path $checksumsPath)) { throw "checksums.json absent du bundle." }

    $delivery = Read-AgJson $deliveryPath
    $checksums = @(Read-AgJson $checksumsPath)

    foreach ($entry in $checksums) {
        $filePath = Join-Path $tempRoot ($entry.path.Replace('/','\'))
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            throw "Fichier annoncé absent : $($entry.path)"
        }
        $actual = Get-AgFileHashValue $filePath
        if ($actual -ne $entry.sha256) {
            throw "Checksum invalide : $($entry.path)"
        }
    }

    $taskId = $delivery.task_id
    $paths = Get-AgTaskPaths -Root $root -TaskId $taskId
    $localState = Read-AgJson $paths.State
    $manifest = Read-AgJson (Join-Path $root ".agent\MANIFEST.json")

    if ($delivery.project -ne $manifest.project -or $delivery.worksite -ne $manifest.worksite) {
        throw "Le bundle appartient à un autre projet ou chantier."
    }
    $packageKnown = ($delivery.source_package_id -eq $manifest.package_id)
    $issuedReceipt = Join-Path $root ".agent\runtime\issued-packages\$($delivery.source_package_id).json"
    if (Test-Path $issuedReceipt) {
        $receipt = Read-AgJson $issuedReceipt
        if ($receipt.project -eq $manifest.project -and $receipt.worksite -eq $manifest.worksite) {
            $packageKnown = $true
        }
    }

    # Secours si le reçu local a été perdu mais que le commit de base appartient au repo.
    if (-not $packageKnown -and $delivery.base_commit) {
        $git = Get-AgGitInfo -Root $root
        if ($git.Available) {
            Push-Location $root
            try {
                & git cat-file -e "$($delivery.base_commit)^{commit}" 2>$null
                if ($LASTEXITCODE -eq 0) { $packageKnown = $true }
            }
            finally { Pop-Location }
        }
    }

    if (-not $packageKnown) {
        throw "Package source non reconnu : $($delivery.source_package_id)"
    }
    if ($localState.status -eq "DONE") {
        throw "$taskId est déjà DONE dans le repo local."
    }

    $allowedPatterns = @($localState.allowed_files)
    $generatedOutputsPath = Join-Path $root ".agent\GENERATED_OUTPUTS.json"
    if (Test-Path $generatedOutputsPath) {
        $generatedOutputs = Read-AgJson $generatedOutputsPath
        $allowedPatterns += @($generatedOutputs.allowed_patterns)
    }

    $plan = @()
    $conflicts = @()

    foreach ($change in @($delivery.changed_files)) {
        $relative = Normalize-AgPath $change.path
        if (-not (Test-AgPathAllowed -Path $relative -Patterns @($allowedPatterns))) {
            throw "Le bundle tente de livrer un fichier hors périmètre : $relative"
        }

        $target = Join-Path $root ($relative.Replace('/','\'))
        $exists = Test-Path -LiteralPath $target -PathType Leaf
        $currentHash = if ($exists) { Get-AgFileHashValue $target } else { $null }
        $status = "READY_TO_APPLY"

        if ($change.action -eq "ADDED") {
            if ($exists -and $currentHash -eq $change.delivered_sha256) {
                $status = "ALREADY_APPLIED"
            }
            elseif ($exists) {
                $status = "CONFLICT"
            }
        }
        elseif ($change.action -eq "MODIFIED") {
            if ($exists -and $currentHash -eq $change.delivered_sha256) {
                $status = "ALREADY_APPLIED"
            }
            elseif (-not $exists -or $currentHash -ne $change.base_sha256) {
                $status = "CONFLICT"
            }
        }
        elseif ($change.action -eq "DELETED") {
            if (-not $exists) {
                $status = "ALREADY_APPLIED"
            }
            elseif ($currentHash -ne $change.base_sha256) {
                $status = "CONFLICT"
            }
        }
        else {
            throw "Action inconnue pour $relative : $($change.action)"
        }

        $item = [pscustomobject]@{
            path = $relative
            action = $change.action
            status = $status
            current_sha256 = $currentHash
            base_sha256 = $change.base_sha256
            delivered_sha256 = $change.delivered_sha256
        }
        $plan += $item
        if ($status -eq "CONFLICT") { $conflicts += $item }
    }

    Write-Host ""
    Write-Host "Livraison : $($delivery.delivery_id)"
    Write-Host "Tâche     : $taskId"
    Write-Host "Agent     : $($delivery.agent)"
    Write-Host "Package   : $($delivery.source_package_id)"
    Write-Host ""
    $plan | Format-Table path, action, status -AutoSize

    if ($conflicts.Count -gt 0) {
        $rejectDir = Join-Path $root ".agent\deliveries\rejected"
        New-Item -ItemType Directory -Path $rejectDir -Force | Out-Null
        Copy-Item -LiteralPath $DeliveryZip `
            -Destination (Join-Path $rejectDir ([System.IO.Path]::GetFileName($DeliveryZip))) -Force
        throw "$($conflicts.Count) conflit(s) détecté(s). Aucun fichier appliqué."
    }

    if (-not $Apply) {
        Write-Host ""
        Write-Host "Prévisualisation réussie. Relancer avec -Apply pour appliquer la livraison."
        return
    }

    $deliveryId = $delivery.delivery_id
    $backupRoot = Join-Path $root ".agent\deliveries\backups\$deliveryId"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    foreach ($item in $plan) {
        if ($item.status -eq "ALREADY_APPLIED") { continue }
        $target = Join-Path $root ($item.path.Replace('/','\'))

        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $backupPath = Join-Path $backupRoot ($item.path.Replace('/','\'))
            New-Item -ItemType Directory -Path (Split-Path $backupPath -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $target -Destination $backupPath -Force
        }

        if ($item.action -eq "DELETED") {
            if (Test-Path -LiteralPath $target) {
                Remove-Item -LiteralPath $target -Force
            }
        }
        else {
            $sourceFile = Join-Path $tempRoot ("payload\files\" + $item.path.Replace('/','\'))
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
                throw "Payload absent : $($item.path)"
            }
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $sourceFile -Destination $target -Force
        }
    }

    $importedState = Read-AgJson (Join-Path $tempRoot "governance\state.json")
    Set-AgProperty -Object $importedState -Name "integration_delivery_id" -Value $deliveryId
    Set-AgProperty -Object $importedState -Name "integration_status" -Value "IMPORTED"
    Set-AgProperty -Object $importedState -Name "integration_imported_at" -Value (Get-Date).ToString("o")
    Set-AgProperty -Object $importedState -Name "integration_validation" -Value $null
    Write-AgJson -Object $importedState -Path $paths.State

    $handoffSource = Join-Path $tempRoot "governance\handoff.md"
    if (Test-Path $handoffSource) {
        Copy-Item -LiteralPath $handoffSource -Destination $paths.Handoff -Force
    }

    $evidenceSource = Join-Path $tempRoot "governance\evidence"
    if (Test-Path $evidenceSource) {
        New-Item -ItemType Directory -Path $paths.Evidence -Force | Out-Null
        Copy-Item -Path (Join-Path $evidenceSource "*") -Destination $paths.Evidence `
            -Recurse -Force -ErrorAction SilentlyContinue
    }

    $generatedConfigSource = Join-Path $tempRoot "governance\config\GENERATED_OUTPUTS.json"
    if (Test-Path $generatedConfigSource) {
        Copy-Item -LiteralPath $generatedConfigSource `
            -Destination (Join-Path $root ".agent\GENERATED_OUTPUTS.json") -Force
    }

    $patchSource = Join-Path $tempRoot "changes\$taskId.patch"
    $patchTarget = Join-Path $root ".agent\changes\$taskId.patch"
    if (Test-Path $patchSource) {
        Copy-Item -LiteralPath $patchSource -Destination $patchTarget -Force
    }

    $recordRoot = Join-Path $root ".agent\deliveries\records\$deliveryId"
    New-Item -ItemType Directory -Path $recordRoot -Force | Out-Null
    Copy-Item -LiteralPath $deliveryPath -Destination (Join-Path $recordRoot "delivery.json") -Force
    Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $recordRoot "checksums.json") -Force
    if (Test-Path $patchSource) {
        Copy-Item -LiteralPath $patchSource -Destination (Join-Path $recordRoot "task.patch") -Force
    }

    $report = [ordered]@{
        delivery_id = $deliveryId
        task_id = $taskId
        imported_at = (Get-Date).ToString("o")
        imported_by = $env:USERNAME
        source_zip = [System.IO.Path]::GetFileName($DeliveryZip)
        result = "IMPORTED"
        files = @($plan)
        backup_directory = $backupRoot
    }
    Write-AgJson -Object $report -Path (Join-Path $recordRoot "import-report.json")

    $archivePath = Join-Path $root ".agent\deliveries\archive\$deliveryId.zip"
    Copy-Item -LiteralPath $DeliveryZip -Destination $archivePath -Force

    Add-AgAuditLog -Root $root -Action "DELIVERY_IMPORTED" -TaskId $taskId `
        -Actor $env:USERNAME -Details $deliveryId
    Update-AgDashboard -Root $root | Out-Null

    Write-Host ""
    Write-Host "Livraison appliquée sans conflit."
    Write-Host "Backup local : $backupRoot"
    Write-Host "Record Git    : $recordRoot"
    Write-Host "Étape suivante : agent-validate-delivery.ps1 -TaskId $taskId"
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
