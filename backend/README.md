# ClawCommerce Backend (Phase D Closure)

NestJS backend for Liaoyuan/Dragon Senate control plane.

## 0) Control Plane Boundary (New)

- `web -> backend` is now the **only** control surface.
- `dragon-senate-saas-v2` runs as an internal **AI subservice** behind backend.
- Do not let web call AI subservice directly in production.

New proxy endpoints:

- `POST /api/v1/ai/run-dragon-team`
- `POST /api/v1/ai/analyze-competitor-formula`
- `GET /api/v1/ai/status`
- `GET /api/v1/ai/health`

Required env vars for proxy:

- `DRAGON_AI_BASE_URL` (default `http://127.0.0.1:8000`)
- `DRAGON_AI_SERVICE_USERNAME` (default `admin`)
- `DRAGON_AI_SERVICE_PASSWORD` (default `change_me`)
- `DRAGON_AI_TIMEOUT_MS` (default `90000`)
- `COMPLIANCE_REQUIRE_HITL` (default `true`)

## 1) Quick Start

```bash
cd backend
npm install
```

PowerShell:

```powershell
$env:JWT_SECRET='replace_with_at_least_16_chars'
$env:NEW_API_BASE_URL='http://127.0.0.1:9999'
$env:REDIS_HOST='127.0.0.1'
$env:REDIS_PORT='6379'
npm run start:dev
```

## 2) Unified Protocol (Step 1)

- Canonical Socket.IO path: `/fleet`
- Canonical dispatch event: `execute_task`
- Backward-compat dispatch event: `server.task.dispatch`
- Backward-compat telemetry accepted:
  - `client.heartbeat` -> mapped to `node_ping`
  - `client.node.status` -> mapped to `task_progress`
  - `client.task.ack` persisted to Redis task hash
  - `client.lead.report` ingested into lead service

Redis keys:

- `fleet:node:{nodeId}`
- `fleet:task:{taskId}`
- `fleet:trace:{traceId}:tasks`

## 3) DB Persistence + Activation Backend (Step 2)

### Device persistence

- Upsert/list bound devices in Redis:
  - `POST /api/v1/devices/confirm-bind`
  - `GET /api/v1/devices?limit=100` (admin + tenant scope)

### Activation code admin

- `POST /api/v1/activation-codes` (supports batch `count`)
- `GET /api/v1/activation-codes?limit=100&status=ACTIVE`
- `PATCH /api/v1/activation-codes/:code/revoke`
- `PATCH /api/v1/activation-codes/:code/activate`

All activation APIs require `JWT + admin role + tenant scope`.

## 4) Installer/Update Foundation (Step 3)

Client update APIs:

- `GET /api/v1/client-updates/latest?platform=win-x64&channel=stable&currentVersion=0.1.0`
- `GET /api/v1/client-updates/latest?platform=win-x64&channel=stable&currentVersion=0.1.0&tenantId=tenant_demo`
- `POST /api/v1/client-updates/release` (admin)

Release fields:

- required: `platform`, `channel`, `version`, `downloadUrl`, `sha256`
- optional:
  - `notes`, `signature`, `signatureAlgorithm=RSA-SHA256`, `signatureKeyId`, `minRequiredVersion`
  - `rollout`: `{ percent, tenantsAllowlist, tenantsDenylist, salt }`

Edge runtime (`scripts/vip-build/vip-lobster-entry.cjs`) supports:

- startup update check via `AUTO_UPDATE_MANIFEST_URL`
- package SHA-256 verification before write
- optional signature verification (`AUTO_UPDATE_REQUIRE_SIGNATURE=true`)
- supports key rotation by `signatureKeyId` + keyring
- optional download via `AUTO_UPDATE_DOWNLOAD=true`

## 5) Regression Commands

```bash
npm run test:fleet-protocol
npm run test:activation-device
npm run test:client-update
npm run test:client-update-chain
```

## 6) Security Baseline

- `JWT_SECRET` required and minimum 16 chars
- `NEW_API_BASE_URL` required and must be valid URL
- `NEW_API_TOKEN` required in `staging`/`production`
- tenant isolation enforced on admin write endpoints
- release signature policy (optional hard gate):
  - `CLIENT_UPDATE_REQUIRE_SIGNATURE=true`
  - `CLIENT_UPDATE_SIGNATURE_DEFAULT_KEY_ID=default`
  - `CLIENT_UPDATE_SIGNATURE_KEYS_PATH=./keys/release-public-keys.json`
  - `CLIENT_UPDATE_SIGNATURE_KEYS_JSON={"default":"-----BEGIN PUBLIC KEY-----..."}`
