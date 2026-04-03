param(
  [ValidateSet('start', 'stop', 'status', 'restart', 'provision')]
  [string]$Action = 'status',
  [int]$Count = 9,
  [string]$TenantId = 'tenant_demo',
  [string]$BaseUrl = 'http://127.0.0.1:48789'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

$poolDir = Join-Path $PSScriptRoot 'nodes'
New-Item -ItemType Directory -Force -Path $poolDir | Out-Null

function New-FakeJwt([string]$tenantId, [string]$nodeId) {
  $headerJson = '{"alg":"HS256","typ":"JWT"}'
  $payloadJson = "{""sub"":""$nodeId"",""tenantId"":""$tenantId"",""roles"":[""agent_node""],""role"":""agent_node"",""exp"":4102444800}"
  $header = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($headerJson)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  return "$header.$payload.local"
}

function Get-NodeId([int]$index) {
  return ('WIN-4070TI-LOBSTER-{0:d2}' -f $index)
}

function Get-EnvFile([int]$index) {
  Join-Path $poolDir ("{0}.env.vip" -f (Get-NodeId $index))
}

function Write-EnvFile([int]$index) {
  $nodeId = Get-NodeId $index
  $token = New-FakeJwt -tenantId $TenantId -nodeId $nodeId
  $content = @"
C_AND_C_SERVER_URL=$BaseUrl
SOCKETIO_PATH=/fleet
CLIENT_DEVICE_TOKEN=$token
TENANT_ID=$TenantId
MACHINE_CODE=$nodeId
NODE_ID=$nodeId
APP_VERSION=0.1.0
AUTO_UPDATE_DOWNLOAD=false
AUTO_UPDATE_REQUIRE_SIGNATURE=false
"@
  Set-Content -LiteralPath (Get-EnvFile $index) -Value $content -Encoding UTF8
}

for ($i = 1; $i -le $Count; $i += 1) {
  if ($Action -in @('provision', 'start', 'restart')) {
    Write-EnvFile -index $i
  }
}

if ($Action -eq 'provision') {
  Write-Output "provisioned $Count local lobster env files under $poolDir"
  exit 0
}

for ($i = 1; $i -le $Count; $i += 1) {
  $nodeId = Get-NodeId $i
  $envFile = Get-EnvFile $i
  Write-Output ''
  Write-Output "=== $nodeId ==="
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'manage-local-lobster.ps1') `
    -Action $Action `
    -NodeId $nodeId `
    -EnvFile $envFile
}
