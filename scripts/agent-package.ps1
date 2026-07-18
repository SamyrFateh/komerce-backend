[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$IncludeGit,
    [string]$TaskId,
    [string]$Agent,
    [switch]$AllowDirty
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path (Split-Path $root -Parent) "agent-packages"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Update-AgDashboard -Root $root | Out-Null
$manifestPath = Join-Path $root ".agent\MANIFEST.json"
$baseManifest = Read-AgJson $manifestPath
$git = Get-AgGitInfo -Root $root

if ($git.Available -and -not $git.Clean -and -not $AllowDirty) {
    throw "Le working tree doit être propre avant packaging. Committer ou utiliser -AllowDirty explicitement."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$random = [guid]::NewGuid().ToString("N").Substring(0,8)
$newPackageId = "PKG-$stamp-$random"

$suffix = ""
if ($TaskId) { $suffix += "-$TaskId" }
if ($Agent) { $suffix += "-" + ($Agent -replace '[^A-Za-z0-9_.-]','-') }
$zipName = "$newPackageId$suffix.zip"
$zipPath = Join-Path $OutputDirectory $zipName

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-package-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
$stage = Join-Path $temp (Split-Path $root -Leaf)
New-Item -ItemType Directory -Path $stage | Out-Null

$excludeDirs = @(
    "node_modules",".next","coverage",
    ".cache",".parcel-cache",".turbo","__pycache__","agent-packages"
)
if (-not $IncludeGit) { $excludeDirs += ".git" }

try {
    Get-ChildItem -LiteralPath $root -Force | ForEach-Object {
        if (-not ($excludeDirs -contains $_.Name)) {
            $destination = Join-Path $stage $_.Name
            if ($_.PSIsContainer) {
                Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
            }
            else {
                Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
            }
        }
    }

    # Ne jamais embarquer les bundles bruts, backups ou rejets.
    $ephemeralDeliveryDirs = @(
        ".agent\deliveries\inbox",
        ".agent\deliveries\outbox",
        ".agent\deliveries\archive",
        ".agent\deliveries\backups",
        ".agent\deliveries\rejected"
    )
    foreach ($relativeDir in $ephemeralDeliveryDirs) {
        $stageDir = Join-Path $stage $relativeDir
        if (Test-Path $stageDir) {
            Get-ChildItem -LiteralPath $stageDir -Force |
                Where-Object { $_.Name -ne "README.md" } |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # Le manifeste du package est modifié uniquement dans la copie de staging.
    $packageManifestPath = Join-Path $stage ".agent\MANIFEST.json"
    $packageManifest = Read-AgJson $packageManifestPath
    $packageManifest.base_package_id = $baseManifest.package_id
    $packageManifest.package_id = $newPackageId
    $packageManifest.created_at = (Get-Date).ToString("o")
    $packageManifest.git_commit = $git.Commit
    $packageManifest.working_tree_clean = $git.Clean
    $packageManifest.include_git = [bool]$IncludeGit
    $packageManifest.status = "PACKAGED"
    Set-AgProperty -Object $packageManifest -Name "assigned_task_id" -Value $TaskId
    Set-AgProperty -Object $packageManifest -Name "assigned_agent" -Value $Agent
    Write-AgJson -Object $packageManifest -Path $packageManifestPath

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -LiteralPath $stage -DestinationPath $zipPath -CompressionLevel Optimal

    $hash = Get-AgFileHashValue $zipPath
    "$hash  $zipName" | Set-Content -LiteralPath ($zipPath + ".sha256.txt") -Encoding UTF8

    # Reçu local non versionné : le working tree reste propre.
    $issuedDir = Join-Path $root ".agent\runtime\issued-packages"
    New-Item -ItemType Directory -Path $issuedDir -Force | Out-Null
    $receipt = [ordered]@{
        package_id = $newPackageId
        base_package_id = $baseManifest.package_id
        project = $baseManifest.project
        worksite = $baseManifest.worksite
        task_id = $TaskId
        agent = $Agent
        created_at = (Get-Date).ToString("o")
        git_commit = $git.Commit
        working_tree_clean = $git.Clean
        include_git = [bool]$IncludeGit
        zip_name = $zipName
        zip_sha256 = $hash
    }
    Write-AgJson -Object $receipt -Path (Join-Path $issuedDir "$newPackageId.json")

    Write-Host "Paquet créé : $zipPath"
    Write-Host "Package ID : $newPackageId"
    Write-Host "SHA-256    : $hash"
    Write-Host "Le manifeste suivi par Git n’a pas été modifié."
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
