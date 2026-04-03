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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_alerts.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_alerts.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_alerts.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_alerts.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_alerts.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_alerts.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_alerts.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_alerts.sqlite")
    os.environ.setdefault("SENATE_KERNEL_ENABLED", "true")
    os.environ.setdefault("SENATE_KERNEL_GREY_RATIO", "100")
    os.environ.setdefault("SENATE_KERNEL_BLOCK_MODE", "hitl")
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

    username = _rand("kalert")
    email = f"{username}@example.com"
    password = "KernelAlertsPassw0rd!2026"

    with TestClient(app) as client:
        reg = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "is_active": True,
                "is_verified": True,
                "is_superuser": True,
                "username": username,
                "tenant_id": "tenant_demo",
                "roles": ["admin"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "token missing")
        headers = {"Authorization": f"Bearer {token}"}

        policy = client.put(
            "/kernel/rollout/policy",
            headers=headers,
            json={
                "tenant_id": "tenant_demo",
                "enabled": True,
                "rollout_ratio": 100,
                "block_mode": "hitl",
                "risk_rollout": {
                    "P0": {"rollout_ratio": 10, "strategy_version": "strict_v2"},
                    "P1": {"rollout_ratio": 40, "strategy_version": "guarded_v2"},
                    "P3": {"rollout_ratio": 100, "strategy_version": "explore_v2"},
                },
                "note": "alerts-test-policy",
            },
        )
        _must(policy.status_code == 200, f"update policy failed: {policy.status_code} {policy.text}")

        for task in (
            "批量私信外呼计划",
            "全自动矩阵并行投放",
            "普通策略梳理",
        ):
            run = client.post(
                "/run-dragon-team",
                headers=headers,
                json={
                    "task_description": task,
                    "user_id": username,
                    "competitor_handles": ["openalex", "github_projects"],
                    "edge_targets": [{"edge_id": "edge_01"}],
                },
            )
            _must(run.status_code == 200, f"run failed: {run.status_code} {run.text}")

        alerts = client.get("/kernel/alerts/evaluate", headers=headers, params={"granularity": "hour"})
        _must(alerts.status_code == 200, f"alerts failed: {alerts.status_code} {alerts.text}")
        data = alerts.json()
        _must(isinstance(data.get("signals"), list), "signals missing")
        _must(len(data.get("signals", [])) >= 3, "signals too short")
        _must(any("recommended_action" in item for item in data.get("signals", [])), "recommended action missing")
        _must("totals" in data and "approval_backlog" in data.get("totals", {}), "alert totals missing")

    print(json.dumps({"ok": True, "fired_count": data.get("fired_count"), "signals": data.get("signals", [])[:3]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_KERNEL_ALERTS_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
