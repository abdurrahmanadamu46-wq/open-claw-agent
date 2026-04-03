# Apps Workspace (Bridge Mode)

This folder hosts the future app-level layout without moving runtime code yet.

- `web` -> bridges `../../web`
- `backend` -> bridges `../../backend`
- `ai-subservice` -> bridges `../../dragon-senate-saas-v2`
- `edge-runtime` -> bridges `../../edge-runtime`
- `desktop-client` -> desktop shell (Tauri, wizard + embedded runtime)

Current mode: non-breaking bridge. Interfaces and runtime paths stay unchanged.

Entrypoints (from repo root):

- Unified controller:
  - `npm run apps:help`
  - `npm run apps:ps`
  - `npm run apps:up:all` / `apps:down:all`
  - `npm run apps:up:web|backend|ai|ai-heavy`
  - `npm run apps:logs:web|backend|ai|ai-heavy`
  - `npm run apps:dev:web|backend|ai|edge|desktop`
  - `npm run apps:test:all` (backend+ai+edge+desktop+web)
