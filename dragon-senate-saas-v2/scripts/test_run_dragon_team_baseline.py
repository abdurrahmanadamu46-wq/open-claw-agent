#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
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
    os.environ.setdefault("CLAWWORK_ECONOMY_ENABLED", "false")
    os.environ.setdefault("HITL_ENABLED", "false")

    force_real = os.getenv("RUN_BASELINE_FORCE_REAL", "false").strip().lower() in {"1", "true", "yes", "on"}
    use_stub = os.getenv("RUN_BASELINE_STUB", "true").strip().lower() in {"1", "true", "yes", "on"}
    task_description = os.getenv(
        "RUN_BASELINE_TASK_DESCRIPTION",
        "Baseline smoke task: generate a concise launch strategy and return summary.",
    ).strip()
    if not force_real:
        os.environ.setdefault("LLM_MOCK_FORCE", "true")

    temp_dir = Path(tempfile.mkdtemp(prefix="run_baseline_"))
    auth_db = temp_dir / "auth.sqlite"
    billing_db = temp_dir / "billing.sqlite"
    os.environ["DATABASE_URL"] = ""
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{auth_db.as_posix()}"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{billing_db.as_posix()}"

    import app as app_module

    app = app_module.app

    started = time.perf_counter()
    with TestClient(app) as client:
        async def _noop_report_usage(**_: object) -> dict[str, object]:
            return {"ok": True, "skipped": "baseline_noop"}

        app_module.report_usage = _noop_report_usage  # type: ignore[assignment]

        if use_stub:

            class _StubGraph:
                async def ainvoke(self, payload, config):  # noqa: ANN001
                    return {
                        "score": 0.88,
                        "hot_topics": ["baseline_stub"],
                        "competitor_analysis": {"mode": "stub"},
                        "content_package": {"package_id": "pkg-stub"},
                        "delivery_results": [],
                        "leads": [],
                        "competitor_formulas": [],
                        "competitor_multimodal_assets": [],
                        "rag_mode": "stub",
                        "rag_ingested_count": 0,
                        "dispatch_plan": {"mode": "stub"},
                        "edge_skill_plan": {"mode": "stub"},
                        "clawteam_queue": {"mode": "stub"},
                        "policy_bandit": {"mode": "stub"},
                        "hitl_required": False,
                        "hitl_decision": None,
                        "hitl_approval_id": None,
                        "hitl_reason": None,
                        "call_log": ["stub"],
                        "evolution_log": ["stub"],
                        "strategy": {"summary": "stub"},
                    }

            client.app.state.main_graph = _StubGraph()

        login = client.post("/auth/login", json={"username": "admin", "password": "change_me"})
        _must(login.status_code == 200, f"/auth/login failed: {login.status_code} {login.text}")
        token = str(login.json().get("access_token") or "")
        _must(len(token) > 20, "missing admin access token")

        route_before = client.get("/llm/router/metrics", headers={"Authorization": f"Bearer {token}"})
        _must(route_before.status_code == 200, f"/llm/router/metrics failed: {route_before.status_code}")
        before = route_before.json().get("metrics", {})
        before_backend = dict(before.get("backend_usage", {}) or {})

        request_payload = {
            "task_description": task_description,
            "user_id": "admin",
            "competitor_handles": [],
            "edge_targets": [],
        }
        run_resp = client.post(
            "/run-dragon-team",
            headers={"Authorization": f"Bearer {token}"},
            json=request_payload,
        )
        _must(run_resp.status_code == 200, f"/run-dragon-team failed: {run_resp.status_code} {run_resp.text}")
        run_body = run_resp.json()
        _must(run_body.get("status") == "success", f"unexpected run result: {run_body}")

        route_after = client.get("/llm/router/metrics", headers={"Authorization": f"Bearer {token}"})
        _must(route_after.status_code == 200, f"/llm/router/metrics failed: {route_after.status_code}")
        after = route_after.json().get("metrics", {})
        after_backend = dict(after.get("backend_usage", {}) or {})

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    backend_delta: dict[str, int] = {}
    for key in sorted(set(before_backend) | set(after_backend)):
        delta = int(after_backend.get(key, 0) or 0) - int(before_backend.get(key, 0) or 0)
        if delta != 0:
            backend_delta[key] = delta

    report = {
        "ok": True,
        "elapsed_ms": elapsed_ms,
        "force_real": force_real,
        "use_stub": use_stub,
        "thread_id": run_body.get("thread_id"),
        "score": run_body.get("score"),
        "rag_mode": run_body.get("rag_mode"),
        "delivery_results_count": len(run_body.get("delivery_results", []) or []),
        "lead_count": len(run_body.get("leads", []) or []),
        "backend_delta": backend_delta,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[RUN_BASELINE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
