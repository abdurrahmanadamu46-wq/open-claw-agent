#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


async def _run() -> dict[str, object]:
    os.environ["COMFYUI_ENABLED"] = "true"
    os.environ["COMFYUI_WORKFLOW_PATH"] = "F:/ComfyUI-aki/ComfyUI-latest/default_general.json"
    os.environ["COMFYUI_WORKFLOW_PATH_HOTEL"] = "F:/ComfyUI-aki/ComfyUI-latest/hotel_workflow.json"

    from dragon_senate import visualizer

    state = {
        "task_description": "生成酒店推广视频，主打亲子房和早餐",
        "tenant_id": "tenant_demo",
        "user_id": "u_demo",
        "hot_topics": ["酒店", "亲子", "早餐"],
        "inkwriter_output": {
            "scenes": [
                {"scene": 1, "copy": "高端酒店开场", "hook": "pain-question"},
                {"scene": 2, "copy": "亲子房展示", "hook": "proof"},
            ]
        },
    }
    mocked_comfy = {
        "ok": True,
        "mode": "mock",
        "prompt_id": "p_hotel_001",
        "result_urls": ["http://127.0.0.1:8188/view?filename=hotel.mp4&type=output&subfolder="],
    }
    with patch("dragon_senate.generate_storyboard_video_local", new=AsyncMock(return_value=mocked_comfy)):
        row = await visualizer(state)

    output = row.get("visualizer_output", {}) if isinstance(row, dict) else {}
    template = output.get("workflow_template", {}) if isinstance(output, dict) else {}
    _must(str(output.get("industry", "")) == "hotel", "industry should be hotel")
    _must(str(template.get("workflow_path", "")) == "F:/ComfyUI-aki/ComfyUI-latest/hotel_workflow.json", "hotel workflow should be selected")
    _must(str(output.get("engine", "")) == "comfyui-local", "engine should be comfyui-local")
    return {
        "ok": True,
        "industry": output.get("industry"),
        "workflow_template": template,
        "engine": output.get("engine"),
    }


def main() -> int:
    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_VISUALIZER_INDUSTRY_WORKFLOW_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

