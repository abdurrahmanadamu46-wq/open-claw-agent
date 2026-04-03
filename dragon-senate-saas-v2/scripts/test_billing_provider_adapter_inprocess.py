#!/usr/bin/env python
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import string
import sys

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_billing_provider.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_provider.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_billing_provider.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_billing_provider.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_billing_provider.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_billing_provider.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_billing_provider.sqlite")
    os.environ.setdefault("PAYMENT_PROVIDER", "stripe")
    os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_dummy_stripe_key")
    os.environ.setdefault("PAYMENT_WEBHOOK_HMAC_SECRET", "billing-provider-test-secret")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def _hmac_signature(secret: str, body: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("billp")
    email = f"{username}@example.com"
    password = "BillingPassw0rd!2026"

    with TestClient(app) as client:
        reg = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "is_active": True,
                "is_verified": True,
                "is_superuser": False,
                "username": username,
                "tenant_id": "tenant_main",
                "roles": ["member"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "token missing")
        headers = {"Authorization": f"Bearer {token}"}

        providers = client.get("/billing/providers/status", headers=headers)
        _must(providers.status_code == 200, f"providers failed: {providers.status_code} {providers.text}")

        checkout = client.post(
            "/billing/checkout",
            json={"plan_code": "pro", "cycle": "month", "provider": "stripe"},
            headers=headers,
        )
        _must(checkout.status_code == 200, f"checkout failed: {checkout.status_code} {checkout.text}")
        checkout_json = checkout.json()
        _must(bool((checkout_json.get("checkout") or {}).get("checkout_id")), "checkout intent missing checkout_id")

        activate_payload = {
            "provider": "stripe",
            "event_id": f"evt_{_rand('activate')}",
            "action": "activate",
            "user_id": username,
            "tenant_id": "tenant_main",
            "provider_subscription_id": f"sub_{_rand('stripe')}",
            "payload": {"event_type": "customer.subscription.created", "metadata": {"plan_code": "pro"}},
        }
        activate_raw = json.dumps(activate_payload, ensure_ascii=False, separators=(",", ":"))
        activate_sig = _hmac_signature(os.getenv("PAYMENT_WEBHOOK_HMAC_SECRET", ""), activate_raw)
        activate = client.post(
            "/billing/webhook",
            data=activate_raw.encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-payment-provider": "stripe",
                "x-payment-signature": activate_sig,
            },
        )
        _must(activate.status_code == 200, f"activate webhook failed: {activate.status_code} {activate.text}")

        webhook_payload = {
            "provider": "stripe",
            "event_id": f"evt_{_rand('stripe')}",
            "action": "upgrade_enterprise",
            "user_id": username,
            "tenant_id": "tenant_main",
            "provider_subscription_id": f"sub_{_rand('stripe')}",
            "payload": {"event_type": "invoice.paid", "metadata": {"plan_code": "enterprise"}},
        }
        raw = json.dumps(webhook_payload, ensure_ascii=False, separators=(",", ":"))
        signature = _hmac_signature(os.getenv("PAYMENT_WEBHOOK_HMAC_SECRET", ""), raw)

        webhook = client.post(
            "/billing/webhook",
            data=raw.encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-payment-provider": "stripe",
                "x-payment-signature": signature,
            },
        )
        _must(webhook.status_code == 200, f"webhook failed: {webhook.status_code} {webhook.text}")
        webhook_json = webhook.json()
        _must(webhook_json.get("provider") == "stripe", f"provider mismatch: {webhook_json}")
        _must((webhook_json.get("subscription") or {}).get("plan_code") == "enterprise", "webhook should upgrade plan")

        me = client.get("/billing/subscription/me", headers=headers)
        _must(me.status_code == 200, f"subscription me failed: {me.status_code} {me.text}")
        subscription = (me.json() or {}).get("subscription") or {}
        _must(subscription.get("plan_code") == "enterprise", f"final plan mismatch: {subscription}")
        _must(subscription.get("payment_provider") == "stripe", f"provider not persisted: {subscription}")

    print(
        json.dumps(
            {
                "ok": True,
                "username": username,
                "provider": subscription.get("payment_provider"),
                "plan_code": subscription.get("plan_code"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_BILLING_PROVIDER_ADAPTER_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
