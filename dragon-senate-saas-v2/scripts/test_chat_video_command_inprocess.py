#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_inprocess.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_inprocess.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_inprocess.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_inprocess.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_inprocess.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_inprocess.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_inprocess.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_governor.sqlite")
    os.environ.setdefault("LLM_MOCK_FORCE", "true")
    os.environ.setdefault("LLM_FORCE_LOCAL", "true")
    os.environ.setdefault("HITL_ENABLED", "false")


def main() -> int:
    _bootstrap_env()
    import app as app_module  # pylint: disable=import-outside-toplevel

    mocked_video_task = AsyncMock(return_value=None)
    with patch.object(app_module, "_run_video_generation_from_chat", new=mocked_video_task):
        with TestClient(app_module.app) as client:
            resp = client.post(
                "/webhook/chat_gateway",
                json={"chat_id": "u_demo", "user_text": "生成酒店推广视频"},
            )
            _must(resp.status_code == 200, f"chat gateway status mismatch: {resp.status_code} {resp.text}")
            body = resp.json()
            _must(body.get("routed") == "video_generation", f"route mismatch: {body}")

    _must(mocked_video_task.await_count == 1, "video generation task should be scheduled exactly once")
    args = mocked_video_task.await_args.args if mocked_video_task.await_args else ()
    _must(len(args) >= 3 and str(args[2]).startswith("hotel"), f"industry parse mismatch: args={args}")

    print(
        json.dumps(
            {
                "ok": True,
                "routed": "video_generation",
                "background_task_called": mocked_video_task.await_count,
                "called_args": list(args[:3]),
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
        print(f"[TEST_CHAT_VIDEO_COMMAND_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
