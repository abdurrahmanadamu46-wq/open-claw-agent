param(
    [string]$TargetRoot = "F:\openclaw-agent\docker-data\wsl",
    [string]$SourceRoot = "$env:LOCALAPPDATA\Docker\wsl",
    [switch]$CleanupBackup,
    [switch]$NoStartDocker
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) {
    Write-Host "[docker-data-pin] $msg"
}

function Stop-DockerStack {
    Write-Info "Stopping containers/processes and WSL..."
    try {
        $ids = docker ps -q
        if ($ids) {
            $ids | ForEach-Object { docker stop $_ | Out-Null }
        }
    } catch {
        Write-Info "Docker daemon is not running, skip container stop."
    }

    $processes = @(
        "Docker Desktop",
        "com.docker.backend",
        "com.docker.proxy",
        "vpnkit",
        "dockerd"
    )
    foreach ($name in $processes) {
        try {
            Get-Process -Name $name -ErrorAction Stop | Stop-Process -Force
        } catch {
            # ignore not found
        }
    }

    try {
        wsl --shutdown | Out-Null
    } catch {
        Write-Info "wsl --shutdown failed, continue."
    }
}

function Ensure-Directory([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

function Is-Junction([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return $false
    }
    $item = Get-Item -LiteralPath $path -Force
    return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Ensure-TargetHasData([string]$path) {
    if (-not (Test-Path -LiteralPath (Join-Path $path "disk\docker_data.vhdx"))) {
        throw "Target '$path' does not contain disk\docker_data.vhdx. Stop to avoid data loss."
    }
}

Write-Info "Source: $SourceRoot"
Write-Info "Target: $TargetRoot"

Ensure-Directory -path $TargetRoot

if (Is-Junction $SourceRoot) {
    Write-Info "Source is already a junction. No migration needed."
    $srcItem = Get-Item -LiteralPath $SourceRoot -Force
    Write-Info "Current target: $($srcItem.Target)"
    exit 0
}

if (-not (Test-Path -LiteralPath $SourceRoot)) {
    throw "Source '$SourceRoot' does not exist."
}

Stop-DockerStack

Write-Info "Copying Docker WSL data to target (robocopy /MIR)..."
robocopy $SourceRoot $TargetRoot /MIR /R:1 /W:1 /NFL /NDL /NP /NJH /NJS /MT:16 | Out-Null
$copyExit = $LASTEXITCODE
if ($copyExit -ge 8) {
    throw "robocopy failed with exit code $copyExit"
}

Ensure-TargetHasData -path $TargetRoot

$backupRoot = "${SourceRoot}.bak"
if (Test-Path -LiteralPath $backupRoot) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $backupRoot = "${SourceRoot}.bak.$timestamp"
}

Write-Info "Renaming source to backup: $backupRoot"
Rename-Item -LiteralPath $SourceRoot -NewName (Split-Path -Leaf $backupRoot)

Write-Info "Creating junction: $SourceRoot -> $TargetRoot"
cmd /c "mklink /J `"$SourceRoot`" `"$TargetRoot`"" | Out-Null

if (-not (Is-Junction $SourceRoot)) {
    throw "Failed to create junction on '$SourceRoot'"
}

if (-not $NoStartDocker) {
    Write-Info "Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" | Out-Null
}

Write-Info "Waiting for docker info..."
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
    try {
        docker info | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
    } catch {
        # ignore
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Info "Docker did not become ready in time. Start it manually and verify."
}

if ($CleanupBackup) {
    Write-Info "Cleanup backup folder: $backupRoot"
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
}

$driveC = Get-PSDrive C
$driveF = Get-PSDrive F
Write-Info ("Done. C free: {0} GB | F free: {1} GB" -f [math]::Round($driveC.Free / 1GB, 2), [math]::Round($driveF.Free / 1GB, 2))
