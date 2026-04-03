# ClawCommerce Web

Next.js 14 frontend for Liaoyuan/ClawCommerce control panel.

## Tech Stack

- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- TanStack Query
- Axios

## Quick Start

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

## Real Run Mode (No Mock)

To make page actions hit real backend APIs:

1. Start Redis on `127.0.0.1:6379`.
2. Start backend service in `../backend`.
3. Set `web/.env.local`:

```env
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:38789
NEXT_PUBLIC_RUNTIME_ENV=development
NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK=false
```

4. Open `/login` and use:
   - username: `admin`
   - password: `change_me`

## API Mapping

- `/dashboard` -> `/api/v1/dashboard/metrics`
- `/fleet` -> `/api/v1/fleet/nodes`, `/api/v1/fleet/commands`
- `/campaigns` -> `/api/v1/campaigns`
- `/leads` -> `/api/v1/leads`, `/api/v1/leads/:id/reveal`
- `/dashboard/settings/integrations` -> `/api/v1/tenant/integrations`

## Release Regression (Real Chain)

Live regression script for release gate:

```bash
cd web
npm run test:e2e:release
```

The runner will:

1. Build backend
2. Ensure Redis is available (priority: existing `127.0.0.1:6379` -> Docker `redis:7-alpine` -> local `redis-server`)
3. Start backend + web
4. Run the 5-page Playwright real-chain test
5. Exit non-zero to block release on failure

This runs the 5-page real chain:

1. Login (`/login`)
2. Dashboard metrics (`/`)
3. Campaign create (`/campaigns/new`)
4. Fleet dispatch (`/fleet`)
5. Leads and reveal (`/leads`)

For direct Playwright run against already-started services:

```bash
cd web
npm run test:e2e:live
```

If `test:e2e:release` fails with `No Redis runtime available`, start Docker Desktop (or install/start local `redis-server`) and rerun.

## Notes

- HTTP calls should only be made through `src/services/*`.
- Do not call backend directly inside React components.
- Keep mock mode only for local UI demo; disable it for integration testing.
