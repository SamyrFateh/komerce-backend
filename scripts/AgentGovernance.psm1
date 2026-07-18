Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-AgRoot {
    param([string]$StartPath = (Get-Location).Path)
    $current = Resolve-Path $StartPath
    while ($current) {
        if (Test-Path (Join-Path $current ".agent")) {
            return $current.Path
        }
        $parent = Split-Path $current -Parent
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
    throw "Impossible de trouver la racine du projet contenant .agent"
}

function Read-AgJson {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { throw "Fichier introuvable : $Path" }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-AgJson {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string]$Path
    )
    $json = $Object | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-AgTaskPaths {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$TaskId
    )
    if ($TaskId -notmatch '^T-\d{3}$') { throw "TaskId invalide : $TaskId" }
    return @{
        Task = Join-Path $Root ".agent\tasks\$TaskId.md"
        State = Join-Path $Root ".agent\state\$TaskId.json"
        Handoff = Join-Path $Root ".agent\handoffs\$TaskId.md"
        Evidence = Join-Path $Root ".agent\evidence\$TaskId"
        Runtime = Join-Path $Root ".agent\runtime\$TaskId.baseline.json"
    }
}

function Get-AgGitInfo {
    param([Parameter(Mandatory)][string]$Root)
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        return [pscustomobject]@{ Available=$false; Commit=$null; Clean=$null; Branch=$null; ChangedFiles=@() }
    }
    Push-Location $Root
    try {
        & git rev-parse --is-inside-work-tree *> $null
        if ($LASTEXITCODE -ne 0) {
            return [pscustomobject]@{ Available=$false; Commit=$null; Clean=$null; Branch=$null; ChangedFiles=@() }
        }
        $commit = (& git rev-parse HEAD).Trim()
        $branch = (& git branch --show-current).Trim()
        $status = @(& git status --porcelain)
        $changed = @($status | ForEach-Object {
            if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim() }
        } | Where-Object { $_ })
        return [pscustomobject]@{
            Available=$true
            Commit=$commit
            Clean=($status.Count -eq 0)
            Branch=$branch
            ChangedFiles=$changed
        }
    }
    finally { Pop-Location }
}

function Get-AgProjectInventory {
    param([Parameter(Mandatory)][string]$Root)
    $excludedDirNames = @(
        ".git","node_modules",".next","coverage",
        ".cache",".parcel-cache",".turbo","__pycache__"
    )
    $excludedPathParts = @(
        ".agent\runtime", ".agent\generated", ".agent\logs",
        ".agent\evidence", ".agent\changes"
    )
    $items = Get-ChildItem -LiteralPath $Root -File -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $full = $_.FullName
            $relative = [System.IO.Path]::GetRelativePath($Root, $full)
            $segments = $relative -split '[\\/]'
            -not ($segments | Where-Object { $excludedDirNames -contains $_ }) -and
            -not ($excludedPathParts | Where-Object { $relative -like "$_*" })
        }

    $inventory = @()
    foreach ($item in $items) {
        try {
            $hash = Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256
            $inventory += [pscustomobject]@{
                path = [System.IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\','/')
                sha256 = $hash.Hash.ToLowerInvariant()
                length = $item.Length
            }
        }
        catch {
            Write-Warning "Hash impossible pour $($item.FullName): $($_.Exception.Message)"
        }
    }
    return $inventory
}

function Compare-AgInventory {
    param($Before, $After)
    $b = @{}
    foreach ($x in $Before) { $b[$x.path] = $x.sha256 }
    $a = @{}
    foreach ($x in $After) { $a[$x.path] = $x.sha256 }

    $paths = @($b.Keys + $a.Keys | Sort-Object -Unique)
    $changes = @()
    foreach ($p in $paths) {
        if (-not $b.ContainsKey($p)) {
            $changes += [pscustomobject]@{ path=$p; change="ADDED" }
        }
        elseif (-not $a.ContainsKey($p)) {
            $changes += [pscustomobject]@{ path=$p; change="DELETED" }
        }
        elseif ($b[$p] -ne $a[$p]) {
            $changes += [pscustomobject]@{ path=$p; change="MODIFIED" }
        }
    }
    return $changes
}

function Add-AgAuditLog {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Action,
        [Parameter(Mandatory)][string]$TaskId,
        [string]$Actor,
        [string]$Details
    )
    $log = Join-Path $Root ".agent\logs\audit.ndjson"
    $entry = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        action = $Action
        task_id = $TaskId
        actor = $Actor
        details = $Details
    } | ConvertTo-Json -Compress
    Add-Content -LiteralPath $log -Value $entry -Encoding UTF8
}

