#!/usr/bin/env python
from __future__ import annotations

import asyncio
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


async def _run() -> dict[str, object]:
    os.environ["COMFYUI_CONVERTER_USE_OBJECT_INFO"] = "false"
    from workflow_converter import auto_convert_workflow_payload

    ui_payload = {
        "nodes": [
            {
                "id": 1,
                "type": "CLIPTextEncode",
                "inputs": [{"name": "clip", "type": "CLIP", "link": 1}],
                "widgets_values": ["酒店亲子房推广口播视频"],
            },
            {
                "id": 2,
                "type": "CheckpointLoaderSimple",
                "inputs": [],
                "widgets_values": ["hotel_model.safetensors"],
            },
        ],
        "links": [
            [1, 2, 1, 1, 0, "CLIP"],
        ],
    }
    row = await auto_convert_workflow_payload(ui_payload)
    _must(bool(row.get("ok")), f"convert failed: {row}")
    prompt = row.get("prompt", {})
    _must(isinstance(prompt, dict) and "1" in prompt and "2" in prompt, "converted prompt missing nodes")
    node1 = prompt["1"]
    node2 = prompt["2"]
    _must(node1.get("class_type") == "CLIPTextEncode", "node1 class_type mismatch")
    _must(node2.get("class_type") == "CheckpointLoaderSimple", "node2 class_type mismatch")
    _must(node1.get("inputs", {}).get("clip") == ["2", 1], "link conversion mismatch")
    _must(node1.get("inputs", {}).get("text"), "widget text mapping missing")
    _must(node2.get("inputs", {}).get("ckpt_name"), "widget ckpt_name mapping missing")
    return {
        "ok": True,
        "source_format": row.get("source_format"),
        "converted": row.get("converted"),
        "node_count": len(prompt),
        "diagnostics": row.get("diagnostics", {}),
    }


def main() -> int:
    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_WORKFLOW_CONVERTER_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
