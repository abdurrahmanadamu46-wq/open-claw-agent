param(
  [string]$SourceRoot = "C:\Users\Administrator\Desktop\openclaw-agent",
  [string]$TargetRoot = "F:\openclaw-agent",
  [switch]$VerboseLog
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $SourceRoot)) {
  throw "SourceRoot not found: $SourceRoot"
}
if (!(Test-Path $TargetRoot)) {
  New-Item -Path $TargetRoot -ItemType Directory -Force | Out-Null
}

$excludeDirs = @(
  ".git",
  "node_modules",
  ".next",
  "dist",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  ".mypy_cache",
  ".ruff_cache",
  ".idea",
  ".vscode",
  "docker-data",
  "docker-wsl",
  ".playwright-browsers",
  ".npm-cache"
)

$excludeFiles = @(
  "*.pyc",
  "*.pyo",
  "*.pyd",
  "*.tmp",
  "*.log"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $SourceRoot "logs\backup"
if (!(Test-Path $logDir)) {
  New-Item -Path $logDir -ItemType Directory -Force | Out-Null
}
$logFile = Join-Path $logDir "sync-to-f-$timestamp.log"

$args = @(
  $SourceRoot,
  $TargetRoot,
  "/E",
  "/COPY:DAT",
  "/DCOPY:DAT",
  "/R:2",
  "/W:1",
  "/FFT",
  "/NP",
  "/XJ",
  "/XD"
) + $excludeDirs + @(
  "/XF"
) + $excludeFiles + @(
  "/LOG:$logFile"
)

if ($VerboseLog) {
  $args += "/V"
} else {
  $args += "/NFL"
  $args += "/NDL"
}

Write-Host "[backup] syncing code from $SourceRoot to $TargetRoot ..."
& robocopy @args | Out-Null
$code = $LASTEXITCODE

# Robocopy success codes: 0-7
if ($code -gt 7) {
  throw "Robocopy failed with exit code $code. See log: $logFile"
}

Write-Host "[backup] done (code=$code). log: $logFile"
