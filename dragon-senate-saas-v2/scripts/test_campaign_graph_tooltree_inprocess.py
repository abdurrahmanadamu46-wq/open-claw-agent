#!/usr/bin/env python
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    from campaign_graph import CampaignGraphInput  # pylint: disable=import-outside-toplevel
    from campaign_graph import simulate_campaign_graph  # pylint: disable=import-outside-toplevel

    row = simulate_campaign_graph(
        CampaignGraphInput(
            user_id="u_planner",
            task_description="Plan a compliant campaign workflow with competitor research, staged channel rollout, and phone followup review.",
            competitor_handles=["competitor_a", "competitor_b", "competitor_c"],
            edge_targets=[
                {"edge_id": "edge_01"},
                {"edge_id": "edge_02"},
                {"edge_id": "edge_03"},
            ],
        )
    )

    planner_state = row.get("planner_state") or {}
    selected_branch = planner_state.get("selected_branch") or {}
    rejected_branches = planner_state.get("rejected_branches") or []
    search_stats = planner_state.get("search_stats") or {}

    _must(planner_state.get("engine") == "ToolTree-lite", f"unexpected planner engine: {planner_state}")
    _must(isinstance(selected_branch.get("branch_id"), str) and selected_branch.get("branch_id"), f"missing selected branch: {planner_state}")
    _must(set(row.get("selected_routes", {}).keys()) == {"model_route", "retrieval_route", "channel_route", "followup_route"}, f"selected routes missing: {row.get('selected_routes')}")
    _must(search_stats.get("depth_cap") == 3, f"depth cap invalid: {search_stats}")
    _must(int(search_stats.get("branch_cap") or 0) == 4, f"branch cap invalid: {search_stats}")
    _must(int(search_stats.get("final_stage") or search_stats.get("stage_counts", {}).get("final_stage") or 0) <= 4 or int(search_stats.get("stage_counts", {}).get("final_stage") or 0) <= 4, f"final branch count too high: {search_stats}")
    _must(search_stats.get("within_budget") in {True, False}, f"within_budget missing: {search_stats}")
    _must(isinstance(rejected_branches, list), f"rejected branches invalid: {planner_state}")
    if rejected_branches:
        _must("rejection_reason" in rejected_branches[0], f"rejection reason missing: {rejected_branches[0]}")

    print(json.dumps({"ok": True, "planner_state": planner_state, "selected_routes": row.get("selected_routes")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_CAMPAIGN_GRAPH_TOOLTREE_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
