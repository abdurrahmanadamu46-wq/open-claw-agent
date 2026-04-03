#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wf_registry_ui_") as tmp:
        os.environ["COMFYUI_TEMPLATE_ROOT"] = tmp
        os.environ["COMFYUI_TEMPLATE_AUTO_CONVERT"] = "true"
        os.environ["COMFYUI_CONVERTER_USE_OBJECT_INFO"] = "false"

        from workflow_template_registry import save_template  # pylint: disable=import-outside-toplevel

        ui_payload = {
            "nodes": [
                {
                    "id": 1,
                    "type": "CLIPTextEncode",
                    "inputs": [{"name": "clip", "type": "CLIP", "link": 1}],
                    "widgets_values": ["酒店推广口播"],
                },
                {"id": 2, "type": "CheckpointLoaderSimple", "inputs": [], "widgets_values": ["hotel.safetensors"]},
            ],
            "links": [[1, 2, 1, 1, 0, "CLIP"]],
        }

        saved = save_template(
            industry="hotel",
            name="hotel-ui-imported",
            workflow_payload=ui_payload,
            source_url="https://example/raw/workflow.json",
            source_repo="example/repo",
            ref="main",
        )
        _must(bool(saved.get("ok")), f"save failed: {saved}")
        conversion = saved.get("conversion", {})
        _must(bool(conversion.get("converted")), f"conversion flag should be true: {conversion}")

        print(
            json.dumps(
                {
                    "ok": True,
                    "saved": saved,
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
        print(f"[TEST_WORKFLOW_TEMPLATE_REGISTRY_UI_CONVERT_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
