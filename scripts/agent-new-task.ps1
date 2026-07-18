[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^T-\d{3}$')][string]$TaskId,
    [Parameter(Mandatory)][string]$Title,
    [Parameter(Mandatory)][string]$FeatureId,
    [string]$FindingId,
    [ValidateSet("LOW","MEDIUM","HIGH","CRITICAL")][string]$Priority = "MEDIUM",
    [string[]]$DependsOn = @(),
    [string[]]$AllowedFiles = @(),
    [string[]]$ForbiddenFiles = @(),
    [string[]]$Gates = @()
)

Import-Module (Join-Path $PSScriptRoot "AgentGovernance.psm1") -Force -ErrorAction Stop
$root = Get-AgRoot
$paths = Get-AgTaskPaths -Root $root -TaskId $TaskId

if (Test-Path $paths.State) {
    $existing = Read-AgJson $paths.State
    if ($existing.status -ne "DRAFT" -or $existing.title -ne "À définir") {
        throw "$TaskId existe déjà et n'est pas un emplacement vide."
    }
}

$templatePath = Join-Path $root ".agent\tasks\T-000-TEMPLATE.md"
$content = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$content = $content.Replace("{{TASK_ID}}", $TaskId)
$content = $content.Replace("{{TITLE}}", $Title)
$content = $content.Replace("{{FEATURE_ID}}", $FeatureId)
$content = $content.Replace("{{FINDING_ID}}", $(if ($FindingId) { $FindingId } else { "—" }))
[System.IO.File]::WriteAllText($paths.Task, $content, [System.Text.UTF8Encoding]::new($false))

$state = [ordered]@{
    task_id = $TaskId
    title = $Title
    feature_id = $FeatureId
    finding_id = $FindingId
    status = "DRAFT"
    priority = $Priority
    depends_on = @($DependsOn)
    allowed_files = @($AllowedFiles)
    forbidden_files = @($ForbiddenFiles)
    gates = @($Gates)
    agent = $null
    reviewer = $null
    base_package_id = $null
    branch = $null
    started_at = $null
    lease_until = $null
    finished_at = $null
    reviewed_at = $null
    base_commit = $null
    last_commit = $null
    changed_files = @()
    gate_results = @()
    blocking_reason = $null
    review_decision = $null
    summary = $null
    next_action = $null
}
Write-AgJson -Object $state -Path $paths.State
New-Item -ItemType Directory -Path $paths.Evidence -Force | Out-Null
Add-AgAuditLog -Root $root -Action "TASK_CREATED" -TaskId $TaskId -Actor $env:USERNAME -Details $Title
Update-AgDashboard -Root $root | Out-Null
Write-Host "$TaskId créé en statut DRAFT."
Write-Host "Compléter $($paths.Task), puis passer manuellement le statut à READY après validation du planning."
