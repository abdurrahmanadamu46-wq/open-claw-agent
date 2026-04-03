#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys

from fastapi.testclient import TestClient


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_commercial_readiness.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_commercial_readiness.sqlite")
    os.environ.setdefault("PAYMENT_ALLOW_SANDBOX_CHECKOUT", "true")
    os.environ.setdefault("AUTH_NOTIFICATION_MODE", "file")
    os.environ.setdefault("PUBLIC_BASE_URL", "https://lobster.example.com")
    os.environ.setdefault("FEISHU_ENABLED", "true")
    os.environ.setdefault("FEISHU_REPLY_MODE", "webhook")
    os.environ.setdefault("FEISHU_VERIFICATION_TOKEN", "token-demo")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    with TestClient(app) as client:
        login = client.post("/auth/login", json={"username": "admin", "password": "ChangeMe123!"})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "admin token missing")

        readiness = client.get("/commercial/readiness", headers={"Authorization": f"Bearer {token}"})
        _must(readiness.status_code == 200, f"commercial readiness failed: {readiness.status_code} {readiness.text}")
        body = readiness.json()
        snapshot = body.get("readiness", {})
        _must("score" in snapshot, "score missing from readiness snapshot")
        _must("blockers" in snapshot, "blockers missing from readiness snapshot")
        _must(snapshot.get("deploy", {}).get("public_base_url") == "https://lobster.example.com", f"unexpected deploy block: {snapshot}")

    print(json.dumps({"ok": True, "score": snapshot.get("score"), "blocker_count": snapshot.get("blocker_count")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_COMMERCIAL_READINESS_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
