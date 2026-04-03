param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,
  [string[]]$StopProcessNames = @(),
  [string]$RestartExecutable = "",
  [switch]$CleanupBackup
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) {
  Write-Host "[migrate-dir] $msg"
}

function Get-DirBytes([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return [int64]0
  }
  $files = Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue
  if (-not $files) {
    return [int64]0
  }
  return [int64](($files | Measure-Object -Property Length -Sum).Sum)
}

function Is-ReparsePoint([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  $item = Get-Item -LiteralPath $Path -Force
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "SourcePath not found: $SourcePath"
}

if (Is-ReparsePoint $SourcePath) {
  throw "SourcePath is already a reparse point: $SourcePath"
}

$targetParent = Split-Path -Parent $TargetPath
if (-not (Test-Path -LiteralPath $targetParent)) {
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $TargetPath)) {
  New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
}

foreach ($processName in $StopProcessNames) {
  try {
    Get-Process -Name $processName -ErrorAction Stop | Stop-Process -Force
    Write-Info "Stopped process: $processName"
  } catch {
    Write-Info "Process not running or already stopped: $processName"
  }
}

$sourceSize = Get-DirBytes $SourcePath
Write-Info ("Source size: {0} GB" -f [math]::Round(($sourceSize / 1GB), 2))
Write-Info "Copying to target..."
robocopy $SourcePath $TargetPath /MIR /R:1 /W:1 /NFL /NDL /NP /NJH /NJS /MT:16 | Out-Null
$copyExit = $LASTEXITCODE
if ($copyExit -ge 8) {
  throw "robocopy failed with exit code $copyExit"
}

$backupPath = "${SourcePath}.bak"
if (Test-Path -LiteralPath $backupPath) {
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $backupPath = "${SourcePath}.bak.$stamp"
}

Write-Info "Renaming source to backup..."
Rename-Item -LiteralPath $SourcePath -NewName (Split-Path -Leaf $backupPath)

Write-Info "Creating junction..."
cmd /c "mklink /J `"$SourcePath`" `"$TargetPath`"" | Out-Null

if (-not (Is-ReparsePoint $SourcePath)) {
  throw "Failed to create junction at $SourcePath"
}

if ($CleanupBackup) {
  Write-Info "Removing backup folder..."
  Remove-Item -LiteralPath $backupPath -Recurse -Force
}

if ($RestartExecutable -and (Test-Path -LiteralPath $RestartExecutable)) {
  Write-Info "Restarting executable..."
  Start-Process -FilePath $RestartExecutable | Out-Null
}

$targetSize = Get-DirBytes $TargetPath
Write-Info ("Target size: {0} GB" -f [math]::Round(($targetSize / 1GB), 2))
Write-Info "Migration complete."
