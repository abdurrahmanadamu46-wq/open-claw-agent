# 12-FEISHU-CUTOVER-RUNBOOK

Last Updated: 2026-03-29

## Goal

Enable live Feishu callback traffic with challenge verification and signature checks.

## Preconditions

- Public HTTPS domain exists and routes to the backend callback endpoint
- Feishu application credentials are ready
- Reverse proxy can expose `/webhook/chat_gateway`

## Env Checklist

- `PUBLIC_BASE_URL`
- `FEISHU_ENABLED=true`
- `FEISHU_REPLY_MODE=webhook` or `openapi`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFY_SIGNATURE=true`
- `FEISHU_VERIFICATION_TOKEN` and/or `FEISHU_SIGNING_SECRET`

## Preflight

```powershell
npm run preflight:feishu
```

Expected result:

- DNS resolves
- Local challenge succeeds
- Public healthz succeeds
- Public callback challenge succeeds
- Feishu env values are internally consistent

## Cutover Steps

1. Point the public domain to the backend ingress.
2. Configure HTTPS and verify `/healthz`.
3. Set Feishu credentials and signature secrets in `dragon-senate-saas-v2/.env`.
4. Run the preflight script until it passes.
5. Register the callback URL in the Feishu console.
6. Trigger one callback smoke test and confirm the readiness cockpit updates.

## Verification Commands

```powershell
curl http://127.0.0.1:18000/integrations/feishu/status
curl http://127.0.0.1:18000/integrations/feishu/callback-readiness
```

## Rollback

1. Disable callback subscription in the Feishu console.
2. Set `FEISHU_ENABLED=false`.
3. Restart AI service.
4. Preserve logs from the failed challenge or signature attempt.

## Evidence To Preserve

- Public callback URL
- Preflight output
- Feishu console screenshot
- Callback readiness response before and after cutover
