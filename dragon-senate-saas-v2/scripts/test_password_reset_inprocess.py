#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _bootstrap_env() -> Path:
    root = Path(__file__).resolve().parents[1]
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_reset.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_reset.sqlite")
    os.environ.setdefault("AUTH_NOTIFICATION_MODE", "file")
    os.environ.setdefault("AUTH_NOTIFICATION_DIR", str((root / "tmp" / "auth_notifications_test").resolve()))
    notification_dir = Path(os.environ["AUTH_NOTIFICATION_DIR"])
    notification_dir.mkdir(parents=True, exist_ok=True)
    for item in notification_dir.glob("*.json"):
        item.unlink()
    return notification_dir


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    notification_dir = _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("resetuser")
    email = f"{username}@example.com"
    password = "InitPassw0rd!2026"
    new_password = "NewPassw0rd!2026"

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

        forgot = client.post("/auth/forgot-password", json={"email": email})
        _must(forgot.status_code in (200, 202), f"forgot failed: {forgot.status_code} {forgot.text}")

        payload_files = sorted(notification_dir.glob("reset_password_*.json"))
        _must(len(payload_files) > 0, "reset notification file not created")
        latest = payload_files[-1]
        payload = json.loads(latest.read_text(encoding="utf-8"))
        token = str(payload.get("token") or "").strip()
        _must(len(token) > 10, "reset token missing from notification payload")

        reset = client.post("/auth/reset-password", json={"token": token, "password": new_password})
        _must(reset.status_code in (200, 202), f"reset failed: {reset.status_code} {reset.text}")

        login = client.post("/auth/login", json={"username": username, "password": new_password})
        _must(login.status_code == 200, f"login with new password failed: {login.status_code} {login.text}")

    print(
        json.dumps(
            {
                "ok": True,
                "email": email,
                "notification_file": str(latest),
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
        print(f"[TEST_PASSWORD_RESET_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
