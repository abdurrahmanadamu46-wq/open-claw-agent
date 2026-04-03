param(
  [Parameter(Mandatory = $false)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string]$Profile = 'dev',
  [Parameter(Mandatory = $false)]
  [ValidateSet('up', 'down', 'config', 'ps', 'logs')]
  [string]$Action = 'config'
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

$overlay = "infra/compose/$Profile.yml"
if (-not (Test-Path $overlay)) {
  throw "Compose overlay not found: $overlay"
}

$baseArgs = @('-f', 'docker-compose.yml', '-f', $overlay)

switch ($Action) {
  'up' { docker compose @baseArgs up -d }
  'down' { docker compose @baseArgs down }
  'config' { docker compose @baseArgs config }
  'ps' { docker compose @baseArgs ps }
  'logs' { docker compose @baseArgs logs -f }
}

if ($LASTEXITCODE -ne 0) {
  throw "compose profile command failed"
}
