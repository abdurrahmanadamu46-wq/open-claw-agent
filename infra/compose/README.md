# infra/compose

Use overlays with root compose:

- dev: `powershell -File scripts/compose/profile.ps1 -Profile dev -Action up`
- staging: `powershell -File scripts/compose/profile.ps1 -Profile staging -Action config`
- prod: `powershell -File scripts/compose/profile.ps1 -Profile prod -Action config`

This is non-breaking and keeps `docker-compose.yml` as the primary runtime source.
