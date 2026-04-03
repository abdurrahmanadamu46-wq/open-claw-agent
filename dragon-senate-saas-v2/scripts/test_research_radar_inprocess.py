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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_research.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_research.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_radar.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_research.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_research.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_research.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_research.sqlite")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("radar")
    email = f"{username}@example.com"
    password = "RadarPassw0rd!2026"

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

        refresh = client.post(
            "/research/signals/refresh",
            json={"sources": ["openalex", "github_projects"], "trigger_type": "manual"},
            headers=headers,
        )
        _must(refresh.status_code == 200, f"refresh failed: {refresh.status_code} {refresh.text}")

        listing = client.get("/research/signals?limit=10", headers=headers)
        _must(listing.status_code == 200, f"list failed: {listing.status_code} {listing.text}")
        items = listing.json().get("items", [])
        _must(len(items) > 0, "no research signals after refresh")

        health = client.get("/research/source-health?limit=10&window_hours=24", headers=headers)
        _must(health.status_code == 200, f"source health failed: {health.status_code} {health.text}")
        health_items = health.json().get("items", [])
        _must(len(health_items) > 0, "source health should not be empty after refresh")

        manual = client.post(
            "/research/signals/ingest-manual",
            json={
                "signals": [
                    {
                        "source": "manual",
                        "rank_type": "manual",
                        "title": "Constitutional Guardian for Multi-Agent Runtime",
                        "url": "https://example.com/guardian-runtime",
                        "summary": "human-in-the-loop with auditable policy guard",
                        "tags": ["governance", "guardian", "langgraph"],
                    }
                ]
            },
            headers=headers,
        )
        _must(manual.status_code == 200, f"manual ingest failed: {manual.status_code} {manual.text}")

        executable = client.get("/research/signals?only_executable=true&limit=20", headers=headers)
        _must(executable.status_code == 200, f"executable list failed: {executable.status_code} {executable.text}")
        executable_count = int(executable.json().get("count") or 0)
        _must(executable_count > 0, "executable signals should not be empty")

    print(
        json.dumps(
            {
                "ok": True,
                "username": username,
                "refresh_count": len(items),
                "executable_count": executable_count,
                "source_health_count": len(health_items),
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
        print(f"[TEST_RESEARCH_RADAR_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
