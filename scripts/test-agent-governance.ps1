[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$modulePath = Join-Path $PSScriptRoot "AgentGovernance.psm1"

Import-Module $modulePath -Force -ErrorAction Stop

$root = Get-AgRoot
$dashboard = Update-AgDashboard -Root $root

Write-Host "Agent governance module loaded successfully."
Write-Host "Project root: $root"
Write-Host "Dashboard: $dashboard"
