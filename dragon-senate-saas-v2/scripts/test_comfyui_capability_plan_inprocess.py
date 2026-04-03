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
    os.environ["COMFYUI_ENABLE_WANVIDEO"] = "true"
    os.environ["COMFYUI_ENABLE_VIBEVOICE"] = "true"
    os.environ["COMFYUI_ENABLE_LAYERSTYLE"] = "true"
    os.environ["COMFYUI_ENABLE_PORTRAIT_MASTER"] = "true"

    from comfyui_capability_matrix import build_comfyui_generation_plan  # pylint: disable=import-outside-toplevel
    from comfyui_capability_matrix import inspect_comfyui_capabilities  # pylint: disable=import-outside-toplevel

    snapshot = inspect_comfyui_capabilities()
    plan = build_comfyui_generation_plan(
        task_description="生成酒店推广视频，数字人口播，旁白vlog节奏",
        industry="hotel",
        capability_snapshot=snapshot,
        force_human_approval=True,
    )

    _must(plan.get("industry") == "hotel", f"industry mismatch: {plan}")
    _must(bool(plan.get("digital_human_mode")), f"digital_human_mode mismatch: {plan}")
    _must(bool(plan.get("vlog_narration_mode")), f"vlog_narration_mode mismatch: {plan}")
    _must(isinstance(plan.get("stages"), list) and len(plan.get("stages", [])) >= 4, f"stages mismatch: {plan}")
    targets = plan.get("auto_post_pipeline_targets", {}) if isinstance(plan, dict) else {}
    _must(bool(targets.get("enable_scene_analysis")), f"scene analysis target missing: {targets}")
    _must("render_provider_order" in plan and isinstance(plan["render_provider_order"], list), f"provider order missing: {plan}")

    print(
        json.dumps(
            {
                "ok": True,
                "readiness": snapshot.get("readiness"),
                "generation_plan": plan,
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
        print(f"[TEST_COMFYUI_CAPABILITY_PLAN_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

