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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_chain.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_chain.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_chain.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_chain.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_chain.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_chain.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_chain.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_chain.sqlite")

    os.environ.setdefault("SENATE_KERNEL_ENABLED", "true")
    os.environ.setdefault("SENATE_KERNEL_GREY_RATIO", "100")
    os.environ.setdefault("SENATE_KERNEL_BLOCK_MODE", "hitl")
    os.environ.setdefault(
        "SENATE_KERNEL_RISK_ROLLOUT_JSON",
        json.dumps(
            {
                "P0": {"rollout_ratio": 100, "strategy_version": "strict_v1", "block_mode": "deny"},
                "P1": {"rollout_ratio": 100, "strategy_version": "guarded_v1", "block_mode": "hitl"},
                "P2": {"rollout_ratio": 100, "strategy_version": "balanced_v1", "block_mode": "hitl"},
                "P3": {"rollout_ratio": 100, "strategy_version": "explore_v1", "block_mode": "hitl"},
            },
            ensure_ascii=False,
        ),
    )
    os.environ.setdefault("HITL_ENABLED", "false")
    os.environ.setdefault("LLM_MOCK_FORCE", "true")
    os.environ.setdefault("LLM_FORCE_LOCAL", "true")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("kernel")
    email = f"{username}@example.com"
    password = "KernelChainPassw0rd!2026"

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
                "task_description": "请做一套稳健合规的短视频引流计划，不要自动化高风险动作",
                "user_id": username,
                "competitor_handles": ["openalex", "paperswithcode"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run-dragon-team failed: {run.status_code} {run.text}")
        payload = run.json()
        trace_id = str(payload.get("request_id") or "")
        _must(bool(trace_id), "trace/request_id missing")
        kernel_report = payload.get("kernel_report", {})
        _must(bool(kernel_report.get("applied")), "kernel preflight not applied")
        _must(isinstance(kernel_report.get("guardian", {}), dict), "guardian report missing")

        report = client.get(f"/kernel/report/{trace_id}?user_id={username}", headers=headers)
        _must(report.status_code == 200, f"kernel report failed: {report.status_code} {report.text}")
        report_json = report.json()
        _must(bool(report_json.get("kernel_report")), "kernel report endpoint empty")

    print(
        json.dumps(
            {
                "ok": True,
                "username": username,
                "trace_id": trace_id,
                "kernel_applied": bool(kernel_report.get("applied")),
                "kernel_guardian_decision": (kernel_report.get("guardian") or {}).get("decision"),
                "kernel_verification_accepted": (kernel_report.get("verification") or {}).get("accepted"),
                "hitl_required": bool(payload.get("hitl_required", False)),
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
        print(f"[TEST_KERNEL_CHAIN_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

