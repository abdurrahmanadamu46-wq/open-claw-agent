#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from workflow_template_catalog import recommend_official_templates


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


async def _run() -> dict:
    row = await recommend_official_templates(industry="hotel", limit=10)
    _must(bool(row.get("ok")), f"recommend failed: {row}")
    _must(int(row.get("count", 0)) > 0, "no templates recommended")
    return row


def main() -> int:
    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_WORKFLOW_TEMPLATE_CATALOG_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

