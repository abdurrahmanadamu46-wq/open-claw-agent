param(
  [ValidateSet('start', 'stop', 'status', 'restart')]
  [string]$Action = 'status',
  [string]$NodeId = 'WIN-4070TI-LOCAL-001',
  [string]$EnvFile = 'scripts/vip-build/.env.vip'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

$runtimeScript = Join-Path $root 'scripts\vip-build\vip-lobster-entry.cjs'
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $root $EnvFile }
$logsDir = Join-Path $root 'logs'
$pidDir = Join-Path $root 'run'
$stdoutLog = Join-Path $logsDir "$NodeId.out.log"
$stderrLog = Join-Path $logsDir "$NodeId.err.log"
$pidFile = Join-Path $pidDir "$NodeId.pid"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

function Get-TrackedProcess {
  if (-not (Test-Path $pidFile)) { return $null }
  $raw = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $raw) { return $null }
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) { return $null }
  return Get-Process -Id $pidValue -ErrorAction SilentlyContinue
}

function Remove-Tracking {
  if (Test-Path $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

function Show-Status {
  $proc = Get-TrackedProcess
  if ($null -eq $proc) {
    Write-Output "local lobster [$NodeId] status=stopped"
  } else {
    Write-Output "local lobster [$NodeId] status=running pid=$($proc.Id)"
  }
  if (Test-Path $stdoutLog) {
    Write-Output ''
    Write-Output 'stdout tail:'
    Get-Content $stdoutLog -Tail 20
  }
  if (Test-Path $stderrLog) {
    $errContent = Get-Content $stderrLog -Tail 20
    if ($errContent) {
      Write-Output ''
      Write-Output 'stderr tail:'
      $errContent
    }
  }
}

function Stop-Lobster {
  $proc = Get-TrackedProcess
  if ($null -eq $proc) {
    Remove-Tracking
    Write-Output "local lobster [$NodeId] already stopped"
    return
  }
  Stop-Process -Id $proc.Id -Force
  Start-Sleep -Milliseconds 400
  Remove-Tracking
  Write-Output "local lobster [$NodeId] stopped pid=$($proc.Id)"
}

function Start-Lobster {
  if (-not (Test-Path $envPath)) {
    throw "Env file not found: $envPath"
  }
  $existing = Get-TrackedProcess
  if ($null -ne $existing) {
    Write-Output "local lobster [$NodeId] already running pid=$($existing.Id)"
    return
  }
  if (Test-Path $stdoutLog) { Remove-Item -LiteralPath $stdoutLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path $stderrLog) { Remove-Item -LiteralPath $stderrLog -Force -ErrorAction SilentlyContinue }
  $proc = Start-Process `
    -FilePath node `
    -ArgumentList @($runtimeScript, '--env-file', $envPath) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  Set-Content -LiteralPath $pidFile -Value $proc.Id
  Start-Sleep -Seconds 3
  Write-Output "local lobster [$NodeId] started pid=$($proc.Id)"
  Show-Status
}

switch ($Action) {
  'start' { Start-Lobster }
  'stop' { Stop-Lobster }
  'restart' {
    Stop-Lobster
    Start-Lobster
  }
  'status' { Show-Status }
}
