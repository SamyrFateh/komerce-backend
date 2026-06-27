<#
.SYNOPSIS
  Lance les checks carte-first depuis PowerShell.

.DESCRIPTION
  Mode bootstrap par défaut pour la CI et le travail local Windows.
  Ajouter -Strict pour vérifier le schéma cible complet des cartes feature.
#>
param(
  [switch]$Strict
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$featureArgs = @('scripts/feature-card-schema-check.js')
if ($Strict) {
  $featureArgs += '--strict'
}

$steps = @(
  @{ Command = 'node'; Args = $featureArgs },
  @{ Command = 'node'; Args = @('scripts/docs-history-lint.js') },
  @{ Command = 'node'; Args = @('scripts/touched-files-feature-gate.js') }
)

foreach ($step in $steps) {
  $label = $step.Command + ' ' + ($step.Args -join ' ')
  Write-Host "`n-- $label"
  & $step.Command @($step.Args)
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$mode = if ($Strict) { 'strict' } else { 'bootstrap' }
Write-Host "`nOK carte-first $mode checks."
