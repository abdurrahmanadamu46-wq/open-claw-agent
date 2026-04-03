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
    os.environ.setdefault("LLM_MOCK_FORCE", "true")

    temp_dir = Path(tempfile.mkdtemp(prefix="run_async_"))
    auth_db = temp_dir / "auth.sqlite"
    billing_db = temp_dir / "billing.sqlite"
    os.environ["DATABASE_URL"] = ""
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{auth_db.as_posix()}"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{billing_db.as_posix()}"

    import app as app_module

    app = app_module.app

    with TestClient(app) as client:
        async def _noop_report_usage(**_: object) -> dict[str, object]:
            return {"ok": True, "skipped": "async_noop"}

        app_module.report_usage = _noop_report_usage  # type: ignore[assignment]

        class _StubGraph:
            async def ainvoke(self, payload, config):  # noqa: ANN001
                return {
                    "score": 0.88,
                    "hot_topics": ["async_stub"],
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
                    "followup_spawn": {"mode": "stub"},
                    "policy_bandit": {"mode": "stub"},
                    "constitutional_guardian": {"decision": "allow"},
                    "verification_gate": {"accepted": True},
                    "memory_governor": {"coverage": 0.3},
                    "publish_allowed": True,
                    "reason_codes": ["ok.async_stub"],
                    "confidence_band": "high",
                    "hitl_required": False,
                    "hitl_decision": None,
                    "hitl_approval_id": None,
                    "hitl_reason": None,
                    "call_log": ["stub"],
                    "evolution_log": ["stub"],
                    "strategy": {"summary": "stub", "confidence_interval": {"low": 0.7, "center": 0.9, "high": 0.98}},
                    "source_credibility": {"overall": 0.88},
                    "memory_context": {"coverage": 0.4},
                }

        client.app.state.main_graph = _StubGraph()

        login = client.post("/auth/login", json={"username": "admin", "password": "change_me"})
        _must(login.status_code == 200, f"/auth/login failed: {login.status_code} {login.text}")
        token = str(login.json().get("access_token") or "")
        _must(len(token) > 20, "missing admin access token")
        headers = {"Authorization": f"Bearer {token}"}

        accepted = client.post(
            "/run-dragon-team-async",
            headers=headers,
            json={
                "task_description": "Async smoke task: commander/TG should receive quick acceptance and poll later.",
                "user_id": "admin",
                "competitor_handles": [],
                "edge_targets": [],
            },
        )
        _must(accepted.status_code == 200, f"/run-dragon-team-async failed: {accepted.status_code} {accepted.text}")
        accepted_body = accepted.json()
        job_id = str(accepted_body.get("job_id") or "")
        _must(job_id.startswith("rdj_"), f"invalid job id: {accepted_body}")

        final_status = {}
        for _ in range(30):
            status = client.get(f"/run-dragon-team-async/{job_id}", headers=headers)
            _must(status.status_code == 200, f"/run-dragon-team-async/{{job_id}} failed: {status.status_code} {status.text}")
            final_status = status.json()
            if str(final_status.get("status")) in {"completed", "failed"}:
                break
            time.sleep(0.2)

        _must(final_status.get("status") == "completed", f"job did not complete: {final_status}")
        _must(isinstance(final_status.get("result"), dict), f"result missing: {final_status}")
        _must(str((final_status.get("result") or {}).get("status")) == "success", f"unexpected result payload: {final_status}")

    print(json.dumps({"ok": True, "job_id": job_id, "status": final_status.get("status")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_RUN_DRAGON_TEAM_ASYNC_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
