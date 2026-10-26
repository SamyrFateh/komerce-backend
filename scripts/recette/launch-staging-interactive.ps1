#Requires -Version 5.1
<#
.SYNOPSIS
  Lance Playwright UI localement contre Railway staging (aucun serveur local).
.DESCRIPTION
  Domaine / rôle / viewport séparés. Identifiants E2E demandés si absents
  des variables du processus et nettoyés à la sortie.
  Les scénarios côté dashboard bloquent les écritures HTTP dans Chromium.
.EXAMPLE
  .\scripts\recette\launch-staging-interactive.ps1 -Domain finance -Role finance -Device mobile
.EXAMPLE
  .\scripts\recette\launch-staging-interactive.ps1 -Domain operations -Role agent_hub -Mode debug
#>
[CmdletBinding()]
param(
  [ValidateSet('all','pilotage','commerce','commandes','sourcing','raffinerie','catalogue','publication','prix','operations','transit','finance','marches','administration')]
  [string]$Domain = 'all',
  [ValidateSet('admin','market_operator','finance','sourcing','agent_hub','agent_relais','agent_transitaire')]
  [string]$Role = 'admin',
  [ValidateSet('desktop','mobile','both')]
  [string]$Device = 'desktop',
  [ValidateSet('ui','manual','debug','headed','list')]
  [string]$Mode = 'ui'
)
$ErrorActionPreference='Stop'
$origin='https://komerce-backend-production.up.railway.app'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$prefix='E2E_'+$Role.ToUpperInvariant()+'_'
$emailKey=$prefix+'EMAIL'
$passwordKey=$prefix+'PASSWORD'
$names=@('E2E_STAGING_BASE_URL','E2E_EXPECTED_DEPLOY_SHA',
  'E2E_INTERACTIVE_ROLE','E2E_INTERACTIVE_DOMAIN','E2E_INTERACTIVE_DEVICE',
  'E2E_INTERACTIVE_HEADLESS','E2E_INTERACTIVE_PAUSE',$emailKey,$passwordKey)
$old=@{}
foreach($name in $names) {
  $old[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
}
Push-Location $root
try {
  if(-not (Test-Path 'node_modules\@playwright\test')){
    throw 'Exécutez npm ci à la racine du dépôt avant le premier lancement.'
  }
  [Environment]::SetEnvironmentVariable('E2E_STAGING_BASE_URL',$origin,'Process')
  [Environment]::SetEnvironmentVariable('E2E_INTERACTIVE_ROLE',$Role,'Process')
  [Environment]::SetEnvironmentVariable('E2E_INTERACTIVE_DOMAIN',$Domain,'Process')
  [Environment]::SetEnvironmentVariable('E2E_INTERACTIVE_DEVICE',$Device,'Process')
  [Environment]::SetEnvironmentVariable('E2E_INTERACTIVE_HEADLESS','0','Process')
  [Environment]::SetEnvironmentVariable('E2E_INTERACTIVE_PAUSE',$(if($Mode -eq 'manual'){'1'}else{'0'}),'Process')

  Write-Host ('Komerce — staging distant | Domaine: '+$Domain+' | Rôle: '+$Role+' | Écran: '+$Device)
  Write-Host 'Les actions HTTP de modification sont bloquées pendant la recette interactive.'
  if($Mode -eq 'list'){
    & npx.cmd playwright test --config=playwright.staging-interactive.config.js --list
    if($LASTEXITCODE -ne 0){throw 'Inventaire Playwright impossible.'}
    return
  }

  if(-not [Environment]::GetEnvironmentVariable($emailKey,'Process')) {
    $email=Read-Host ('Adresse du compte E2E '+$Role)
    if([string]::IsNullOrWhiteSpace($email))throw 'Email E2E obligatoire.'
    [Environment]::SetEnvironmentVariable($emailKey,$email.Trim(),'Process')
  }
  if(-not [Environment]::GetEnvironmentVariable($passwordKey,'Process')) {
    $secure=Read-Host ('Mot de passe E2E '+$Role) -AsSecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try{
      $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      if([string]::IsNullOrWhiteSpace($plain))throw 'Mot de passe E2E obligatoire.'
      [Environment]::SetEnvironmentVariable($passwordKey,$plain,'Process')
    }finally{
      if($ptr -ne [IntPtr]::Zero){
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
      }
      $plain=$null
    }
  }

  $head=(& git rev-parse HEAD)
  if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){
    throw 'Impossible de déterminer le SHA Git local.'
  }
  [Environment]::SetEnvironmentVariable('E2E_EXPECTED_DEPLOY_SHA',$head,'Process')
  Write-Host 'Vérification du SHA réellement déployé sur Railway...'
  & node scripts/recette/staging-chromium-deployment-preflight.js
  if($LASTEXITCODE -ne 0){
    throw 'Staging Git SHA différent du code local : test interrompu avant navigateur. Voir deployment-preflight.json.'
  }
  $proof=Get-Content 'test-results/staging-chromium/deployment-preflight.json' -Raw | ConvertFrom-Json
  if($proof.status -notin @('DEPLOY_SHA_MATCHED','DEPLOY_RUNTIME_EQUIVALENT')){
    throw 'Le staging ne correspond pas au code applicatif du dépôt.'
  }
  [Environment]::SetEnvironmentVariable('E2E_EXPECTED_DEPLOY_SHA',$proof.observed_sha,'Process')
  Write-Host ('SHA contrôlé : '+$proof.observed_sha.Substring(0,12))
  Write-Host 'Sélectionnez un scénario dans Playwright UI; les preuves restent sur ce PC.'

  $pwArgs=@('playwright','test','--config=playwright.staging-interactive.config.js')
  switch($Mode){
    'ui' {$pwArgs+='--ui'}
    'manual' {$pwArgs+='--debug'}
    'debug' {$pwArgs+='--debug'}
    'headed' {$pwArgs+='--headed'}
  }
  & npx.cmd @pwArgs
  if($LASTEXITCODE -ne 0){throw ('Playwright a échoué (code '+$LASTEXITCODE+').')}
}finally{
  foreach($name in $names){
    [Environment]::SetEnvironmentVariable($name,$old[$name],'Process')
  }
  Pop-Location
}