function Update-AgDashboard {
    param([Parameter(Mandatory)][string]$Root)
    $stateDir = Join-Path $Root ".agent\state"
    $states = Get-ChildItem -LiteralPath $stateDir -Filter "T-*.json" |
        Where-Object { $_.Name -notlike "*TEMPLATE*" } |
        ForEach-Object { Read-AgJson $_.FullName } |
        Sort-Object task_id

    $lines = @()
    $lines += "# STATE — Tableau de bord généré"
    $lines += ""
    $lines += "> Ne pas éditer manuellement. Généré le $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))."
    $lines += ""
    $lines += "| ID | Statut | Priorité | Feature | Agent | Reviewer | Dépendances | Résumé |"
    $lines += "|---|---|---|---|---|---|---|---|"
    foreach ($s in $states) {
        $deps = if ($s.depends_on) { ($s.depends_on -join ", ") } else { "—" }
        $agent = if ($s.agent) { $s.agent } else { "—" }
        $reviewer = if ($s.reviewer) { $s.reviewer } else { "—" }
        $summary = if ($s.summary) { ($s.summary -replace '\|','/') } else { "—" }
        $lines += "| $($s.task_id) | $($s.status) | $($s.priority) | $($s.feature_id) | $agent | $reviewer | $deps | $summary |"
    }
    $lines += ""
    $groups = $states | Group-Object status | Sort-Object Name
    $lines += "## Synthèse"
    $lines += ""
    foreach ($g in $groups) { $lines += "- **$($g.Name)** : $($g.Count)" }

    $path = Join-Path $Root ".agent\generated\STATE.md"
    [System.IO.File]::WriteAllLines($path, $lines, [System.Text.UTF8Encoding]::new($false))
    return $path
}

Export-ModuleMember -Function *


# ---------------------------------------------------------------------------
# V2 — Compatibilité Windows PowerShell 5.1 et protocole de livraison
# ---------------------------------------------------------------------------

function Get-AgRelativePath {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$Path
    )
    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    $pathFull = [System.IO.Path]::GetFullPath($Path)

    if (-not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }

    $baseUri = New-Object System.Uri($baseFull)
    $pathUri = New-Object System.Uri($pathFull)
    $relative = $baseUri.MakeRelativeUri($pathUri).ToString()
    return [System.Uri]::UnescapeDataString($relative).Replace('/', '\')
}

function Normalize-AgPath {
    param([Parameter(Mandatory)][string]$Path)
    $normalized = $Path.Replace('\','/')
    while ($normalized.StartsWith("./")) {
        $normalized = $normalized.Substring(2)
    }
    return $normalized.TrimStart('/')
}

function Get-AgFileHashValue {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-AgPathAllowed {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$Patterns
    )
    $normalized = Normalize-AgPath $Path
    foreach ($patternValue in @($Patterns)) {
        if ([string]::IsNullOrWhiteSpace($patternValue)) { continue }
        $pattern = (Normalize-AgPath $patternValue)
        if ($pattern.EndsWith('/**')) {
            $prefix = $pattern.Substring(0, $pattern.Length - 3).TrimEnd('/')
            if ($normalized -eq $prefix -or $normalized.StartsWith($prefix + '/')) {
                return $true
            }
        }
        elseif ($normalized -like $pattern) {
            return $true
        }
        elseif ($normalized -eq $pattern) {
            return $true
        }
    }
    return $false
}

function Set-AgProperty {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string]$Name,
        $Value
    )
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Invoke-AgCommand {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Command
    )
    Push-Location $Root
    try {
        $cmdExe = Get-Command cmd.exe -ErrorAction SilentlyContinue
        if ($cmdExe) {
            $output = & cmd.exe /d /s /c $Command 2>&1
            $exitCode = $LASTEXITCODE
        }
        else {
            $shell = Get-Command pwsh -ErrorAction SilentlyContinue
            if (-not $shell) { $shell = Get-Command powershell -ErrorAction SilentlyContinue }
            if (-not $shell) { throw "Aucun shell compatible trouvé pour exécuter : $Command" }
            $output = & $shell.Source -NoProfile -Command $Command 2>&1
            $exitCode = $LASTEXITCODE
        }

        return [pscustomobject]@{
            command = $Command
            result = $(if ($exitCode -eq 0) { "PASS" } else { "FAIL" })
            exit_code = $exitCode
            output = ($output -join "`n")
        }
    }
    finally {
        Pop-Location
    }
}

function Get-AgProjectInventory {
    param([Parameter(Mandatory)][string]$Root)

    $excludedDirNames = @(
        ".git","node_modules",".next","coverage",
        ".cache",".parcel-cache",".turbo","__pycache__"
    )
    $excludedPrefixes = @(
        ".agent/runtime", ".agent/generated", ".agent/logs",
        ".agent/evidence", ".agent/changes", ".agent/deliveries"
    )

    $inventory = @()
    $items = Get-ChildItem -LiteralPath $Root -File -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $relative = (Get-AgRelativePath -BasePath $Root -Path $item.FullName).Replace('\','/')
        $segments = $relative -split '/'
        if (@($segments | Where-Object { $excludedDirNames -contains $_ }).Count -gt 0) {
            continue
        }

        $skip = $false
        foreach ($prefix in $excludedPrefixes) {
            if ($relative -eq $prefix -or $relative.StartsWith($prefix + "/")) {
                $skip = $true
                break
            }
        }
        if ($skip) { continue }

        try {
            $inventory += [pscustomobject]@{
                path = $relative
                sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                length = $item.Length
            }
        }
        catch {
            Write-Warning "Hash impossible pour $($item.FullName): $($_.Exception.Message)"
        }
    }
    return $inventory
}

Export-ModuleMember -Function *
