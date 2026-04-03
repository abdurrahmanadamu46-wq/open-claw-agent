#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_inprocess.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_inprocess.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_inprocess.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_inprocess.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_inprocess.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_inprocess.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_inprocess.sqlite")
    os.environ.setdefault("COMFYUI_ENABLE_WANVIDEO", "true")
    os.environ.setdefault("COMFYUI_ENABLE_VIBEVOICE", "true")
    os.environ.setdefault("COMFYUI_ENABLE_LAYERSTYLE", "true")


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    _bootstrap_env()
    import app as app_module  # pylint: disable=import-outside-toplevel

    username = _rand("admin")
    email = f"{username}@example.com"
    password = "AdminPassw0rd!2026"

    with TestClient(app_module.app) as client:
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
                "roles": ["admin"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "invalid token")
        auth = {"Authorization": f"Bearer {token}"}

        cap = client.get("/integrations/comfyui/capabilities", headers=auth)
        _must(cap.status_code == 200, f"capabilities failed: {cap.status_code} {cap.text}")
        cap_json = cap.json()
        _must(bool(cap_json.get("ok")), f"capabilities response invalid: {cap_json}")

        plan = client.post(
            "/integrations/comfyui/pipeline/plan",
            headers=auth,
            json={
                "task_description": "生成酒店推广视频，数字人口播，旁白vlog",
                "industry": "hotel",
                "media_urls": [
                    "https://cdn.example.com/assets/portrait_hotel_hero.png",
                    "https://cdn.example.com/assets/hotel_story.mp4",
                ],
                "force_human_approval": True,
            },
        )
        _must(plan.status_code == 200, f"pipeline plan failed: {plan.status_code} {plan.text}")
        plan_json = plan.json()
        _must(bool(plan_json.get("ok")), f"pipeline response invalid: {plan_json}")
        gen = plan_json.get("generation_plan", {})
        post = plan_json.get("post_production_plan", {})
        _must(bool(gen.get("digital_human_mode")), f"digital_human_mode mismatch: {gen}")
        _must(bool(gen.get("vlog_narration_mode")), f"vlog_narration_mode mismatch: {gen}")
        _must(int(post.get("video_count", 0)) >= 1, f"video_count mismatch: {post}")
        _must(int(post.get("image_count", 0)) >= 1, f"image_count mismatch: {post}")

    print(
        json.dumps(
            {
                "ok": True,
                "capability_readiness": cap_json.get("capabilities", {}).get("readiness"),
                "generation_plan": gen,
                "post_production_plan": post,
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
        print(f"[TEST_COMFYUI_PIPELINE_PLAN_ENDPOINT_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

