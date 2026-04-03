param(
  [switch]$Apply,
  [int]$TempOlderThanDays = 3,
  [switch]$IncludePlaywright,
  [switch]$IncludeWhisper
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DirBytes {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [int64]0
  }
  $files = Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue
  if (-not $files) {
    return [int64]0
  }
  return [int64](($files | Measure-Object -Property Length -Sum).Sum)
}

function To-GB {
  param([int64]$Bytes)
  return [math]::Round(($Bytes / 1GB), 2)
}

function Remove-ChildrenSafely {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "skip remove: $($_.FullName) :: $($_.Exception.Message)"
    }
  }
}

function Remove-TempOlderThan {
  param(
    [string]$Path,
    [datetime]$Cutoff
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.LastWriteTime -lt $Cutoff
  } | ForEach-Object {
    try {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "skip temp remove: $($_.FullName) :: $($_.Exception.Message)"
    }
  }
}

$userProfile = [Environment]::GetFolderPath('UserProfile')
$targets = @(
  [pscustomobject]@{
    Name = 'pip-cache'
    Path = Join-Path $userProfile 'AppData\Local\pip\Cache'
    Mode = 'children'
    Enabled = $true
  }
  [pscustomobject]@{
    Name = 'npm-cache'
    Path = Join-Path $userProfile 'AppData\Local\npm-cache'
    Mode = 'children'
    Enabled = $true
  }
  [pscustomobject]@{
    Name = 'crash-dumps'
    Path = Join-Path $userProfile 'AppData\Local\CrashDumps'
    Mode = 'children'
    Enabled = $true
  }
  [pscustomobject]@{
    Name = 'temp-older'
    Path = Join-Path $userProfile 'AppData\Local\Temp'
    Mode = 'temp'
    Enabled = $true
  }
  [pscustomobject]@{
    Name = 'whisper-cache'
    Path = Join-Path $userProfile '.cache\whisper'
    Mode = 'children'
    Enabled = [bool]$IncludeWhisper
  }
  [pscustomobject]@{
    Name = 'playwright-cache'
    Path = Join-Path $userProfile 'AppData\Local\ms-playwright'
    Mode = 'children'
    Enabled = [bool]$IncludePlaywright
  }
)

$cutoff = (Get-Date).AddDays(-1 * $TempOlderThanDays)
$results = @()

foreach ($target in $targets) {
  if (-not $target.Enabled) {
    continue
  }
  $before = Get-DirBytes -Path $target.Path
  if ($Apply) {
    if ($target.Mode -eq 'children') {
      Remove-ChildrenSafely -Path $target.Path
    } elseif ($target.Mode -eq 'temp') {
      Remove-TempOlderThan -Path $target.Path -Cutoff $cutoff
    }
  }
  $after = Get-DirBytes -Path $target.Path
  $removed = if ($before -gt $after) { [int64]($before - $after) } else { [int64]0 }
  $results += [pscustomobject]@{
    Name = $target.Name
    Path = $target.Path
    BeforeGB = To-GB -Bytes $before
    AfterGB = To-GB -Bytes $after
    RemovedGB = To-GB -Bytes $removed
    Applied = [bool]$Apply
  }
}

$results | Sort-Object RemovedGB -Descending | Format-Table -AutoSize
$totalRemoved = [int64](($results | Measure-Object -Property RemovedGB -Sum).Sum)
Write-Host ""
Write-Host ("total_removed_gb={0}" -f [math]::Round($totalRemoved, 2))
if (-not $Apply) {
  Write-Host "dry-run only; re-run with -Apply to remove files."
}
