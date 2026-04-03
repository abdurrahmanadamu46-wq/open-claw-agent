param(
    [string]$SourceRoot = "..\\..\\..\\dragon-senate-saas-v2",
    [string]$TargetRoot = "..\\runtime"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = (Resolve-Path (Join-Path $scriptDir $SourceRoot)).Path
$target = Join-Path $scriptDir $TargetRoot

Write-Host "[runtime:sync] source: $source"
Write-Host "[runtime:sync] target: $target"

if (-not (Test-Path $source)) {
    throw "Source runtime not found: $source"
}

if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

$copyItems = @(
    "dragon",
    "edge_agent.py",
    "VERSION",
    "updates",
    "SKILL.md",
    ".env.example"
)

foreach ($item in $copyItems) {
    $src = Join-Path $source $item
    if (-not (Test-Path $src)) {
        Write-Host "[runtime:sync] skip missing: $item"
        continue
    }
    Copy-Item -Path $src -Destination (Join-Path $target $item) -Recurse -Force
    Write-Host "[runtime:sync] copied: $item"
}

Write-Host "[runtime:sync] done."
