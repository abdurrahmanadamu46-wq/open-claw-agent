#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


async def _run() -> dict[str, object]:
    os.environ.setdefault("CLAWTEAM_DB_PATH", str((Path(tempfile.mkdtemp(prefix="clawteam_policy_")) / "clawteam.sqlite")))
    os.environ["COMFYUI_ENABLED"] = "true"

    from clawteam_inbox import ensure_schema
    from dragon_senate import dispatcher, visualizer

    ensure_schema()

    state = {
        "task_description": "酒店客户要求：专业稳重语气，慢节奏讲解，突出预约方式和房型亮点",
        "tenant_id": "tenant_hotel",
        "user_id": "u_policy_tuning",
        "hot_topics": ["酒店", "住宿", "周末出游"],
        "strategy": {
            "industry_policy": {
                "industry": "hotel",
                "strategy_version": "hotel_conversion_v2",
                "customer_requirements": ["专业稳重", "慢节奏讲解", "突出预约方式和房型亮点"],
            },
            "customer_micro_tuning": {"tone": "trustworthy", "pace": "slow"},
            "digital_human_tuning": {
                "expression_intensity": 0.45,
                "speech_rate": 0.92,
                "lip_sync_weight": 0.88,
            },
            "vlog_tuning": {
                "subtitle_density": "light",
                "beat_cut_strength": 0.48,
                "narration_tone": "trustworthy",
            },
        },
        "inkwriter_output": {
            "scenes": [
                {"scene": 1, "copy": "开场介绍房型亮点", "hook": "benefit-hook"},
                {"scene": 2, "copy": "展示入住体验", "hook": "visual-surprise"},
                {"scene": 3, "copy": "结尾预约引导", "hook": "cta"},
            ]
        },
        "competitor_multimodal_assets": [],
        "edge_targets": [],
        "rag_ingested_count": 1,
    }

    mocked_comfyui = {
        "ok": True,
        "mode": "mock",
        "prompt_id": "comfy_policy_prompt_001",
        "result_urls": ["http://127.0.0.1:8188/view?filename=policy_01.mp4&subfolder=&type=output"],
    }
    local_mock = AsyncMock(return_value=mocked_comfyui)

    with patch("dragon_senate.generate_storyboard_video_local", new=local_mock):
        with patch("dragon_senate.generate_storyboard_video", new=AsyncMock(side_effect=RuntimeError("libtv fallback should not run"))):
            visualizer_state = await visualizer(dict(state))
            chained_state = dict(state)
            chained_state.update(visualizer_state)
            dispatcher_state = await dispatcher(chained_state)

    kwargs = dict(local_mock.await_args.kwargs) if local_mock.await_args else {}
    _must(kwargs.get("digital_human_tuning", {}).get("speech_rate") == 0.92, "digital_human_tuning not propagated")
    _must(kwargs.get("vlog_tuning", {}).get("narration_tone") == "trustworthy", "vlog_tuning not propagated")
    _must(kwargs.get("customer_requirements", [None])[0] == "专业稳重", "customer_requirements not propagated")

    visualizer_output = visualizer_state.get("visualizer_output", {}) if isinstance(visualizer_state, dict) else {}
    style_profile = visualizer_output.get("style_profile", {}) if isinstance(visualizer_output, dict) else {}
    generation_plan = visualizer_output.get("generation_plan", {}) if isinstance(visualizer_output, dict) else {}
    _must(bool(style_profile.get("digital_human_mode")), "digital_human_mode should be enabled from policy")
    _must(bool(style_profile.get("vlog_narration_mode")), "vlog_narration_mode should be enabled from policy")
    _must(style_profile.get("strategy_version") == "hotel_conversion_v2", "strategy_version missing from style_profile")
    _must(generation_plan.get("strategy_version") == "hotel_conversion_v2", "strategy_version missing from generation_plan")

    content_package = dispatcher_state.get("content_package", {}) if isinstance(dispatcher_state, dict) else {}
    post_plan = (
        content_package.get("ops_instruction", {}).get("post_production", {})
        if isinstance(content_package.get("ops_instruction"), dict)
        else {}
    )
    applied_tuning = post_plan.get("applied_tuning", {}) if isinstance(post_plan, dict) else {}
    _must(applied_tuning.get("vlog_tuning", {}).get("narration_tone") == "trustworthy", "post production tuning missing")

    return {
        "ok": True,
        "style_profile": style_profile,
        "generation_plan": {
            "strategy_version": generation_plan.get("strategy_version"),
            "digital_human_mode": generation_plan.get("digital_human_mode"),
            "vlog_narration_mode": generation_plan.get("vlog_narration_mode"),
        },
        "post_production_applied_tuning": applied_tuning,
    }


def main() -> int:
    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_VISUALIZER_POLICY_TUNING_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
