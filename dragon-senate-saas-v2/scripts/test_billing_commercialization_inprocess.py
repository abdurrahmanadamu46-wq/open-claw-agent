#!/usr/bin/env python
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import string
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _bootstrap_env() -> None:
    temp_root = Path(tempfile.mkdtemp(prefix="billing_commercial_"))
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{(temp_root / '_test_auth_billing_commercial.sqlite').as_posix()}"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{(temp_root / '_test_billing_commercial.sqlite').as_posix()}"
    os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_dummy")
    os.environ.setdefault("PAYMENT_PROVIDER", "stripe")
    os.environ.setdefault("PAYMENT_WEBHOOK_HMAC_SECRET", "billing-webhook-secret")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def _sign(secret: str, body_text: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body_text.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("billinguser")
    email = f"{username}@example.com"
    password = "BillPassw0rd!2026"

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
                "tenant_id": "tenant_demo",
                "roles": ["member"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "token missing")
        headers = {"Authorization": f"Bearer {token}"}

        checkout = client.post(
            "/billing/checkout",
            json={"plan_code": "pro", "cycle": "month", "provider": "stripe"},
            headers=headers,
        )
        _must(checkout.status_code == 200, f"checkout failed: {checkout.status_code} {checkout.text}")
        checkout_json = checkout.json()
        order = checkout_json.get("order", {})
        order_id = str(order.get("order_id") or "").strip()
        _must(order_id.startswith("ord_"), f"order_id missing: {checkout_json}")

        orders_before = client.get("/billing/orders", headers=headers)
        _must(orders_before.status_code == 200, f"orders failed: {orders_before.status_code} {orders_before.text}")
        _must(int(orders_before.json().get("count") or 0) >= 1, "orders list empty after checkout")

        webhook_payload = {
            "provider": "stripe",
            "event_id": "evt_test_success_001",
            "action": "payment_succeeded",
            "user_id": username,
            "tenant_id": "tenant_demo",
            "order_id": order_id,
            "payload": {
                "order_id": order_id,
                "metadata": {"user_id": username, "tenant_id": "tenant_demo", "order_id": order_id, "plan_code": "pro"},
            },
        }
        webhook_body = json.dumps(webhook_payload, ensure_ascii=False)
        webhook = client.post(
            "/billing/webhook",
            data=webhook_body,
            headers={
                "Content-Type": "application/json",
                "x-payment-provider": "stripe",
                "x-payment-signature": _sign(os.environ["PAYMENT_WEBHOOK_HMAC_SECRET"], webhook_body),
            },
        )
        _must(webhook.status_code == 200, f"webhook failed: {webhook.status_code} {webhook.text}")
        _must(
            webhook.json().get("subscription", {}).get("plan_code") == "pro",
            f"subscription not upgraded to pro: {webhook.text}",
        )

        orders_after = client.get("/billing/orders", headers=headers)
        order_rows = orders_after.json().get("orders", [])
        paid_row = next((row for row in order_rows if row.get("order_id") == order_id), None)
        _must(isinstance(paid_row, dict) and paid_row.get("status") == "paid", f"order not paid: {orders_after.text}")

        webhook_events = client.get("/billing/webhook/events?limit=10", headers=headers)
        _must(webhook_events.status_code == 200, f"events failed: {webhook_events.status_code} {webhook_events.text}")
        _must(int(webhook_events.json().get("count") or 0) >= 1, "webhook events empty")

        fail_payload = {
            "provider": "stripe",
            "event_id": "evt_test_fail_001",
            "action": "payment_failed",
            "user_id": username,
            "tenant_id": "tenant_demo",
            "order_id": order_id,
            "payload": {
                "order_id": order_id,
                "metadata": {"user_id": username, "tenant_id": "tenant_demo", "order_id": order_id, "plan_code": "pro"},
            },
        }
        fail_body = json.dumps(fail_payload, ensure_ascii=False)
        fail_webhook = client.post(
            "/billing/webhook",
            data=fail_body,
            headers={
                "Content-Type": "application/json",
                "x-payment-provider": "stripe",
                "x-payment-signature": _sign(os.environ["PAYMENT_WEBHOOK_HMAC_SECRET"], fail_body),
            },
        )
        _must(fail_webhook.status_code == 200, f"fail webhook failed: {fail_webhook.status_code} {fail_webhook.text}")

        compensation = client.get("/billing/compensation?limit=10", headers=headers)
        _must(compensation.status_code == 200, f"compensation failed: {compensation.status_code} {compensation.text}")
        _must(int(compensation.json().get("count") or 0) >= 1, "compensation list empty after failed payment")

        reconcile = client.post("/billing/reconcile/run", json={"provider": "stripe"}, headers=headers)
        _must(reconcile.status_code == 403, "member should not be allowed to run reconciliation")

    print(json.dumps({"ok": True, "order_id": order_id}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_BILLING_COMMERCIALIZATION_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
