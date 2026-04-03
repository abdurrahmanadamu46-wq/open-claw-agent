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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_metrics.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_metrics.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_metrics.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_metrics.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_metrics.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_metrics.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_metrics.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_metrics.sqlite")
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

    username = _rand("kmetric")
    email = f"{username}@example.com"
    password = "KernelMetricsPassw0rd!2026"

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
                    "P2": {"rollout_ratio": 90, "strategy_version": "balanced_v2"},
                    "P3": {"rollout_ratio": 100, "strategy_version": "explore_v2"},
                },
                "note": "metrics-test-policy",
            },
        )
        _must(policy.status_code == 200, f"update policy failed: {policy.status_code} {policy.text}")

        for task in (
            "调研热点，输出低风险草稿",
            "批量私信引流执行计划",
            "内容分发并评论互动",
        ):
            run = client.post(
                "/run-dragon-team",
                headers=headers,
                json={
                    "task_description": task,
                    "user_id": username,
                    "competitor_handles": ["openalex"],
                    "edge_targets": [],
                },
            )
            _must(run.status_code == 200, f"run failed: {run.status_code} {run.text}")

        metrics = client.get("/kernel/metrics/dashboard", headers=headers, params={"granularity": "hour"})
        _must(metrics.status_code == 200, f"metrics failed: {metrics.status_code} {metrics.text}")
        data = metrics.json()
        totals = data.get("totals", {})
        _must("strategy_hit_rate" in totals, "strategy_hit_rate missing")
        _must("rollback_trigger_count" in totals, "rollback_trigger_count missing")
        _must("rollback_success_rate" in totals, "rollback_success_rate missing")
        _must("auto_pass_count" in totals, "auto_pass_count missing")
        _must("review_required_count" in totals, "review_required_count missing")
        _must("average_approval_latency_sec" in totals, "average_approval_latency_sec missing")
        by_risk = data.get("byRisk", {})
        _must(all(level in by_risk for level in ("P0", "P1", "P2", "P3")), "risk distribution missing")
        by_risk_family = data.get("byRiskFamily", {})
        _must(
            all(level in by_risk_family for level in ("single_agent", "inter_agent", "system_emergent")),
            "risk family distribution missing",
        )
        by_strategy = data.get("byStrategyVersion", [])
        _must(isinstance(by_strategy, list), "byStrategyVersion missing")
        _must(len(by_strategy) > 0, "byStrategyVersion empty")
        _must(all("strategy_version" in row for row in by_strategy), "invalid strategy version row")
        _must(data.get("query", {}).get("granularity") == "hour", "granularity mismatch")
        trend = data.get("strategyTrendSeries", [])
        _must(isinstance(trend, list), "strategyTrendSeries missing")
        _must(len(trend) > 0, "strategyTrendSeries empty")
        _must(all("bucket_start_utc" in row for row in trend), "invalid strategy trend row")
        autonomy_trend = data.get("autonomyTrendSeries", [])
        _must(isinstance(autonomy_trend, list), "autonomyTrendSeries missing")
        _must(len(autonomy_trend) > 0, "autonomyTrendSeries empty")
        _must(all("auto_pass" in row for row in autonomy_trend), "invalid autonomy trend row")

    print(
        json.dumps(
            {
                "ok": True,
                "totals": totals,
                "byRisk": by_risk,
                "byRiskFamily": by_risk_family,
                "byStrategyVersion": by_strategy[:3],
                "strategyTrendSeries": trend[:3],
                "autonomyTrendSeries": autonomy_trend[:3],
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
        print(f"[TEST_KERNEL_METRICS_DASHBOARD_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
