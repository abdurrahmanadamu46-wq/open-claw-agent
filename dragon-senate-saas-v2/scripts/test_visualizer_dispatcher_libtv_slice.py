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


async def _run_slice() -> dict[str, object]:
    os.environ.setdefault("CLAWTEAM_DB_PATH", str((Path(tempfile.mkdtemp(prefix="clawteam_slice_")) / "clawteam.sqlite")))

    from clawteam_inbox import ensure_schema
    from dragon_senate import dispatcher, visualizer

    ensure_schema()

    mock_initial_state = {
        "task_description": "生成宝妈喝茶 15 秒视频并分发",
        "tenant_id": "tenant_demo",
        "user_id": "slice_user",
        "hot_topics": ["宝妈", "养发", "成分党"],
        "strategy": {"rag_references": [{"category": "baoma"}]},
        "rag_ingested_count": 3,
        "edge_targets": [],
        "inkwriter_output": {
            "scenes": [
                {"scene": 1, "copy": "开场钩子", "hook": "pain-question"},
                {"scene": 2, "copy": "成分展示", "hook": "proof"},
                {"scene": 3, "copy": "CTA 转化", "hook": "cta"},
            ]
        },
        "competitor_multimodal_assets": [],
    }

    mocked_libtv = {
        "ok": True,
        "mode": "mock",
        "session_id": "libtv_mock_session_999",
        "project_uuid": "project_mock_999",
        "project_url": "https://www.liblib.tv/canvas?projectId=project_mock_999",
        "result_urls": [
            "https://libtv-res.liblib.art/mock/storyboard_01.mp4",
            "https://libtv-res.liblib.art/mock/storyboard_02.mp4",
            "https://libtv-res.liblib.art/mock/storyboard_03.mp4",
        ],
        "messages": [],
    }

    with patch("dragon_senate.generate_storyboard_video", new=AsyncMock(return_value=mocked_libtv)):
        visualizer_state = await visualizer(dict(mock_initial_state))
        chained_state = dict(mock_initial_state)
        chained_state.update(visualizer_state)
        final_state = await dispatcher(chained_state)

    visualizer_output = visualizer_state.get("visualizer_output", {}) if isinstance(visualizer_state, dict) else {}
    media_pack = visualizer_output.get("media_pack", []) if isinstance(visualizer_output, dict) else []
    _must(isinstance(media_pack, list) and len(media_pack) == 3, "visualizer media_pack should have 3 items")

    content_package = final_state.get("content_package", {}) if isinstance(final_state, dict) else {}
    jobs = content_package.get("jobs", []) if isinstance(content_package, dict) else []
    _must(isinstance(jobs, list) and len(jobs) >= 3, "dispatcher should build jobs from scene/media")

    urls = []
    for row in jobs:
        if not isinstance(row, dict):
            continue
        media = row.get("media")
        if isinstance(media, dict):
            url = str(media.get("url", "")).strip()
            if url:
                urls.append(url)
    _must(len(urls) >= 3, "dispatcher jobs should carry libtv media urls")

    visual_delivery = (
        content_package.get("ops_instruction", {}).get("visual_delivery", {})
        if isinstance(content_package.get("ops_instruction"), dict)
        else {}
    )
    _must(str(visual_delivery.get("engine", "")) == "libtv-skill", "visual_delivery.engine should be libtv-skill")
    _must(
        str(visual_delivery.get("libtv_session_id", "")) == "libtv_mock_session_999",
        "visual_delivery should include mocked libtv session id",
    )

    return {
        "ok": True,
        "media_pack_count": len(media_pack),
        "job_count": len(jobs),
        "first_media_url": urls[0] if urls else None,
        "visual_delivery": visual_delivery,
    }


def main() -> int:
    result = asyncio.run(_run_slice())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_VISUALIZER_DISPATCHER_LIBTV_SLICE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
