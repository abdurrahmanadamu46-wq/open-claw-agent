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
            user_id="u_demo",
            task_description="生成酒店推广视频并进行安全分发，强调合规和人机协同审批",
            competitor_handles=["hotel_ref_1", "hotel_ref_2"],
            edge_targets=[{"edge_id": "edge_01"}],
        )
    )

    _must("publish_allowed" in row, f"publish_allowed missing: {row}")
    _must("reason_codes" in row and isinstance(row.get("reason_codes"), list), f"reason_codes missing: {row}")
    _must(row.get("confidence_band") in {"high", "medium", "low", "very_low"}, f"confidence_band invalid: {row}")

    print(json.dumps({"ok": True, "simulation": row}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_CAMPAIGN_GRAPH_PUBLISH_GATE_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

