[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ZipPath,
    [string]$ExpectedSha256
)

if (-not (Test-Path $ZipPath)) { throw "ZIP introuvable : $ZipPath" }
$hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "SHA-256 calculé : $hash"

if ($ExpectedSha256) {
    if ($hash -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "Le SHA-256 ne correspond pas."
    }
    Write-Host "Intégrité SHA-256 validée."
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-verify-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $temp -Force
    $manifest = Get-ChildItem -LiteralPath $temp -Filter "MANIFEST.json" -Recurse |
        Where-Object { $_.FullName -like "*\.agent\MANIFEST.json" } |
        Select-Object -First 1
    if (-not $manifest) { throw "MANIFEST.json introuvable dans le ZIP." }

    $data = Get-Content -LiteralPath $manifest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "Package ID : $($data.package_id)"
    Write-Host "Base package : $($data.base_package_id)"
    Write-Host "Projet : $($data.project)"
    Write-Host "Commit : $($data.git_commit)"
    Write-Host "Validation structurelle réussie."
}
finally {
    Remove-Item $temp -Recurse -Force
}
