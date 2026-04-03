#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    load_dotenv(ROOT_DIR / ".env")
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("BILLING_GUARD_ENABLED", "false")
    temp_dir = Path(tempfile.mkdtemp(prefix="deepseek_smoke_"))
    auth_db = temp_dir / "auth.sqlite"
    billing_db = temp_dir / "billing.sqlite"
    os.environ["DATABASE_URL"] = ""
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{auth_db.as_posix()}"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{billing_db.as_posix()}"

    force_cloud = os.getenv("DEEPSEEK_FORCE_CLOUD", "false").strip().lower() in {"1", "true", "yes", "on"}
    expected_backend = os.getenv("DEEPSEEK_EXPECT_BACKEND", "chatopenai:deepseek").strip().lower()
    if force_cloud:
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        _must(bool(api_key), "DEEPSEEK_FORCE_CLOUD=true but DEEPSEEK_API_KEY is empty")
    else:
        os.environ.setdefault("LLM_MOCK_FORCE", "true")

    from app import app

    with TestClient(app) as client:
        login = client.post("/auth/login", json={"username": "admin", "password": "change_me"})
        _must(login.status_code == 200, f"/auth/login failed: {login.status_code} {login.text}")
        token = str(login.json().get("access_token") or "")
        _must(len(token) > 20, "missing admin access token")

        smoke = client.post(
            "/llm/router/smoke",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "prompt": "Please reply exactly: deepseek-smoke-ok",
                "force_cloud": force_cloud,
                "tenant_tier": "pro",
                "task_type": "deepseek_smoke",
            },
        )
        _must(smoke.status_code == 200, f"/llm/router/smoke failed: {smoke.status_code} {smoke.text}")
        body = smoke.json()
        _must(body.get("ok") is True, f"smoke expected ok=true: {body}")
        _must("router" in body, f"smoke missing router payload: {body}")

        if force_cloud and expected_backend:
            backend_delta = body.get("backend_delta", {})
            matched = any(str(key).lower().startswith(expected_backend) for key in backend_delta.keys())
            _must(
                matched,
                f"expected backend prefix '{expected_backend}' not found in backend_delta={backend_delta}",
            )

        print(json.dumps(body, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[DEEPSEEK_SMOKE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
