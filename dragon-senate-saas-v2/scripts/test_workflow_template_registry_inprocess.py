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

from workflow_template_registry import activate_template
from workflow_template_registry import list_templates
from workflow_template_registry import resolve_active_template
from workflow_template_registry import save_template


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wf_registry_") as tmp:
        os.environ["COMFYUI_TEMPLATE_ROOT"] = tmp
        minimal_prompt_graph = {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "hotel promo", "clip": ["2", 0]}},
            "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        }
        saved = save_template(
            industry="hotel",
            name="hotel-default",
            workflow_payload=minimal_prompt_graph,
            source_url="https://raw.githubusercontent.com/example/repo/main/hotel.json",
            source_repo="example/repo",
            ref="main",
        )
        _must(bool(saved.get("ok")), f"save failed: {saved}")

        act = activate_template(industry="hotel", name="hotel-default")
        _must(bool(act.get("ok")), f"activate failed: {act}")

        rows = list_templates()
        _must(len(rows) == 1, f"expected 1 template row, got {len(rows)}")
        _must(bool(rows[0].get("is_active")), "template should be active")

        resolved = resolve_active_template("hotel")
        _must(bool(resolved.get("has_workflow")), "resolved workflow should exist")
        _must(str(resolved.get("source", "")).startswith("registry"), "resolved source should be registry")

        print(
            json.dumps(
                {
                    "ok": True,
                    "saved": saved,
                    "activated": act,
                    "resolved": resolved,
                    "rows": rows,
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
        print(f"[TEST_WORKFLOW_TEMPLATE_REGISTRY_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

