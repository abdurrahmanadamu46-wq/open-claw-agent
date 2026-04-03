#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    db_path = ROOT / "_test_role_memory.sqlite"
    if db_path.exists():
        db_path.unlink()
    os.environ["MEMORY_GOVERNOR_DB_PATH"] = str(db_path)

    from senate_kernel import build_memory_context  # pylint: disable=import-outside-toplevel
    from senate_kernel import persist_kernel_memory  # pylint: disable=import-outside-toplevel

    persisted = persist_kernel_memory(
        tenant_id="tenant_demo",
        user_id="user_demo",
        trace_id="trace_role_memory_01",
        task_description="Plan a compliant local merchant growth workflow and route high-intent followup through approval.",
        strategy={
            "strategy_summary": "Use tenant KB, staged release, and HITL followup queue.",
            "route_summary": "hybrid_escalation -> hybrid_multisource -> approval_first",
        },
        guardian={
            "decision": "allow",
            "reason_codes": ["guardian.allow"],
            "policy_context": {"industry": "restaurant", "strategy_version": "guarded_v2"},
        },
        verification={
            "accepted": True,
            "route": "continue",
            "confidence_band": "high",
            "reason_codes": ["verification.pass"],
        },
        confidence={"low": 0.78, "center": 0.91, "high": 0.97},
    )

    snapshot = build_memory_context(
        tenant_id="tenant_demo",
        user_id="user_demo",
        task_description="restaurant workflow",
        hot_topics=["followup"],
    )

    _must(persisted.get("outcome") == "success", f"unexpected outcome: {persisted}")
    _must(snapshot.get("role_memory_count", 0) >= 4, f"role memory missing: {snapshot}")
    _must(snapshot.get("campaign_memory_count", 0) >= 1, f"campaign memory missing: {snapshot}")
    _must(snapshot.get("winning_playbook_count", 0) >= 4, f"winning playbooks missing: {snapshot}")
    _must(len(snapshot.get("role_memory", {}).get("strategist", [])) >= 1, f"strategist memory missing: {snapshot}")
    _must(snapshot.get("coverage", 0) > 0.2, f"coverage too low: {snapshot}")

    print(json.dumps({"ok": True, "persisted": persisted, "snapshot": snapshot}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_ROLE_MEMORY_FOLDING_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
