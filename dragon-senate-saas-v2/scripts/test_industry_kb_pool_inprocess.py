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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_industry_kb.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_industry_kb.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_industry_kb.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_industry_kb.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_industry_kb.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_industry_kb.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_industry_kb.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_governor_industry_kb.sqlite")
    os.environ["INDUSTRY_KB_DB_PATH"] = f"./data/_test_industry_kb_pool_{secrets.token_hex(4)}.sqlite"
    os.environ.setdefault("RAG_ANYTHING_ENABLED", "false")
    os.environ.setdefault("PAYMENT_PROVIDER", "mock")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("ikb")
    email = f"{username}@example.com"
    password = "IndustryKbPassw0rd!2026"

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

        upsert_profile = client.put(
            "/industry-kb/profile",
            headers=headers,
            json={
                "industry_tag": "beauty",
                "display_name": "Beauty Industry KB",
                "description": "Knowledge pool for beauty customer strategy and viral formulas",
                "status": "active",
                "config": {"channel": "xiaohongshu", "strategy_version": "beauty_safe_v1"},
            },
        )
        _must(upsert_profile.status_code == 200, f"profile upsert failed: {upsert_profile.status_code} {upsert_profile.text}")

        ingest = client.post(
            "/industry-kb/ingest",
            headers=headers,
            json={
                "industry_tag": "beauty",
                "entries": [
                    {
                        "entry_type": "formula",
                        "title": "Sensitive skin viral launch template",
                        "content": "First 3s pain hook + ingredient proof + 15s CTA close",
                        "effect_score": 92.5,
                        "source_account": "beauty_competitor_a",
                        "source_url": "https://example.com/post/1",
                        "metadata": {"persona": "chengfendang", "storyboard_count": 7},
                    }
                ],
            },
        )
        _must(ingest.status_code == 200, f"industry ingest failed: {ingest.status_code} {ingest.text}")
        ingest_json = ingest.json()
        _must(int(ingest_json.get("ingested_count", 0) or 0) >= 1, f"ingested_count invalid: {ingest_json}")

        search = client.get(
            "/industry-kb/search",
            headers=headers,
            params={
                "industry_tag": "beauty",
                "query": "sensitive skin ingredient 15s",
                "limit": 5,
            },
        )
        _must(search.status_code == 200, f"industry search failed: {search.status_code} {search.text}")
        search_json = search.json()
        _must(int(search_json.get("count", 0) or 0) >= 1, f"industry search no result: {search_json}")

        run = client.post(
            "/run-dragon-team",
            headers=headers,
            json={
                "task_description": "Generate launch and delivery scripts for a beauty sensitive-skin product",
                "user_id": username,
                "industry_tag": "beauty",
                "industry_kb_limit": 5,
                "competitor_handles": ["beauty_competitor_a"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run-dragon-team failed: {run.status_code} {run.text}")
        run_json = run.json()
        _must(run_json.get("industry_tag") == "beauty", f"industry tag mismatch: {run_json.get('industry_tag')}")
        kb_ctx = run_json.get("industry_kb_context", [])
        _must(isinstance(kb_ctx, list), "industry_kb_context not list")

    print(
        json.dumps(
            {
                "ok": True,
                "username": username,
                "industry_tag": "beauty",
                "industry_kb_context_count": len(kb_ctx),
                "run_status": run_json.get("status"),
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
        print(f"[TEST_INDUSTRY_KB_POOL_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
