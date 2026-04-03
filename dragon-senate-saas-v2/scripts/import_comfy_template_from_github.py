#!/usr/bin/env python
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from workflow_template_registry import activate_template
from workflow_template_registry import import_template_from_github_raw


async def _run(args: argparse.Namespace) -> dict:
    imported = await import_template_from_github_raw(
        industry=args.industry,
        name=args.name,
        raw_url=args.raw_url,
        source_repo=args.source_repo or "",
        ref=args.ref or "main",
    )
    if not imported.get("ok"):
        return {"ok": False, "stage": "import", "error": imported.get("error")}

    activated = None
    if args.activate:
        activated = activate_template(industry=args.industry, name=args.name)
        if not activated.get("ok"):
            return {"ok": False, "stage": "activate", "error": activated.get("error"), "imported": imported}
    return {"ok": True, "imported": imported, "activated": activated}


def main() -> int:
    parser = argparse.ArgumentParser(description="Import ComfyUI API-format workflow template from GitHub raw URL.")
    parser.add_argument("--industry", required=True, help="Industry slug, e.g. hotel/restaurant/tcm")
    parser.add_argument("--name", required=True, help="Template name")
    parser.add_argument("--raw-url", required=True, help="GitHub raw URL of API-format workflow JSON")
    parser.add_argument("--source-repo", default="", help="Source repo name, optional")
    parser.add_argument("--ref", default="main", help="Source ref/tag")
    parser.add_argument("--activate", action="store_true", help="Activate imported template immediately")
    args = parser.parse_args()

    result = asyncio.run(_run(args))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

