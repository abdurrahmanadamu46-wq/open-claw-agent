# 10-PAYMENT-CUTOVER-RUNBOOK

Last Updated: 2026-03-29

## Goal

Cut Lobster Pool from sandbox checkout to live billing without changing the application contract.

## Preconditions

- Merchant contract is signed for the target provider: `stripe`, `alipay`, or `wechatpay`
- Production credentials and certificates are available
- Public console/API domain is already decided
- Billing cockpit and webhook ledger are reachable from the control plane

## Env Checklist

- `PAYMENT_PROVIDER`
- Provider credentials:
  - `STRIPE_SECRET_KEY`
  - or `ALIPAY_APP_ID` + `ALIPAY_PRIVATE_KEY`
  - or `WECHATPAY_MCH_ID` + `WECHATPAY_PRIVATE_KEY` + `WECHATPAY_SERIAL_NO`
- `PAYMENT_WEBHOOK_HMAC_SECRET`
- `PAYMENT_RETURN_URL`
- `PUBLIC_BASE_URL`
- `PAYMENT_ALLOW_SANDBOX_CHECKOUT=false`

## Preflight

```powershell
npm run preflight:payment
```

Expected result:

- Provider credentials are present
- Webhook secret is configured
- Public URLs are configured
- Sandbox checkout is disabled

## Cutover Steps

1. Fill production payment env in `dragon-senate-saas-v2/.env`.
2. Restart AI service and backend.
3. Open `/settings/billing` and create a canary checkout.
4. Complete one real checkout with a low-risk tenant.
5. Confirm webhook event is recorded in the webhook ledger.
6. Run reconciliation.
7. Confirm billing order status, subscription status, and billable usage view all match.

## Verification Commands

```powershell
curl http://127.0.0.1:18000/billing/providers
curl http://127.0.0.1:18000/billing/orders?limit=10
curl http://127.0.0.1:18000/billing/webhook/events?limit=10
curl -X POST http://127.0.0.1:18000/billing/reconcile/run -H "Content-Type: application/json" -d "{}"
```

## Rollback

1. Disable live checkout entry from the billing cockpit.
2. Set `PAYMENT_ALLOW_SANDBOX_CHECKOUT=true`.
3. Remove or rotate compromised merchant credentials if the incident is security-related.
4. Re-run reconciliation and capture the incident in `PROJECT_STATE.md`.

## Evidence To Preserve

- Canary order id
- Webhook event id
- Reconciliation run id
- Screenshot of billing cockpit before/after cutover
