#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys
import time
from dataclasses import dataclass
from typing import Any

import requests


def _rand(prefix: str, n: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


@dataclass
class SmokeResult:
    base_url: str
    username: str
    email: str
    tenant_id: str
    custom_login_ok: bool
    jwt_login_ok: bool
    auth_me: dict[str, Any]
    users_me: dict[str, Any]
    elapsed_ms: int


def main() -> int:
    base_url = os.getenv("APP_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    timeout = float(os.getenv("SMOKE_TIMEOUT_SEC", "20"))

    username = _rand("m1user")
    tenant_id = _rand("tenant")
    email = f"{username}@example.com"
    password = os.getenv("SMOKE_PASSWORD", "M1Passw0rd!2026")

    started = time.time()
    s = requests.Session()

    register_payload = {
        "email": email,
        "password": password,
        "is_active": True,
        "is_verified": True,
        "is_superuser": False,
        "username": username,
        "tenant_id": tenant_id,
        "roles": ["member"],
    }

    reg = s.post(f"{base_url}/auth/register", json=register_payload, timeout=timeout)
    _must(reg.status_code in (200, 201), f"/auth/register failed: {reg.status_code} {reg.text}")

    custom_login = s.post(
        f"{base_url}/auth/login",
        json={"username": username, "password": password},
        timeout=timeout,
    )
    _must(custom_login.status_code == 200, f"/auth/login failed: {custom_login.status_code} {custom_login.text}")
    custom_token = custom_login.json().get("access_token")
    _must(isinstance(custom_token, str) and len(custom_token) > 20, "/auth/login returned invalid access_token")

    auth_me = s.get(
        f"{base_url}/auth/me",
        headers={"Authorization": f"Bearer {custom_token}"},
        timeout=timeout,
    )
    _must(auth_me.status_code == 200, f"/auth/me failed: {auth_me.status_code} {auth_me.text}")
    auth_me_json = auth_me.json()
    _must(auth_me_json.get("username") == username, f"/auth/me username mismatch: {auth_me_json}")
    _must(auth_me_json.get("tenant_id") == tenant_id, f"/auth/me tenant mismatch: {auth_me_json}")

    jwt_login = s.post(
        f"{base_url}/auth/jwt/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=timeout,
    )
    _must(jwt_login.status_code == 200, f"/auth/jwt/login failed: {jwt_login.status_code} {jwt_login.text}")
    jwt_token = jwt_login.json().get("access_token")
    _must(isinstance(jwt_token, str) and len(jwt_token) > 20, "/auth/jwt/login returned invalid access_token")

    users_me = s.get(
        f"{base_url}/users/me",
        headers={"Authorization": f"Bearer {jwt_token}"},
        timeout=timeout,
    )
    _must(users_me.status_code == 200, f"/users/me failed: {users_me.status_code} {users_me.text}")
    users_me_json = users_me.json()
    _must(users_me_json.get("email") == email, f"/users/me email mismatch: {users_me_json}")
    _must(users_me_json.get("is_active") is True, f"/users/me active mismatch: {users_me_json}")

    elapsed_ms = int((time.time() - started) * 1000)
    result = SmokeResult(
        base_url=base_url,
        username=username,
        email=email,
        tenant_id=tenant_id,
        custom_login_ok=True,
        jwt_login_ok=True,
        auth_me=auth_me_json,
        users_me=users_me_json,
        elapsed_ms=elapsed_ms,
    )
    print(json.dumps(result.__dict__, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[M1_AUTH_JWT_SMOKE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

