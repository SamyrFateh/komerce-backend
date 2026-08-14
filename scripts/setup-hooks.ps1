$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $root) {
    Write-Host 'Hors depot Git - hooks Komerce inchanges.'
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
        Write-Host "Hook personnel conserve: $Path"
        return
    }

    $backup = "$Path.komerce-paused"
    if (-not (Test-Path $backup)) {
        Move-Item -Force $Path $backup
        Write-Host "Ancien hook Komerce sauvegarde: $backup"
    } else {
        Remove-Item -Force $Path
        Write-Host 'Ancien hook Komerce retire; sauvegarde deja presente.'
    }
}

Pause-KomerceHook $prePush

if ((Test-Path $preCommit) -and -not (Test-KomerceHook $preCommit)) {
    Write-Host 'Hook pre-commit personnel detecte - installation Komerce ignoree.'
    Write-Host "Fichier conserve: $preCommit"
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
        Write-Host ("ECHEC {0} ({1} ms)" -f $Label, $timer.ElapsedMilliseconds)
        if ($output) { $output | ForEach-Object { Write-Host $_ } }
        exit $rc
    }

    Write-Host ("OK {0} ({1} ms)" -f $Label, $timer.ElapsedMilliseconds)
}

$total = [System.Diagnostics.Stopwatch]::StartNew()
$staged = @(& git diff --cached --name-only --diff-filter=ACMR)
$stagedText = $staged -join "`n"

if ([string]::IsNullOrWhiteSpace($stagedText)) {
    Write-Host 'OK Pre-commit Komerce rapide : aucun fichier staged.'
    exit 0
}

if ($stagedText -match '\.(js|cjs|mjs)(\r?$|\n)') {
    Invoke-Gate -Label 'Qualite JS' -Command 'node' -Arguments @('scripts/code-quality-gate.js', '--strict')
}

if ($stagedText -match '(?m)^(server\.js|(?:routes|services|middleware|utils|scripts|config)/.+\.(?:js|cjs|mjs))$') {
    Invoke-Gate -Label 'Invariants backend' -Command 'node' -Arguments @('scripts/audit-backend-arch.js')
}

if ($stagedText -match '(?m)^public/.+\.(?:js|cjs|mjs)$') {
    Invoke-Gate -Label 'Sanitization front staged' -Command 'node' -Arguments @('scripts/arch-doctrine-sanitize-check.js')
}

if ($stagedText -match '(?m)^(features|capabilities|services|routes|migrations|middleware|utils|validators|core|bootstrap|db)/|^\.github/.+\.(?:yml|yaml|md)$') {
    Invoke-Gate -Label 'Feature Registry' -Command 'node' -Arguments @('scripts/feature-registry-targeted-check.js')
}

# N3-A - Fraicheur du dump, uniquement si une migration ou le dump live change.
# Les migrations post-snapshot sont volontairement acceptees par ce gate.
if ($stagedText -match '(?m)^migrations/.+\.sql$|^docs/db/railway-live-schema\.sql$') {
    Invoke-Gate -Label 'Schema freshness' -Command 'node' -Arguments @('scripts/check-schema-freshness.js')
}

# N3-B - Anti-resurrection seulement apres rafraichissement du dump live.
# Ne pas lancer sur une nouvelle migration DROP non encore deployee.
if ($stagedText -match '(?m)^docs/db/railway-live-schema\.sql$') {
    Invoke-Gate -Label 'Schema anti-resurrection' -Command 'node' -Arguments @('scripts/check-schema-resurrection.js')
}

$total.Stop()
Write-Host ("OK Pre-commit Komerce tiers 1-3 termine en {0} ms" -f $total.ElapsedMilliseconds)
exit 0
'@

$shim = @'
#!/bin/sh
# KOMERCE-HOOK v4 - PowerShell launcher
ROOT_WIN="$(git rev-parse --show-toplevel)"
exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT_WIN/.git/hooks/pre-commit.komerce.ps1"
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($preCommitPs1, $preCommitPowerShell, $utf8NoBom)
[System.IO.File]::WriteAllText($preCommit, $shim, $utf8NoBom)

Write-Host 'OK Hooks Komerce - niveaux 1-3 installes depuis PowerShell.'
Write-Host '   pre-commit : qualite JS + invariants + XSS + Feature Registry + schema cible'
Write-Host '   pre-push   : toujours desactive'
Write-Host '   lourds     : Carte First complet / CSS / 360 / meta / graphes toujours en pause'
Write-Host '   timings    : affiches gate par gate a chaque commit'