# delete-and-rename.ps1
# À exécuter depuis la racine de D:\komerce-backend :
#   .\delete-and-rename.ps1
#
# Fait deux choses :
#   1. Renomme migrations/122_drop_collective_workspace_tables.sql -> 125_...
#   2. Supprime les 57 fichiers listés dans files-to-delete.txt (même dossier que ce script)

$ErrorActionPreference = 'Stop'

$oldMigration = "migrations\122_drop_collective_workspace_tables.sql"
$newMigration = "migrations\125_drop_collective_workspace_tables.sql"

if (Test-Path $oldMigration) {
    Move-Item $oldMigration $newMigration -Force
    Write-Host "OK - migration renommée : 122 -> 125"
} else {
    Write-Host "SKIP - $oldMigration introuvable (déjà renommée ?)"
}

$listPath = Join-Path $PSScriptRoot "files-to-delete.txt"
$files = Get-Content $listPath

$deleted = 0
$missing = 0
foreach ($f in $files) {
    if (Test-Path $f) {
        Remove-Item $f -Force
        $deleted++
    } else {
        $missing++
    }
}

Write-Host ""
Write-Host "Supprimés : $deleted"
Write-Host "Déjà absents : $missing"
Write-Host "Total attendu : $($files.Count)"
