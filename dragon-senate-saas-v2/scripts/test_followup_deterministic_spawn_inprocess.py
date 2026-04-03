#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import os
import secrets
import string
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def _bootstrap_env() -> dict[str, str]:
    temp_dir = Path(tempfile.mkdtemp(prefix="dragon_followup_spawn_"))
    paths = {
        "temp_dir": str(temp_dir),
        "clawteam_db": str(temp_dir / "clawteam.sqlite"),
        "followup_db": str(temp_dir / "followup_subagents.sqlite"),
        "auth_db": str(temp_dir / "auth.sqlite"),
        "billing_db": str(temp_dir / "billing.sqlite"),
        "memory_db": str(temp_dir / "memory.sqlite"),
        "bandit_db": str(temp_dir / "bandit.sqlite"),
        "research_db": str(temp_dir / "research.sqlite"),
    }

    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ["CLAWTEAM_DB_PATH"] = paths["clawteam_db"]
    os.environ["FOLLOWUP_SUBAGENT_DB_PATH"] = paths["followup_db"]
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{paths['auth_db']}"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{paths['billing_db']}"
    os.environ["LOSSLESS_MEMORY_DB_PATH"] = paths["memory_db"]
    os.environ["POLICY_BANDIT_DB_PATH"] = paths["bandit_db"]
    os.environ["RESEARCH_RADAR_DB_PATH"] = paths["research_db"]
    os.environ["BILLING_GUARD_ENABLED"] = "false"
    os.environ["FEISHU_ENABLED"] = "false"
    os.environ["DINGTALK_ENABLED"] = "false"
    os.environ["LLM_MOCK_FORCE"] = "true"
    os.environ["LLM_MOCK_ENABLED"] = "true"
    os.environ["FOLLOWUP_DETERMINISTIC_SPAWN_ENABLED"] = "true"
    os.environ["FOLLOWUP_SUBAGENT_THRESHOLD"] = "2"
    os.environ["FOLLOWUP_MAX_CHILDREN"] = "10"
    os.environ["FOLLOWUP_LEADS_PER_CHILD"] = "2"
    os.environ["FOLLOWUP_CHILD_CONCURRENCY"] = "4"
    return paths


def _build_leads(count: int) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for idx in range(count):
        output.append(
            {
                "lead_id": f"lead_{idx + 1:02d}",
                "grade": "A" if idx % 3 == 0 else "B",
                "intent": "hot" if idx % 2 == 0 else "warm",
                "text": f"lead_text_{idx + 1}",
                "score": 0.92 if idx % 3 == 0 else 0.74,
            }
        )
    return output


