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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_industry_qg.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_industry_qg.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_industry_qg.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_industry_qg.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_industry_qg.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_industry_qg.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_industry_qg.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_governor_industry_qg.sqlite")
    os.environ["INDUSTRY_KB_DB_PATH"] = f"./data/_test_industry_kb_quality_gate_{secrets.token_hex(4)}.sqlite"
    os.environ.setdefault("RAG_ANYTHING_ENABLED", "false")
    os.environ.setdefault("PAYMENT_PROVIDER", "mock")
    os.environ.setdefault("INDUSTRY_KB_MIN_QUALITY_SCORE", "68")
    os.environ.setdefault("INDUSTRY_KB_MIN_CONTENT_LEN", "32")
    os.environ.setdefault("INDUSTRY_KB_MIN_EFFECT_SCORE", "20")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("ikbqg")
    email = f"{username}@example.com"
    password = "IndustryKbQGPassw0rd!2026"

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

        low_ingest = client.post(
            "/industry-kb/ingest",
            headers=headers,
            json={
                "industry_tag": "beauty",
                "trace_id": "trace_low_quality",
                "entries": [
                    {
                        "entry_type": "formula",
                        "title": "bad",
                        "content": "short text",
                        "effect_score": 5.0,
                        "source_account": "bad_account",
                        "source_url": "https://example.com/bad/1",
                    }
                ],
            },
        )
        _must(low_ingest.status_code == 200, f"low ingest failed: {low_ingest.status_code} {low_ingest.text}")
        low_json = low_ingest.json()
        _must(int(low_json.get("ingested_count", 0) or 0) == 0, f"low quality should not ingest: {low_json}")
        _must(int(low_json.get("rejected_count", 0) or 0) >= 1, f"rejected_count expected: {low_json}")

        high_ingest = client.post(
            "/industry-kb/ingest",
            headers=headers,
            json={
                "industry_tag": "beauty",
                "trace_id": "trace_high_quality",
                "entries": [
                    {
                        "entry_type": "formula",
                        "title": "Sensitive skin ingredient trust pattern",
                        "content": (
                            "First 3s pain hook, then ingredient evidence, then social proof, "
                            "then objection handling, and final CTA with urgency close."
                        ),
                        "effect_score": 91.0,
                        "source_account": "beauty_competitor_a",
                        "source_url": "https://example.com/good/1",
                        "metadata": {"persona": "chengfendang", "storyboard_count": 7},
                    }
                ],
            },
        )
        _must(high_ingest.status_code == 200, f"high ingest failed: {high_ingest.status_code} {high_ingest.text}")
        high_json = high_ingest.json()
        _must(int(high_json.get("ingested_count", 0) or 0) >= 1, f"high quality should ingest: {high_json}")

        run = client.post(
            "/run-dragon-team",
            headers=headers,
            json={
                "task_description": "Generate beauty campaign scripts for sensitive skin launch",
                "user_id": username,
                "industry_tag": "beauty",
                "industry_kb_limit": 3,
                "competitor_handles": ["beauty_competitor_a"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run-dragon-team failed: {run.status_code} {run.text}")
        run_json = run.json()
        trace_id = str(run_json.get("request_id") or "").strip()
        _must(len(trace_id) > 8, f"request_id missing: {run_json}")
        metrics_obj = run_json.get("industry_kb_metrics", {})
        _must(isinstance(metrics_obj, dict), "industry_kb_metrics missing")
        _must("industry_kb_hit_rate" in metrics_obj, f"hit_rate missing from response: {metrics_obj}")
        _must("industry_kb_effect_delta" in metrics_obj, f"effect_delta missing from response: {metrics_obj}")

        dashboard = client.get(
            "/industry-kb/metrics/dashboard",
            headers=headers,
            params={"industry_tag": "beauty", "granularity": "day"},
        )
        _must(dashboard.status_code == 200, f"metrics dashboard failed: {dashboard.status_code} {dashboard.text}")
        dashboard_json = dashboard.json()
        summary = dashboard_json.get("summary", {})
        _must("industry_kb_hit_rate" in summary, f"industry_kb_hit_rate missing: {dashboard_json}")
        _must("industry_kb_effect_delta" in summary, f"industry_kb_effect_delta missing: {dashboard_json}")

        trace = client.get(f"/memory/trace/{trace_id}", headers=headers)
        _must(trace.status_code == 200, f"memory trace failed: {trace.status_code} {trace.text}")
        trace_json = trace.json()
        industry_trace = trace_json.get("industry_kb", {})
        _must(isinstance(industry_trace, dict), f"industry trace missing: {trace_json}")
        _must("metrics" in industry_trace, f"industry trace metrics missing: {industry_trace}")

    print(
        json.dumps(
            {
                "ok": True,
                "trace_id": trace_id,
                "low_quality_rejected": int(low_json.get("rejected_count", 0) or 0),
                "high_quality_ingested": int(high_json.get("ingested_count", 0) or 0),
                "industry_kb_hit_rate": float(metrics_obj.get("industry_kb_hit_rate", 0) or 0),
                "industry_kb_effect_delta": float(metrics_obj.get("industry_kb_effect_delta", 0) or 0),
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
        print(f"[TEST_INDUSTRY_KB_QUALITY_GATE_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
