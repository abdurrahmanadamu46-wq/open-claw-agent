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
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_hitl.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_hitl.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_hitl.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_hitl.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_hitl.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_hitl.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_hitl.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_hitl.sqlite")
    os.environ.setdefault("SENATE_KERNEL_ENABLED", "true")
    os.environ.setdefault("SENATE_KERNEL_GREY_RATIO", "100")
    os.environ.setdefault("SENATE_KERNEL_BLOCK_MODE", "hitl")
    os.environ.setdefault("HITL_ENABLED", "false")
    os.environ.setdefault("HITL_SHARED_SECRET", "edge-demo-secret")
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

    username = _rand("khitl")
    email = f"{username}@example.com"
    password = "KernelHitlPassw0rd!2026"

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

        run = client.post(
            "/run-dragon-team",
            headers=headers,
            json={
                "task_description": "测试内核回滚执行前审批",
                "user_id": username,
                "competitor_handles": ["openalex"],
                "edge_targets": [],
            },
        )
        _must(run.status_code == 200, f"run failed: {run.status_code} {run.text}")
        trace_id = str(run.json().get("request_id") or "")
        _must(bool(trace_id), "trace id missing")

        pending = client.post(
            f"/kernel/report/{trace_id}/rollback",
            headers=headers,
            json={"stage": "preflight", "dry_run": False},
        )
        _must(pending.status_code == 202, f"pending approval failed: {pending.status_code} {pending.text}")
        approval_id = str(pending.json().get("approval_id") or "")
        _must(bool(approval_id), "approval_id missing")

        approved = client.post(
            "/hitl/decide",
            headers={"x-hitl-secret": "edge-demo-secret"},
            json={
                "approval_id": approval_id,
                "decision": "approved",
                "operator": "kernel-test",
                "reason": "allow rollback execute",
            },
        )
        _must(approved.status_code == 200, f"approve failed: {approved.status_code} {approved.text}")

        execute = client.post(
            f"/kernel/report/{trace_id}/rollback",
            headers=headers,
            json={"stage": "preflight", "dry_run": False, "approval_id": approval_id},
        )
        _must(execute.status_code == 200, f"execute rollback failed: {execute.status_code} {execute.text}")
        payload = execute.json()
        _must(bool(payload.get("result")), "rollback result missing")

    print(
        json.dumps(
            {
                "ok": True,
                "trace_id": trace_id,
                "approval_id": approval_id,
                "rollback_trace_id": payload.get("rollback_trace_id"),
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
        print(f"[TEST_KERNEL_ROLLBACK_HITL_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
