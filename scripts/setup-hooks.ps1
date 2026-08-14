$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $root) {
    Write-Host '⚠️  Hors dépôt Git — hooks Komerce inchangés.'
    exit 0
}

$hooksDir = Join-Path $root '.git\hooks'
$preCommit = Join-Path $hooksDir 'pre-commit'
$preCommitPs1 = Join-Path $hooksDir 'pre-commit.komerce.ps1'
$prePush = Join-Path $hooksDir 'pre-push'
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

function Test-KomerceHook {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    return [bool](Select-String -Path $Path -Pattern 'KOMERCE-HOOK|Coffre-fort Komerce|reprise gouvernance' -Quiet -ErrorAction SilentlyContinue)
}

function Pause-KomerceHook {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    if (-not (Test-KomerceHook $Path)) {
        Write-Host "↪ Hook personnel conservé: $Path"
        return
    }

    $backup = "$Path.komerce-paused"
    if (-not (Test-Path $backup)) {
        Move-Item -Force $Path $backup
        Write-Host "⏸ Ancien hook Komerce sauvegardé: $backup"
    } else {
        Remove-Item -Force $Path
        Write-Host '⏸ Ancien hook Komerce retiré; sauvegarde déjà présente.'
    }
}

# Le coffre-fort pre-push historique reste volontairement en pause.
Pause-KomerceHook $prePush

# Ne jamais écraser un hook personnel.
if ((Test-Path $preCommit) -and -not (Test-KomerceHook $preCommit)) {
    Write-Host '⚠️  Hook pre-commit personnel détecté — installation Komerce ignorée.'
    Write-Host "   Fichier conservé: $preCommit"
    exit 0
}

$preCommitPowerShell = @'
$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel).Trim()
Set-Location $root

function Invoke-Gate {
    param(
        [Parameter(Mandatory=$true)][string]$Label,
        [Parameter(Mandatory=$true)][string]$Command,
        [string[]]$Arguments = @()
    )

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $output = & $Command @Arguments 2>&1
    $rc = $LASTEXITCODE
    $timer.Stop()

    if ($rc -ne 0) {
        Write-Host ("❌ {0} — échec ({1} ms)" -f $Label, $timer.ElapsedMilliseconds)
        if ($output) { $output | ForEach-Object { Write-Host $_ } }
        exit $rc
    }

    Write-Host ("✅ {0} ({1} ms)" -f $Label, $timer.ElapsedMilliseconds)
}

$total = [System.Diagnostics.Stopwatch]::StartNew()
$staged = @(& git diff --cached --name-only --diff-filter=ACMR)
$stagedText = $staged -join "`n"

if ([string]::IsNullOrWhiteSpace($stagedText)) {
    Write-Host '✅ Pre-commit Komerce rapide : aucun fichier staged.'
    exit 0
}

# N1-A — Qualité JS statique.
if ($stagedText -match '\.(js|cjs|mjs)(\r?$|\n)') {
    Invoke-Gate -Label 'Qualité JS' -Command 'node' -Arguments @('scripts/code-quality-gate.js', '--strict')
}

# N1-B — Invariants backend.
if ($stagedText -match '(?m)^(server\.js|(?:routes|services|middleware|utils|scripts|config)/.+\.(?:js|cjs|mjs))$') {
    Invoke-Gate -Label 'Invariants backend' -Command 'node' -Arguments @('scripts/audit-backend-arch.js')
}

# N1-C — XSS prouvable sur les seules lignes front staged.
if ($stagedText -match '(?m)^public/.+\.(?:js|cjs|mjs)$') {
    Invoke-Gate -Label 'Sanitization front staged' -Command 'node' -Arguments @('scripts/arch-doctrine-sanitize-check.js')
}

$total.Stop()
Write-Host ("⚡ Pre-commit Komerce tier 1 terminé en {0} ms" -f $total.ElapsedMilliseconds)
exit 0
'@

$shim = @'
#!/bin/sh
# KOMERCE-HOOK v2 — PowerShell launcher
ROOT_WIN="$(git rev-parse --show-toplevel)"
exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT_WIN/.git/hooks/pre-commit.komerce.ps1"
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($preCommitPs1, $preCommitPowerShell, $utf8NoBom)
[System.IO.File]::WriteAllText($preCommit, $shim, $utf8NoBom)

Write-Host '✅ Hooks Komerce — niveau 1 installé depuis PowerShell.'
Write-Host '   pre-commit : qualité JS + invariants backend + XSS staged'
Write-Host '   pre-push   : toujours désactivé'
Write-Host '   lourds     : Carte First / DB / CSS / 360 / meta toujours en pause'
Write-Host '   timings    : affichés à chaque commit'
