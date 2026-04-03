#!/usr/bin/env python
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from libtv_skill_adapter import generate_storyboard_video


def _load_payload(path: str) -> dict[str, Any]:
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(f"payload not found: {p}")
    raw = p.read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    return payload


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    payload = _load_payload(args.storyboard)
    scenes = payload.get("scenes", [])
    if not isinstance(scenes, list):
        scenes = []
    task_description = str(payload.get("task_description", "video generation")).strip()
    tenant_id = str(payload.get("tenant_id", os.getenv("EDGE_TENANT_ID", "tenant_demo"))).strip()
    user_id = str(payload.get("user_id", os.getenv("EDGE_USER_ID", "edge_user"))).strip()
    reference_assets = payload.get("reference_assets", [])
    if not isinstance(reference_assets, list):
        reference_assets = []

    result = await generate_storyboard_video(
        task_description=task_description,
        scenes=[item for item in scenes if isinstance(item, dict)],
        tenant_id=tenant_id or "tenant_demo",
        user_id=user_id or "edge_user",
        reference_assets=reference_assets,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Render storyboard videos via LibTV OpenAPI.")
    parser.add_argument("--storyboard", required=True, help="Path to JSON payload with scenes/task_description")
    args = parser.parse_args()
    try:
        result = asyncio.run(_run(args))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