def _get_admin_token(client: TestClient) -> str:
    login = client.post("/auth/login", json={"username": "admin", "password": "change_me"})
    if login.status_code == 200:
        token = str(login.json().get("access_token") or "")
        _must(len(token) > 20, "invalid token from /auth/login")
        return token

    email = os.getenv("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@liaoyuan.example.com")
    password = os.getenv("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "ChangeMe123!")
    jwt_login = client.post(
        "/auth/jwt/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    _must(jwt_login.status_code == 200, f"/auth/jwt/login failed: {jwt_login.status_code} {jwt_login.text}")
    token = str(jwt_login.json().get("access_token") or "")
    _must(len(token) > 20, "invalid token from /auth/jwt/login")
    return token


def main() -> int:
    paths = _bootstrap_env()

    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    from app import app  # pylint: disable=import-outside-toplevel
    from clawteam_inbox import summary as clawteam_summary  # pylint: disable=import-outside-toplevel
    from dragon_senate import dm_followup  # pylint: disable=import-outside-toplevel
    from dragon_senate import followup  # pylint: disable=import-outside-toplevel
    from followup_subagent_store import get_spawn_run  # pylint: disable=import-outside-toplevel
    from followup_subagent_store import list_recent_spawn_runs  # pylint: disable=import-outside-toplevel

    user_id = "admin"
    tenant_id = "tenant_demo"
    leads = _build_leads(10)

    main_trace = _rand("trace_main")
    main_state = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "trace_id": main_trace,
        "leads": leads,
        "score": 0.88,
        "clawteam_queue": {},
    }
    main_result = asyncio.run(followup(main_state))
    main_spawn = main_result.get("followup_spawn", {})
    _must(isinstance(main_spawn, dict) and bool(main_spawn.get("spawn_run_id")), "main followup spawn missing")
    _must(int(main_spawn.get("child_count", 0) or 0) >= 3, f"main child_count unexpected: {main_spawn}")

    main_persisted = get_spawn_run(tenant_id=tenant_id, user_id=user_id, trace_id=main_trace)
    _must(bool(main_persisted), "main persisted spawn row missing")
    _must(
        len(main_persisted.get("children", [])) == int(main_spawn.get("child_count", 0) or 0),
        f"main child rows mismatch: {main_persisted}",
    )
    main_queue_summary = clawteam_summary(user_id=user_id, trace_id=main_trace)
    _must(
        int(main_queue_summary.get("total", 0) or 0) == int(main_spawn.get("queue_inserted_count", 0) or 0),
        f"main queue total mismatch: queue={main_queue_summary} spawn={main_spawn}",
    )

    dm_trace = _rand("trace_dm")
    dm_state = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "trace_id": dm_trace,
        "edge_id": "edge_demo_01",
        "account_id": "acct_demo_01",
        "dm_text": "How to buy? what is price? I need details.",
        "leads": leads[:8],
        "score": 0.91,
        "clawteam_queue": {},
    }
    dm_result = asyncio.run(dm_followup(dm_state))
    dm_spawn = dm_result.get("followup_spawn", {})
    _must(isinstance(dm_spawn, dict) and bool(dm_spawn.get("spawn_run_id")), "dm followup spawn missing")
    _must(int(dm_spawn.get("child_count", 0) or 0) >= 2, f"dm child_count unexpected: {dm_spawn}")

    dm_persisted = get_spawn_run(tenant_id=tenant_id, user_id=user_id, trace_id=dm_trace)
    _must(bool(dm_persisted), "dm persisted spawn row missing")
    _must(
        len(dm_persisted.get("children", [])) == int(dm_spawn.get("child_count", 0) or 0),
        f"dm child rows mismatch: {dm_persisted}",
    )
    dm_queue_summary = clawteam_summary(user_id=user_id, trace_id=dm_trace)
    _must(
        int(dm_queue_summary.get("total", 0) or 0) == int(dm_spawn.get("queue_inserted_count", 0) or 0),
        f"dm queue total mismatch: queue={dm_queue_summary} spawn={dm_spawn}",
    )

    recent_rows = list_recent_spawn_runs(tenant_id=tenant_id, user_id=user_id, limit=10)
    _must(len(recent_rows) >= 2, f"recent spawn runs should include main+dm: {recent_rows}")

    with TestClient(app) as client:
        token = _get_admin_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        recent_resp = client.get(
            "/followup/spawns/recent",
            params={"user_id": user_id, "limit": 10},
            headers=headers,
        )
        _must(recent_resp.status_code == 200, f"/followup/spawns/recent failed: {recent_resp.status_code} {recent_resp.text}")
        recent_payload = recent_resp.json()
        trace_set = {str(item.get("trace_id") or "") for item in recent_payload.get("spawns", [])}
        _must(main_trace in trace_set and dm_trace in trace_set, f"recent traces missing: {recent_payload}")

        by_trace = client.get(
            f"/followup/spawns/{main_trace}",
            params={"user_id": user_id},
            headers=headers,
        )
        _must(by_trace.status_code == 200, f"/followup/spawns/{{trace}} failed: {by_trace.status_code} {by_trace.text}")
        by_trace_payload = by_trace.json()
        _must(
            str((((by_trace_payload.get("spawn") or {}).get("trace_id")) or "")) == main_trace,
            f"trace mismatch in /followup/spawns/{{trace}}: {by_trace_payload}",
        )

    print(
        json.dumps(
            {
                "ok": True,
                "env": {
                    "clawteam_db_path": paths["clawteam_db"],
                    "followup_db_path": paths["followup_db"],
                    "mock_llm": os.getenv("LLM_MOCK_FORCE", "false"),
                },
                "main": {
                    "trace_id": main_trace,
                    "spawn": main_spawn,
                    "queue_summary": main_queue_summary,
                },
                "dm": {
                    "trace_id": dm_trace,
                    "spawn": dm_spawn,
                    "queue_summary": dm_queue_summary,
                },
                "api_recent_count": int(len(recent_payload.get("spawns", []) or [])),
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
        print(f"[TEST_FOLLOWUP_DETERMINISTIC_SPAWN_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
