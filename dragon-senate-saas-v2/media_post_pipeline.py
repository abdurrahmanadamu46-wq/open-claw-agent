from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


@dataclass(slots=True)
class MediaAsset:
    url: str
    media_type: str
    ext: str
    local_path: str | None = None


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _normalize_url(url: str) -> str:
    return str(url or "").strip()


def _extract_ext(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or url
    return Path(path).suffix.lower()


def classify_media(url: str) -> MediaAsset:
    cleaned = _normalize_url(url)
    ext = _extract_ext(cleaned)
    media_type = "unknown"
    if ext in VIDEO_EXTS:
        media_type = "video"
    elif ext in IMAGE_EXTS:
        media_type = "image"
    return MediaAsset(url=cleaned, media_type=media_type, ext=ext)


def _ffprobe_available() -> bool:
    return _bool_env("MEDIA_POST_USE_FFPROBE", True) and bool(_which("ffprobe"))


def _which(executable: str) -> str:
    from shutil import which

    return str(which(executable) or "")


def _local_path_if_file_url(url: str) -> str | None:
    if not url:
        return None
    if re.match(r"^[a-zA-Z]:[\\/]", url):
        return url
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return parsed.path
    return None


def _probe_video_duration(path: str) -> float | None:
    if not _ffprobe_available():
        return None
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        row = subprocess.run(cmd, capture_output=True, text=True, timeout=3, check=True)
        value = float(str(row.stdout or "").strip())
        if value > 0:
            return value
    except Exception:  # noqa: BLE001
        return None
    return None


def _video_timeline_profile(duration_sec: float | None, vlog_narration_mode: bool) -> dict[str, Any]:
    if duration_sec is None:
        return {
            "timeline_mode": "unknown_duration",
            "suggested_target_sec": 15 if not vlog_narration_mode else 30,
            "scene_density": "medium",
        }
    if duration_sec <= 12:
        return {
            "timeline_mode": "short_ad",
            "suggested_target_sec": 10,
            "scene_density": "high",
        }
    if duration_sec <= 25:
        return {
            "timeline_mode": "story_15s",
            "suggested_target_sec": 15,
            "scene_density": "medium",
        }
    return {
        "timeline_mode": "vlog_long",
        "suggested_target_sec": 30 if vlog_narration_mode else 20,
        "scene_density": "low",
    }


def _image_retouch_profile(url: str, digital_human_mode: bool) -> dict[str, Any]:
    lower_url = str(url or "").lower()
    portrait_hint = any(token in lower_url for token in ["face", "portrait", "avatar", "人物", "数字人"])
    product_hint = any(token in lower_url for token in ["product", "商品", "包装", "food", "菜品"])
    level = "light"
    if digital_human_mode and portrait_hint:
        level = "pro_face"
    elif product_hint:
        level = "product_focus"
    return {
        "portrait_hint": portrait_hint,
        "product_hint": product_hint,
        "retouch_level": level,
    }


def build_post_production_plan(
    *,
    media_urls: list[str],
    industry: str,
    auto_image_retouch: bool,
    auto_video_edit: bool,
    auto_clip_cut: bool,
    digital_human_mode: bool,
    vlog_narration_mode: bool,
    digital_human_tuning: dict[str, Any] | None = None,
    vlog_tuning: dict[str, Any] | None = None,
) -> dict[str, Any]:
    digital_human_tuning = digital_human_tuning if isinstance(digital_human_tuning, dict) else {}
    vlog_tuning = vlog_tuning if isinstance(vlog_tuning, dict) else {}
    subtitle_density = str(vlog_tuning.get("subtitle_density", "medium") or "medium")
    narration_tone = str(vlog_tuning.get("narration_tone", "neutral") or "neutral")
    beat_cut_strength = float(vlog_tuning.get("beat_cut_strength", 0.55) or 0.55)
    lip_sync_weight = float(digital_human_tuning.get("lip_sync_weight", 0.82) or 0.82)
    speech_rate = float(digital_human_tuning.get("speech_rate", 1.0) or 1.0)

    assets = [classify_media(url) for url in media_urls if _normalize_url(url)]
    videos = [asset for asset in assets if asset.media_type == "video"]
    images = [asset for asset in assets if asset.media_type == "image"]

    video_jobs = []
    timeline_profiles: list[dict[str, Any]] = []
    for idx, asset in enumerate(videos, start=1):
        local_path = _local_path_if_file_url(asset.url) or ""
        duration = _probe_video_duration(local_path) if local_path else None
        timeline = _video_timeline_profile(duration, vlog_narration_mode)
        timeline_profiles.append(timeline)
        video_jobs.append(
            {
                "index": idx,
                "url": asset.url,
                "duration_sec": duration,
                "analysis": timeline,
                "actions": {
                    "trim_silence_head_tail": bool(auto_clip_cut),
                    "scene_cut_by_beat": bool(auto_clip_cut and vlog_narration_mode),
                    "subtitle_overlay": True,
                    "subtitle_density": subtitle_density,
                    "logo_watermark": True,
                    "voice_gain_normalize": bool(digital_human_mode or vlog_narration_mode),
                    "lip_sync_refine": bool(digital_human_mode),
                    "lip_sync_weight": round(lip_sync_weight, 3),
                    "speech_rate_target": round(speech_rate, 3),
                    "transition_pack": "vlog_soft" if vlog_narration_mode else "brand_clean",
                    "narration_tone": narration_tone,
                    "beat_cut_strength": round(beat_cut_strength, 3),
                },
            }
        )

    image_jobs = []
    image_profiles: list[dict[str, Any]] = []
    for idx, asset in enumerate(images, start=1):
        profile = _image_retouch_profile(asset.url, digital_human_mode)
        image_profiles.append(profile)
        image_jobs.append(
            {
                "index": idx,
                "url": asset.url,
                "analysis": profile,
                "actions": {
                    "face_retouch": bool(auto_image_retouch),
                    "skin_tone_balance": bool(auto_image_retouch and digital_human_mode),
                    "background_replace": bool(auto_image_retouch and vlog_narration_mode),
                    "brand_color_grade": True,
                },
            }
        )

    return {
        "industry": str(industry or "general").strip().lower() or "general",
        "video_count": len(videos),
        "image_count": len(images),
        "auto_video_edit": bool(auto_video_edit),
        "auto_image_retouch": bool(auto_image_retouch),
        "auto_clip_cut": bool(auto_clip_cut),
        "video_jobs": video_jobs,
        "image_jobs": image_jobs,
        "analysis_summary": {
            "video_timeline_modes": [str(item.get("timeline_mode")) for item in timeline_profiles],
            "image_retouch_levels": [str(item.get("retouch_level")) for item in image_profiles],
            "has_digital_human_asset": any(bool(item.get("portrait_hint")) for item in image_profiles),
        },
        "applied_tuning": {
            "digital_human_tuning": digital_human_tuning,
            "vlog_tuning": vlog_tuning,
        },
    }
