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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_rollout.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_rollout.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_rollout.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_rollout.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_rollout.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_rollout.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_rollout.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_rollout.sqlite")
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

    username = _rand("kroll")
    email = f"{username}@example.com"
    password = "KernelRolloutPassw0rd!2026"

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
                "note": "test-policy",
            },
        )
        _must(policy.status_code == 200, f"put policy failed: {policy.status_code} {policy.text}")

        policy_get = client.get("/kernel/rollout/policy", headers=headers)
        _must(policy_get.status_code == 200, f"get policy failed: {policy_get.status_code} {policy_get.text}")
        _must(bool(policy_get.json().get("policy")), "policy payload missing")

        run = client.post(
            "/run-dragon-team",
            headers=headers,
            json={
                "task_description": "请输出一套低风险私域导流方案",
                "user_id": username,
                "competitor_handles": ["openalex"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run failed: {run.status_code} {run.text}")
        trace_id = str(run.json().get("request_id") or "")
        _must(bool(trace_id), "trace id missing")

        rollback = client.post(
            f"/kernel/report/{trace_id}/rollback",
            headers=headers,
            json={"stage": "preflight", "dry_run": True},
        )
        _must(rollback.status_code == 200, f"rollback failed: {rollback.status_code} {rollback.text}")
        payload = rollback.json()
        _must(bool(payload.get("replay_payload")), "replay_payload missing")

    print(
        json.dumps(
            {
                "ok": True,
                "trace_id": trace_id,
                "policy_source": policy_get.json().get("policy", {}).get("source"),
                "rollback_stage": payload.get("stage"),
                "dry_run": payload.get("dry_run"),
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
        print(f"[TEST_KERNEL_ROLLOUT_AND_ROLLBACK_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

