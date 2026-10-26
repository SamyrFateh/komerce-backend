#Requires -Version 5.1
<#
.SYNOPSIS
  Pilote P1 20 produits : Sourcing -> Raffinerie -> Catalogue -> KM -> Boutique,
  dans Chromium sur le staging Railway réel.
.EXAMPLE
  .\scripts\recette\launch-p1-twenty.ps1 -Stage sourcing -Mode inspect
.EXAMPLE
  .\scripts\recette\launch-p1-twenty.ps1 -Stage catalogue -Mode curate
#>
[CmdletBinding()]
param(
  [ValidateSet('all','sourcing','raffinerie','catalogue','marche','prix','boutique')]
  [string]$Stage='sourcing',
  [ValidateSet('desktop','mobile')]
  [string]$Device='desktop',
  [ValidateSet('audit','inspect','curate')]
  [string]$Mode='inspect'
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hostUrl='https://komerce-backend-production.up.railway.app'
$steps=@{
  sourcing=@{filter='01-sourcing';role='sourcing'}
  raffinerie=@{filter='02-raffinerie';role='sourcing'}
  catalogue=@{filter='03-catalogue-global';role='admin'}
  marche=@{filter='04-decision-marche';role='market_operator'}
  prix=@{filter='05-prix-local';role='market_operator'}
  boutique=@{filter='06-boutique';role=''}
}
$roles=if($Stage -eq 'all') {
  @('sourcing','admin','market_operator')
} elseif($steps[$Stage].role) {
  @($steps[$Stage].role)
} else {@()}
$names=@('E2E_STAGING_BASE_URL','STAGING_BASE_URL','KOMERCE_ENV',
  'E2E_EXPECTED_DEPLOY_SHA','E2E_P1_20_INTERACTIVE',
  'E2E_P1_20_HUMAN_MODE','E2E_P1_20_EXPLICIT_ACK')
foreach($role in $roles) {
  $names+=@('E2E_'+$role.ToUpperInvariant()+'_EMAIL',
    'E2E_'+$role.ToUpperInvariant()+'_PASSWORD')
}
$prior=@{}
foreach($key in $names){
  $prior[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
}
Push-Location $root
try {
  if(-not (Test-Path 'node_modules\@playwright\test')){
    throw 'Installer les modules à la racine : npm ci'
  }

  Write-Host ('P1-20 | Staging Railway | Étape '+$Stage+' | '+$Device+' | '+$Mode)
  Write-Host 'La campagne ne change jamais le catalogue par SQL ni par seed.'
  [Environment]::SetEnvironmentVariable('KOMERCE_ENV','staging','Process')
  [Environment]::SetEnvironmentVariable('E2E_STAGING_BASE_URL',$hostUrl,'Process')
  [Environment]::SetEnvironmentVariable('STAGING_BASE_URL',$hostUrl,'Process')
  [Environment]::SetEnvironmentVariable('E2E_P1_20_INTERACTIVE',
    $(if($Mode -eq 'audit'){'0'}else{'1'}),'Process')
  [Environment]::SetEnvironmentVariable('E2E_P1_20_HUMAN_MODE',
    $(if($Mode -eq 'curate'){'curate'}else{'read-only'}),'Process')

  if($Mode -eq 'curate'){
    Write-Warning 'Mode MODIFIANT : seuls les gestes humains P1 canoniques, pour KM, sont autorisés.'
    Write-Warning 'Chaque action est définitive et auditée sur le vrai staging. Aucun prix automatique.'
    $ack=Read-Host 'Pour autoriser les décisions humaines, saisir EXACTEMENT YES_P1_20_KM_HUMAN_DECISIONS'
    if($ack -cne 'YES_P1_20_KM_HUMAN_DECISIONS') {
      throw 'CURATION_NOT_APPROVED'
    }
    [Environment]::SetEnvironmentVariable('E2E_P1_20_EXPLICIT_ACK',$ack,'Process')
  }else{
    [Environment]::SetEnvironmentVariable('E2E_P1_20_EXPLICIT_ACK',$null,'Process')
  }

  foreach($role in $roles){
    $pfx='E2E_'+$role.ToUpperInvariant()+'_'
    $emailKey=$pfx+'EMAIL'
    $passwordKey=$pfx+'PASSWORD'
    if(-not [Environment]::GetEnvironmentVariable($emailKey,'Process')){
      $email=Read-Host ('Email du seul compte de recette '+$role)
      if([string]::IsNullOrWhiteSpace($email))throw 'TEST_IDENTITY_EMAIL_REQUIRED'
      [Environment]::SetEnvironmentVariable($emailKey,$email.Trim(),'Process')
    }
    if(-not [Environment]::GetEnvironmentVariable($passwordKey,'Process')){
      $pw=Read-Host ('Mot de passe E2E '+$role) -AsSecureString
      $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
      try {
        $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if([string]::IsNullOrWhiteSpace($plain))throw 'TEST_PASSWORD_REQUIRED'
        [Environment]::SetEnvironmentVariable($passwordKey,$plain,'Process')
      }finally {
        if($pointer -ne [IntPtr]::Zero){
          [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
        $plain=$null
      }
    }
  }

  $head=(& git rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){
    throw 'GIT_SHA_UNAVAILABLE'
  }
  [Environment]::SetEnvironmentVariable('E2E_EXPECTED_DEPLOY_SHA',$head,'Process')
  & node scripts/recette/staging-chromium-deployment-preflight.js
  if($LASTEXITCODE -ne 0)throw 'STAGING_NOT_ON_VERIFIED_RUNTIME'
  $preflight=Get-Content 'test-results/staging-chromium/deployment-preflight.json' -Raw | ConvertFrom-Json
  if($preflight.status -notin @('DEPLOY_SHA_MATCHED','DEPLOY_RUNTIME_EQUIVALENT')){
    throw 'STAGING_SHA_UNVERIFIED'
  }
  [Environment]::SetEnvironmentVariable('E2E_EXPECTED_DEPLOY_SHA',$preflight.observed_sha,'Process')
  Write-Host ('SHA réellement déployé : '+$preflight.observed_sha)

  $args=@('playwright','test','--config=playwright.staging-p1-20.config.js',
    '--project',('P1-20 '+$Device))
  if($Stage -ne 'all'){$args+=@('--grep',$steps[$Stage].filter)}
  if($Mode -ne 'audit'){$args+='--debug'}
  Write-Host 'Chromium ouvert. Pendant une pause, cliquer sur Resume pour enregistrer la preuve.'
  & npx.cmd @args
  if($LASTEXITCODE -ne 0){
    throw 'P1_20_STAGE_NOT_PROVEN : inspecter test-results/staging-p1-20/html'
  }
}finally{
  foreach($key in $names){
    [Environment]::SetEnvironmentVariable($key,$prior[$key],'Process')
  }
  Pop-Location
}
