#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from libtv_skill_adapter import generate_storyboard_video
from libtv_skill_adapter import libtv_status
from libtv_skill_adapter import query_session


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


async def _run() -> dict[str, object]:
    os.environ.setdefault("LIBTV_ENABLED", "true")
    os.environ.setdefault("LIBTV_MOCK_FORCE", "true")

    status = libtv_status()
    _must(bool(status.get("enabled")), "libtv should be enabled in mock mode")
    _must(bool(status.get("mock_mode")), "libtv mock mode should be true")

    render = await generate_storyboard_video(
        task_description="生成宝妈喝茶 15 秒视频，突出温和成分和 CTA",
        scenes=[
            {"scene": 1, "copy": "开场钩子：熬夜后头发毛躁怎么办", "hook": "pain-question"},
            {"scene": 2, "copy": "展示成分与使用前后对比", "hook": "proof"},
            {"scene": 3, "copy": "结尾 CTA：私信领取试用", "hook": "cta"},
        ],
        tenant_id="tenant_demo",
        user_id="admin",
        reference_assets=[{"url": "https://example.com/ref_01.png"}],
    )
    _must(bool(render.get("ok")), f"render failed: {render}")
    result_urls = render.get("result_urls", [])
    _must(isinstance(result_urls, list) and len(result_urls) > 0, "expected mock result urls")

    session_id = str(render.get("session_id", "")).strip()
    _must(bool(session_id), "missing mock session id")
    query = await query_session(session_id=session_id, after_seq=0)
    _must(bool(query.get("ok")), f"query session failed: {query}")
    query_urls = query.get("result_urls", [])
    _must(isinstance(query_urls, list) and len(query_urls) > 0, "expected query result urls")

    return {
        "ok": True,
        "status": status,
        "render_media_count": len(result_urls),
        "first_media_url": result_urls[0],
        "query_media_count": len(query_urls),
    }


def main() -> int:
    report = asyncio.run(_run())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_LIBTV_MOCK_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
