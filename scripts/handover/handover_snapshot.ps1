param(
  [string]$OutputPath = "docs/handover/runtime-snapshot.json",
  [int]$MaxChangedFiles = 80
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\\..")
Set-Location $repoRoot

function Get-GitBranch {
  try {
    return (git rev-parse --abbrev-ref HEAD).Trim()
  } catch {
    return ""
  }
}

function Get-GitDirtySummary {
  try {
    $rows = git status --short
    $count = if ($rows) { ($rows | Measure-Object).Count } else { 0 }
    return @{
      total = $count
      sample = @($rows | Select-Object -First $MaxChangedFiles)
    }
  } catch {
    return @{ total = -1; sample = @() }
  }
}

function Get-TodoSignals {
  $patterns = "TODO|FIXME|stub|SKIP_TEMP"
  try {
    $rows = git grep -n -I -E $patterns -- backend/src web/src dragon-senate-saas-v2 apps/desktop-client/src-tauri/src
    return @($rows | Select-Object -First 200)
  } catch {
    return @()
  }
}

function Get-DockerPs {
  try {
    $rows = docker compose ps
    return @($rows)
  } catch {
    return @()
  }
}

$snapshot = [ordered]@{
  generated_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
  machine = $env:COMPUTERNAME
  repo_root = "$repoRoot"
  git = [ordered]@{
    branch = Get-GitBranch
    dirty = Get-GitDirtySummary
  }
  docker = [ordered]@{
    compose_ps = Get-DockerPs
  }
  todo_signals = Get-TodoSignals
  quick_commands = [ordered]@{
    up_control = "npm run module:up:control"
    status = "npm run module:ps"
    release_test = "npm run module:test:release"
    backup = "npm run backup:f:sync"
  }
}

$outAbs = Join-Path $repoRoot $OutputPath
$outDir = Split-Path -Parent $outAbs
if (!(Test-Path $outDir)) {
  New-Item -Path $outDir -ItemType Directory -Force | Out-Null
}

$json = $snapshot | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($outAbs, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "[handover] snapshot written: $outAbs"

