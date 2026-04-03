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
    os.environ["ALLOW_INMEMORY_CHECKPOINTER"] = "true"
    os.environ["DATABASE_URL"] = ""
    os.environ["AUTH_DATABASE_URL"] = "sqlite+aiosqlite:///./_test_auth_kernel_persist.sqlite"
    os.environ["BILLING_DATABASE_URL"] = "sqlite+aiosqlite:///./_test_billing_kernel_persist.sqlite"
    os.environ["RESEARCH_RADAR_DB_PATH"] = "./data/_test_research_kernel_persist.sqlite"
    os.environ["CLAWWORK_DB_PATH"] = "./data/_test_clawwork_kernel_persist.sqlite"
    os.environ["LOSSLESS_MEMORY_DB_PATH"] = "./data/_test_lossless_kernel_persist.sqlite"
    os.environ["CLAWTEAM_DB_PATH"] = "./data/_test_clawteam_kernel_persist.sqlite"
    os.environ["POLICY_BANDIT_DB_PATH"] = "./data/_test_bandit_kernel_persist.sqlite"
    os.environ["MEMORY_GOVERNOR_DB_PATH"] = "./data/_test_memory_kernel_persist.sqlite"
    os.environ["SENATE_KERNEL_ENABLED"] = "true"
    os.environ["SENATE_KERNEL_GREY_RATIO"] = "100"
    os.environ["SENATE_KERNEL_BLOCK_MODE"] = "hitl"
    os.environ["HITL_ENABLED"] = "false"
    os.environ["LLM_MOCK_FORCE"] = "true"
    os.environ["LLM_FORCE_LOCAL"] = "true"


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)
    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("kpersist")
    email = f"{username}@example.com"
    password = "KernelPersistPassw0rd!2026"

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

        run = client.post(
            "/run-dragon-team",
            headers=headers,
            json={
                "task_description": "请给我一套合规的私域引流策略，先审后发",
                "user_id": username,
                "competitor_handles": ["openalex", "github_projects"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run-dragon-team failed: {run.status_code} {run.text}")
        payload = run.json()
        trace_id = str(payload.get("request_id") or "")
        _must(bool(trace_id), "trace/request_id missing")

        # Simulate process memory loss; endpoint must still recover from memory governor.
        app.state.kernel_reports = {}

        report = client.get(f"/kernel/report/{trace_id}?user_id={username}", headers=headers)
        _must(report.status_code == 200, f"kernel report failed: {report.status_code} {report.text}")
        report_json = report.json()
        kernel_report = report_json.get("kernel_report", {})
        persisted = report_json.get("kernel_report_persisted", {})
        _must(bool(kernel_report), "kernel_report empty after state reset")
        _must(bool(persisted), "kernel_report_persisted missing")
        _must(isinstance(report_json.get("approval_journal"), list), "approval_journal missing")
        risk_taxonomy = kernel_report.get("risk_taxonomy", {})
        _must(isinstance(risk_taxonomy, dict), "risk_taxonomy missing")
        _must(isinstance(risk_taxonomy.get("monitor_rules"), list), "risk monitor rules missing")
        _must(isinstance(risk_taxonomy.get("rollback_preset"), dict), "rollback preset missing")

    print(
        json.dumps(
            {
                "ok": True,
                "trace_id": trace_id,
                "kernel_stage": kernel_report.get("stage"),
                "persisted_stage": persisted.get("stage"),
                "approval_journal_count": len(report_json.get("approval_journal", [])),
                "risk_family": risk_taxonomy.get("primary_family"),
                "rollback_preset": risk_taxonomy.get("rollback_preset", {}),
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
        print(f"[TEST_KERNEL_REPORT_PERSISTENCE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
