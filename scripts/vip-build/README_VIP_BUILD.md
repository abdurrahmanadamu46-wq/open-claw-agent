# VIP Client Build Guide

This folder contains the single-customer edge runtime build assets.

## 1. Prepare

```powershell
cd C:\path\to\openclaw-agent
copy scripts\vip-build\.env.vip.example scripts\vip-build\.env.vip
```

Edit `.env.vip`:

- `C_AND_C_SERVER_URL=http://<backend-host>:3000`
- `SOCKETIO_PATH=/fleet`
- `CLIENT_DEVICE_TOKEN=<jwt>`
- `MACHINE_CODE=<unique-node-id>`
- optional update:
  - `APP_VERSION=0.1.0`
  - `AUTO_UPDATE_MANIFEST_URL=http://<backend-host>:3000/api/v1/client-updates/latest?platform=win-x64&channel=stable`
  - `AUTO_UPDATE_DOWNLOAD=false`
  - `AUTO_UPDATE_REQUIRE_SIGNATURE=true`
  - `AUTO_UPDATE_DEFAULT_KEY_ID=default`
  - `AUTO_UPDATE_PUBLIC_KEY_PATH=./keys/release-public.pem`
  - `AUTO_UPDATE_PUBLIC_KEYS_PATH=./keys/release-public-keys.json`

## 2. Run local client

```powershell
node scripts/vip-build/vip-lobster-entry.cjs
```

Expected:

- connects to `/fleet`
- waits for `execute_task` (and also supports legacy `server.task.dispatch`)
- reports `node_ping`, `task_progress`, `task_completed`, `client.task.ack`, `client.lead.report`

## 3. Build Windows executable

```powershell
npm install -D pkg
npm run vip:pkg
```

Output:

- `dist/vip-lobster.exe`

Deliver `vip-lobster.exe` with `.env.vip` to customer machine.

## 4. Publish update metadata

Use release publish script:

```powershell
$env:BACKEND_BASE_URL='http://127.0.0.1:3000'
$env:BACKEND_ADMIN_JWT='<admin-jwt>'
$env:RELEASE_VERSION='0.1.1'
$env:RELEASE_DOWNLOAD_URL='https://cdn.example.com/vip-lobster-0.1.1.exe'
$env:RELEASE_FILE_PATH='dist/vip-lobster.exe'  # auto compute sha256
# optional signing:
# $env:RELEASE_SIGN_PRIVATE_KEY_PATH='.\keys\release-private.pem'
# $env:RELEASE_SIGN_KEY_ID='default'
# optional rollout:
# $env:RELEASE_ROLLOUT_PERCENT='20'
# $env:RELEASE_ROLLOUT_TENANTS_ALLOWLIST='tenant_a,tenant_b'
# $env:RELEASE_ROLLOUT_TENANTS_DENYLIST='tenant_x'
npm run vip:release:publish
```

Then clients with `AUTO_UPDATE_MANIFEST_URL` enabled will detect new versions on startup,
verify manifest signature (if enabled), and always verify package SHA-256 before saving.
