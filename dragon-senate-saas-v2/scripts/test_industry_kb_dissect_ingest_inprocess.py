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
    token = secrets.token_hex(4)
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", f"sqlite+aiosqlite:///./_test_auth_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", f"sqlite+aiosqlite:///./_test_billing_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", f"./data/_test_research_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", f"./data/_test_clawwork_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", f"./data/_test_lossless_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", f"./data/_test_clawteam_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", f"./data/_test_bandit_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", f"./data/_test_memory_governor_ikb_dissect_{token}.sqlite")
    os.environ.setdefault("INDUSTRY_KB_DB_PATH", f"./data/_test_industry_kb_dissect_{token}.sqlite")
    os.environ.setdefault("RAG_ANYTHING_ENABLED", "false")
    os.environ.setdefault("PAYMENT_PROVIDER", "mock")
    os.environ.setdefault("FEISHU_ENABLED", "false")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("ikbdi")
    email = f"{username}@example.com"
    password = "IndustryDissectPassw0rd!2026"

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

        resp = client.post(
            "/industry-kb/dissect-and-ingest",
            headers=headers,
            json={
                "industry_tag": "hotel",
                "competitor_accounts": [
                    "https://example.com/hotel/benchmark_a",
                    "https://example.com/hotel/benchmark_b",
                ],
                "report_to_feishu": False,
            },
        )
        _must(resp.status_code == 200, f"dissect ingest failed: {resp.status_code} {resp.text}")
        payload = resp.json()
        _must(payload.get("ok") is True, f"ok mismatch: {payload}")
        _must(payload.get("industry_tag") == "hotel", f"industry mismatch: {payload.get('industry_tag')}")
        _must(int(payload.get("formulas_count", 0) or 0) >= 2, f"formulas_count invalid: {payload}")
        _must(int(payload.get("startup_playbooks_count", 0) or 0) >= 2, f"startup count invalid: {payload}")
        _must(int(payload.get("copy_templates_count", 0) or 0) >= 2, f"copy count invalid: {payload}")
        _must(int(payload.get("kb_ingested_count", 0) or 0) >= 4, f"ingested count invalid: {payload}")
        _must(payload.get("feishu_push_status") in {"skipped", "failed", "sent"}, f"feishu status invalid: {payload}")
        trace_id = str(payload.get("trace_id") or "").strip()
        _must(len(trace_id) > 8, f"trace_id missing: {payload}")

        stats = client.get("/industry-kb/stats", headers=headers, params={"industry_tag": "hotel"})
        _must(stats.status_code == 200, f"stats failed: {stats.status_code} {stats.text}")
        stats_json = stats.json()
        _must(int(stats_json.get("entries_count", 0) or 0) >= 4, f"entries_count invalid: {stats_json}")

        trace = client.get(f"/memory/trace/{trace_id}", headers=headers)
        _must(trace.status_code == 200, f"memory trace failed: {trace.status_code} {trace.text}")
        trace_json = trace.json()
        industry = trace_json.get("industry_kb", {})
        _must(isinstance(industry, dict), f"industry trace missing: {trace_json}")
        _must("audit_events" in industry, f"audit events missing: {industry}")

    print(
        json.dumps(
            {
                "ok": True,
                "trace_id": trace_id,
                "industry_tag": payload.get("industry_tag"),
                "formulas_count": payload.get("formulas_count"),
                "startup_playbooks_count": payload.get("startup_playbooks_count"),
                "copy_templates_count": payload.get("copy_templates_count"),
                "kb_ingested_count": payload.get("kb_ingested_count"),
                "feishu_push_status": payload.get("feishu_push_status"),
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
        print(f"[TEST_INDUSTRY_KB_DISSECT_INGEST_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
