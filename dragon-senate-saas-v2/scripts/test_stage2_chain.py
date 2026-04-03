#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _rand(prefix: str, n: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def _setup_test_env() -> tuple[Path, Path]:
    temp_dir = Path(tempfile.mkdtemp(prefix="dragon_stage2_"))
    clawteam_db = temp_dir / "clawteam.sqlite"
    memory_db = temp_dir / "lossless.sqlite"

    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("BILLING_GUARD_ENABLED", "false")
    os.environ.setdefault("FEISHU_ENABLED", "false")
    os.environ.setdefault("DINGTALK_ENABLED", "false")
    os.environ.setdefault("DINGTALK_VERIFICATION_TOKEN", "ci-token")
    os.environ.setdefault("DINGTALK_VERIFY_SIGNATURE", "false")
    os.environ["CLAWTEAM_DB_PATH"] = str(clawteam_db)
    os.environ["LOSSLESS_MEMORY_DB_PATH"] = str(memory_db)
    return clawteam_db, memory_db


def _get_admin_token(client: TestClient) -> str:
    login = client.post("/auth/login", json={"username": "admin", "password": "change_me"})
    if login.status_code == 200:
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "invalid token from /auth/login")
        return token

    email = os.getenv("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@liaoyuan.example.com")
    password = os.getenv("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "ChangeMe123!")
    jwt_login = client.post(
        "/auth/jwt/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    _must(
        jwt_login.status_code == 200,
        f"/auth/jwt/login failed: {jwt_login.status_code} {jwt_login.text}",
    )
    token = jwt_login.json().get("access_token")
    _must(isinstance(token, str) and len(token) > 20, "invalid token from /auth/jwt/login")
    return token


def main() -> int:
    _setup_test_env()

    from app import app
    from clawteam_inbox import enqueue_inbox_tasks
    from lossless_memory import append_event

    started = time.time()
    trace_id = _rand("trace")
    replay_trace_id = _rand("replay")
    user_id = "admin"

    with TestClient(app) as client:
        token = _get_admin_token(client)
        auth_headers = {"Authorization": f"Bearer {token}"}

        enqueue_inbox_tasks(
            user_id=user_id,
            trace_id=trace_id,
            tasks=[
                {"task_key": "prepare", "lane": "radar", "priority": 10},
                {"task_key": "render", "lane": "ink", "priority": 20, "depends_on": ["prepare"]},
            ],
        )

        hb = client.post(
            "/clawteam/worker/heartbeat",
            json={
                "trace_id": trace_id,
                "worker_id": "worker-ci-1",
                "user_id": user_id,
                "lanes": ["radar", "ink"],
                "status": "idle",
                "meta": {"source": "ci-regression"},
            },
            headers=auth_headers,
        )
        _must(hb.status_code == 200, f"heartbeat failed: {hb.status_code} {hb.text}")

        claim_1 = client.post(
            "/clawteam/worker/claim",
            json={
                "trace_id": trace_id,
                "worker_id": "worker-ci-1",
                "user_id": user_id,
                "lanes": ["radar", "ink"],
                "limit": 5,
            },
            headers=auth_headers,
        )
        _must(claim_1.status_code == 200, f"claim_1 failed: {claim_1.status_code} {claim_1.text}")
        claim_1_json = claim_1.json()
        _must(claim_1_json.get("claimed_count", 0) >= 1, "claim_1 expected at least one task")
        _must(
            claim_1_json["claimed_tasks"][0].get("task_key") == "prepare",
            f"claim_1 first task should be prepare, got {claim_1_json['claimed_tasks']}",
        )

        ack_1 = client.post(
            "/clawteam/worker/ack",
            json={
                "trace_id": trace_id,
                "worker_id": "worker-ci-1",
                "user_id": user_id,
                "completed_task_keys": ["prepare"],
                "failed_task_keys": [],
            },
            headers=auth_headers,
        )
        _must(ack_1.status_code == 200, f"ack_1 failed: {ack_1.status_code} {ack_1.text}")

        claim_2 = client.post(
            "/clawteam/worker/claim",
            json={
                "trace_id": trace_id,
                "worker_id": "worker-ci-1",
                "user_id": user_id,
                "lanes": ["radar", "ink"],
                "limit": 5,
            },
            headers=auth_headers,
        )
        _must(claim_2.status_code == 200, f"claim_2 failed: {claim_2.status_code} {claim_2.text}")
        claim_2_json = claim_2.json()
        _must(claim_2_json.get("claimed_count", 0) >= 1, "claim_2 expected at least one task")
        _must(
            claim_2_json["claimed_tasks"][0].get("task_key") == "render",
            f"claim_2 first task should be render, got {claim_2_json['claimed_tasks']}",
        )

        ack_2 = client.post(
            "/clawteam/worker/ack",
            json={
                "trace_id": trace_id,
                "worker_id": "worker-ci-1",
                "user_id": user_id,
                "completed_task_keys": [],
                "failed_task_keys": ["render"],
                "error": "simulated_failure",
            },
            headers=auth_headers,
        )
        _must(ack_2.status_code == 200, f"ack_2 failed: {ack_2.status_code} {ack_2.text}")

        requeue = client.post(
            "/clawteam/requeue-stale",
            json={
                "trace_id": trace_id,
                "user_id": user_id,
                "stale_after_sec": 30,
                "max_attempt_count": 2,
            },
            headers=auth_headers,
        )
        _must(requeue.status_code == 200, f"requeue failed: {requeue.status_code} {requeue.text}")

        append_event(
            user_id=user_id,
            trace_id=replay_trace_id,
            node="api",
            event_type="start",
            payload={"ok": True},
            span_id="span-root",
        )
        append_event(
            user_id=user_id,
            trace_id=replay_trace_id,
            node="worker",
            event_type="step",
            payload={"stage": "execute"},
            parent_span_id="span-root",
        )

        replay = client.get(
            f"/memory/replay/{replay_trace_id}",
            params={"user_id": user_id},
            headers=auth_headers,
        )
        _must(replay.status_code == 200, f"memory replay failed: {replay.status_code} {replay.text}")
        replay_json = replay.json()
        _must(replay_json.get("ok") is True, "memory replay expected ok=true")
        _must(replay_json.get("replay", {}).get("event_count", 0) >= 2, "memory replay expected events")

        chat = client.post(
            "/webhook/chat_gateway",
            json={"chat_id": "ci-chat", "user_text": "hello-dragon"},
        )
        _must(chat.status_code == 200, f"chat gateway failed: {chat.status_code} {chat.text}")
        chat_json = chat.json()
        _must(chat_json.get("ok") is True, "chat gateway expected ok=true")

        # Token + replay validation path (DingTalk style envelope)
        secure_payload: dict[str, Any] = {
            "schema": "2.0",
            "conversationId": "cid-ci-001",
            "msgId": "msg-ci-001",
            "text": {"content": "hello-dragon"},
            "token": "ci-token",
        }
        secure_1 = client.post("/webhook/chat_gateway", json=secure_payload)
        _must(secure_1.status_code == 200, f"dingtalk secure_1 failed: {secure_1.status_code} {secure_1.text}")
        secure_2 = client.post("/webhook/chat_gateway", json=secure_payload)
        _must(secure_2.status_code == 401, f"dingtalk replay expected 401, got {secure_2.status_code}")

        queue_status = client.get(
            "/clawteam/queue",
            params={"trace_id": trace_id, "user_id": user_id, "limit": 20},
            headers=auth_headers,
        )
        _must(queue_status.status_code == 200, f"queue status failed: {queue_status.status_code} {queue_status.text}")
        queue_json = queue_status.json()
        summary = queue_json.get("summary", {})
        _must(summary.get("completed", 0) == 1, f"queue summary completed mismatch: {summary}")
        _must(summary.get("failed", 0) == 1, f"queue summary failed mismatch: {summary}")

        elapsed_ms = int((time.time() - started) * 1000)
        report = {
            "ok": True,
            "elapsed_ms": elapsed_ms,
            "trace_id": trace_id,
            "replay_trace_id": replay_trace_id,
            "queue_summary": summary,
            "chat_routed": chat_json.get("routed"),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[STAGE2_CHAIN_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
