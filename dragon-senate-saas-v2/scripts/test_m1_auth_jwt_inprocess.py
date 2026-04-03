#!/usr/bin/env python
from __future__ import annotations

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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_inprocess.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_inprocess.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_inprocess.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_inprocess.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_inprocess.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_inprocess.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_inprocess.sqlite")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("jwtuser")
    email = f"{username}@example.com"
    password = "M1Passw0rd!2026"

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

        custom_login = client.post("/auth/login", json={"username": username, "password": password})
        _must(custom_login.status_code == 200, f"custom login failed: {custom_login.status_code} {custom_login.text}")
        custom_token = custom_login.json().get("access_token")
        _must(isinstance(custom_token, str) and len(custom_token) > 20, "invalid custom token")

        me = client.get("/auth/me", headers={"Authorization": f"Bearer {custom_token}"})
        _must(me.status_code == 200, f"auth/me failed: {me.status_code} {me.text}")
        me_json = me.json()
        _must(me_json.get("username") == username, f"username mismatch: {me_json}")

        jwt_login = client.post(
            "/auth/jwt/login",
            data={"username": email, "password": password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        _must(jwt_login.status_code == 200, f"jwt login failed: {jwt_login.status_code} {jwt_login.text}")
        jwt_token = jwt_login.json().get("access_token")
        _must(isinstance(jwt_token, str) and len(jwt_token) > 20, "invalid jwt token")

        users_me = client.get("/users/me", headers={"Authorization": f"Bearer {jwt_token}"})
        _must(users_me.status_code == 200, f"users/me failed: {users_me.status_code} {users_me.text}")
        users_me_json = users_me.json()
        _must(users_me_json.get("email") == email, f"users/me email mismatch: {users_me_json}")

    print(
        json.dumps(
            {
                "ok": True,
                "username": username,
                "email": email,
                "custom_login": True,
                "jwt_login": True,
                "auth_me_username": me_json.get("username"),
                "users_me_email": users_me_json.get("email"),
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
        print(f"[TEST_M1_AUTH_JWT_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

