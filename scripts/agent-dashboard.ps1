[CmdletBinding()]
param()

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$path = Update-AgDashboard -Root $root
Write-Host "Dashboard généré : $path"
