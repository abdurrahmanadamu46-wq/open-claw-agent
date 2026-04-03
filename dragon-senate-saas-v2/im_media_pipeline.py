"""
im_media_pipeline.py — IM 媒体双向管道
======================================

统一处理：
- inbound 附件 -> 本地临时文件 / AI 附件
- outbound 产物 -> 渠道路由发送
"""

from __future__ import annotations

import base64
import mimetypes
import re
from pathlib import Path
from typing import Literal

from channel_account_manager import get_channel_sender

MediaType = Literal["image", "video", "audio", "file"]

ALLOWED_OUTBOUND_DIRS = [
    Path("data/artifacts"),
    Path("./data/artifacts"),
    Path("/tmp"),
    Path(".\\tmp"),
]

INBOUND_TMP_DIR = Path("./tmp/im-inbound")


def classify_media_type(file_path: str) -> MediaType:
    normalized = str(file_path or "").strip()
    mt, _ = mimetypes.guess_type(normalized)
    if mt:
        if mt.startswith("image/"):
            return "image"
        if mt.startswith("video/"):
            return "video"
        if mt.startswith("audio/"):
            return "audio"
    lower = normalized.lower()
    if lower.endswith(".mp4"):
        return "video"
    if lower.endswith(".opus"):
        return "audio"
    if lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        return "image"
    return "file"


def is_allowed_outbound(file_path: str) -> bool:
    p = Path(file_path).expanduser().resolve()
    for allowed in ALLOWED_OUTBOUND_DIRS:
        try:
            if str(p).startswith(str(allowed.resolve())):
                return True
        except Exception:
            continue
    return False


def extract_media_refs_from_output(output_text: str) -> list[str]:
    refs: list[str] = []
    text = str(output_text or "")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("MEDIA:") or stripped.startswith("MEDIA："):
            _, _, path = stripped.partition(":")
            candidate = path.strip()
            if candidate:
                refs.append(candidate)
    for match in re.finditer(r'!\[.*?\]\(([^)]+)\)', text):
        refs.append(match.group(1))
    for match in re.finditer(r'((?:[A-Za-z]:)?[\\/](?:tmp|data[\\/]+artifacts)[^"\s)]+)', text):
        refs.append(match.group(1))
    for match in re.finditer(r'(data/artifacts/[^\s"\')]+)', text):
        refs.append(match.group(1))
    dedup: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        normalized = str(ref or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        dedup.append(normalized)
    return dedup


def materialize_inbound_attachment(
    attachment_name: str,
    *,
    content_base64: str | None = None,
    content_bytes: bytes | None = None,
) -> str:
    INBOUND_TMP_DIR.mkdir(parents=True, exist_ok=True)
    target = (INBOUND_TMP_DIR / attachment_name).resolve()
    if content_bytes is not None:
        target.write_bytes(content_bytes)
    elif content_base64:
        target.write_bytes(base64.b64decode(content_base64))
    else:
        target.write_bytes(b"")
    return str(target)


def build_ai_attachment_payload(file_path: str) -> dict:
    media_type = classify_media_type(file_path)
    path = Path(file_path).resolve()
    if media_type == "image":
        raw = path.read_bytes()
        mime = mimetypes.guess_type(str(path))[0] or "image/png"
        return {
            "type": "image",
            "name": path.name,
            "data_url": f"data:{mime};base64,{base64.b64encode(raw).decode()}",
        }
    return {
        "type": media_type,
        "name": path.name,
        "path": f"file://{path}",
    }


async def send_media_to_channel(channel_id: str, file_path: str, caption: str = "", chat_id: str = "") -> bool:
    if not is_allowed_outbound(file_path):
        return False
    sender = get_channel_sender(channel_id)
    if sender is None:
        return False
    media_type = classify_media_type(file_path)
    return await sender.send_media(file_path=file_path, media_type=media_type, caption=caption, chat_id=chat_id)
