# 11-NOTIFICATION-CUTOVER-RUNBOOK

Last Updated: 2026-03-29

## Goal

Switch password reset and operator notifications from local file/sms-mock delivery to a live channel.

## Preconditions

- Production SMTP or SMS provider is available
- Public reset-password URL is final
- Notification outbox is visible in the commercial readiness cockpit

## Env Checklist

- `AUTH_NOTIFICATION_MODE=smtp`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM_EMAIL`
- `SMTP_USERNAME` and `SMTP_PASSWORD` when required
- `SMTP_STARTTLS` / `SMTP_SSL`
- `AUTH_RESET_BASE_URL`
- `SMS_MOCK_ENABLED=false`
- `SMS_PROVIDER_WEBHOOK` if SMS is enabled

## Preflight

```powershell
npm run preflight:notifications
```

Expected result:

- Live notification mode is selected
- SMTP host and sender are configured
- Reset-password base URL is set
- SMS mock mode is disabled

## Cutover Steps

1. Fill live notification env in `dragon-senate-saas-v2/.env`.
2. Restart AI service.
3. Open `/settings/commercial-readiness`.
4. Send a test notification to an operator mailbox.
5. Trigger one password reset request from `/forgot-password`.
6. Confirm both outbox visibility and external delivery.

## Verification Commands

```powershell
curl http://127.0.0.1:18000/notifications/status
curl http://127.0.0.1:18000/notifications/outbox?limit=10
curl -X POST http://127.0.0.1:18000/notifications/test -H "Content-Type: application/json" -d "{\"target\":\"ops@example.com\",\"text\":\"cutover smoke test\"}"
```

## Rollback

1. Switch `AUTH_NOTIFICATION_MODE=file`.
2. Re-run a test notification and confirm outbox write succeeds.
3. Leave SMTP credentials in place for later retry unless security requires rotation.

## Evidence To Preserve

- Outbox item path
- Test notification target and timestamp
- Password reset request timestamp
- Screenshot of readiness cockpit notification card
