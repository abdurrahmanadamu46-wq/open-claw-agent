#!/usr/bin/env python
from __future__ import annotations

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


def main() -> int:
    os.environ["MEDIA_POST_USE_FFPROBE"] = "false"

    from media_post_pipeline import build_post_production_plan  # pylint: disable=import-outside-toplevel

    row = build_post_production_plan(
        media_urls=[
            "file:///tmp/hotel-avatar-01.mp4",
            "https://cdn.example.com/assets/portrait_hotel_hero.png",
            "https://cdn.example.com/assets/product_tea.jpg",
        ],
        industry="hotel",
        auto_image_retouch=True,
        auto_video_edit=True,
        auto_clip_cut=True,
        digital_human_mode=True,
        vlog_narration_mode=True,
    )

    _must(row.get("video_count") == 1, f"video_count mismatch: {row}")
    _must(row.get("image_count") == 2, f"image_count mismatch: {row}")
    video_jobs = row.get("video_jobs", [])
    image_jobs = row.get("image_jobs", [])
    _must(isinstance(video_jobs, list) and len(video_jobs) == 1, f"video_jobs mismatch: {row}")
    _must(isinstance(image_jobs, list) and len(image_jobs) == 2, f"image_jobs mismatch: {row}")
    _must("analysis" in video_jobs[0], f"video analysis missing: {video_jobs[0]}")
    _must("analysis" in image_jobs[0], f"image analysis missing: {image_jobs[0]}")
    _must(
        bool(video_jobs[0].get("actions", {}).get("lip_sync_refine")),
        f"expected lip_sync_refine enabled: {video_jobs[0]}",
    )
    summary = row.get("analysis_summary", {})
    _must(isinstance(summary.get("video_timeline_modes"), list), f"summary mismatch: {row}")

    print(json.dumps({"ok": True, "plan": row}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_MEDIA_POST_PIPELINE_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

