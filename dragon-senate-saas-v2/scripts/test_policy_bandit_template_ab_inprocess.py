#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="policy_bandit_tpl_") as tmp:
        root = Path(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        db_path = Path(tmp) / "policy_bandit.sqlite"
        os.environ["POLICY_BANDIT_DB_PATH"] = db_path.as_posix()
        os.environ["POLICY_BANDIT_ENABLED"] = "true"
        os.environ["POLICY_BANDIT_EPSILON"] = "0.01"

        from policy_bandit import recommend_policy, snapshot, update_policy  # pylint: disable=import-outside-toplevel

        user_id = "u_template_bandit"
        scope = "workflow_template:hotel"
        candidates = ["hotel_v1", "hotel_v2"]
        first = recommend_policy(
            user_id,
            template_scope=scope,
            template_candidates=candidates,
            default_template="hotel_v1",
        )
        selected_first = str(first.get("workflow_template", "")).strip()
        _must(selected_first in candidates, f"invalid first template arm: {selected_first}")

        # Reward selected arm as successful rollout.
        update_policy(
            user_id=user_id,
            storyboard_count=7,
            tone="friendly_trustworthy",
            conversion_rate=0.82,
            replay_success_rate=0.95,
            complaint_rate=0.02,
            template_scope=scope,
            template_arm=selected_first,
            trace_id="trace_tpl_reward_1",
        )

        snap = snapshot(user_id)
        arms = [row for row in snap.get("arms", []) if row.get("arm_type") == scope]
        _must(len(arms) >= 1, "template scope arms should exist")
        rewarded = [row for row in arms if row.get("arm_value") == selected_first]
        _must(rewarded and int(rewarded[0].get("pulls", 0)) >= 1, "selected template arm should be updated")
        latest = snap.get("latest_update", {}) or {}
        _must(latest.get("template_scope") == scope, f"latest template_scope mismatch: {latest}")
        _must(latest.get("template_arm") == selected_first, f"latest template_arm mismatch: {latest}")

        print(
            json.dumps(
                {
                    "ok": True,
                    "first_policy": first,
                    "template_scope": scope,
                    "latest_update": latest,
                    "template_arms": arms,
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
        print(f"[TEST_POLICY_BANDIT_TEMPLATE_AB_INPROCESS_FAIL] {exc}")
        raise SystemExit(1)
