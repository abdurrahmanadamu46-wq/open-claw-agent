param(
    [string]$OutDir = ".\\dist-desktop",
    [switch]$BootstrapWithDragon = $false,
    [switch]$FirstRunInit = $false
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $workspace "..")).Path
$desktopRoot = Join-Path $repoRoot "apps\\desktop-client"
$dragonScript = Join-Path $workspace "dragon"

Write-Host "[desktop] build target: $desktopRoot"
Write-Host "[desktop] ClawX-grade path: runtime sync -> tauri build -> bundle export"

if (($BootstrapWithDragon -or $FirstRunInit) -and (Test-Path $dragonScript)) {
    if ($FirstRunInit) {
        Write-Host "[desktop] first-run init requested, running: dragon init"
        & bash $dragonScript init
    }
    elseif ($BootstrapWithDragon) {
        Write-Host "[desktop] bootstrap requested, running: dragon dev"
        & bash $dragonScript dev
    }
}

if (-not (Test-Path $desktopRoot)) {
    throw "Desktop client not found: $desktopRoot"
}

Push-Location $desktopRoot
try {
    npm install
    npm run runtime:sync
    npm run tauri:build

    $bundleRoot = Join-Path $desktopRoot "src-tauri\\target\\release\\bundle"
    if (-not (Test-Path $bundleRoot)) {
        throw "bundle output not found: $bundleRoot"
    }

    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    Copy-Item "$bundleRoot\\*" -Destination $OutDir -Recurse -Force
    Write-Host "[desktop] build complete: $OutDir"
}
finally {
    Pop-Location
}
