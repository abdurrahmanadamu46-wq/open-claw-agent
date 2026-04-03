param(
  [string]$ComfyRoot = "F:\ComfyUI-aki\ComfyUI-latest",
  [ValidateSet("latest","lock")]
  [string]$Mode = "latest",
  [switch]$SkipPip
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $PSScriptRoot "comfy_nodes_oneclick.py"

if (!(Test-Path $ScriptPath)) {
  throw "Missing script: $ScriptPath"
}

$Python = Join-Path $ComfyRoot ".venv\Scripts\python.exe"
if (!(Test-Path $Python)) {
  $Python = "python"
}

$argsList = @(
  $ScriptPath,
  "--comfy-root", $ComfyRoot,
  "--mode", $Mode
)
if ($SkipPip) {
  $argsList += "--skip-pip"
}

Write-Host ">>> Running ComfyUI node one-click bootstrap..."
Write-Host ">>> Python: $Python"
Write-Host ">>> ComfyRoot: $ComfyRoot"
& $Python @argsList
if ($LASTEXITCODE -ne 0) {
  throw "comfy_nodes_oneclick.py failed with exit code $LASTEXITCODE"
}

Write-Host ">>> Done. Use data/comfy_gray.env for gray enable flags."

