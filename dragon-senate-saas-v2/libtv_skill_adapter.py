from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

import httpx


PROJECT_CANVAS_BASE = "https://www.liblib.tv/canvas?projectId="
RESULT_URL_PATTERN = re.compile(
    r"https://libtv-res\.liblib\.art/[^\s\"'<>]+\.(?:png|jpg|jpeg|webp|mp4|mov|webm)",
    re.IGNORECASE,
)


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _im_base() -> str:
    return (
        os.getenv("OPENAPI_IM_BASE", "").strip()
        or os.getenv("IM_BASE_URL", "").strip()
        or "https://im.liblib.tv"
    ).rstrip("/")


def _access_key() -> str:
    return os.getenv("LIBTV_ACCESS_KEY", "").strip()


def _timeout() -> float:
    try:
        value = float(os.getenv("LIBTV_TIMEOUT_SEC", "30").strip())
    except ValueError:
        value = 30.0
    return min(max(value, 5.0), 180.0)


def _poll_interval() -> float:
    try:
        value = float(os.getenv("LIBTV_POLL_INTERVAL_SEC", "4").strip())
    except ValueError:
        value = 4.0
    return min(max(value, 0.5), 20.0)


def _poll_rounds() -> int:
    try:
        value = int(os.getenv("LIBTV_POLL_ROUNDS", "8").strip())
    except ValueError:
        value = 8
    return min(max(value, 1), 40)


def _enabled() -> bool:
    return _bool_env("LIBTV_ENABLED", False) and bool(_access_key())


def _headers() -> dict[str, str]:
    key = _access_key()
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _build_project_url(project_uuid: str) -> str:
    if not project_uuid:
        return ""
    return f"{PROJECT_CANVAS_BASE}{project_uuid}"


def _extract_urls_from_messages(messages: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            for found in RESULT_URL_PATTERN.findall(content):
                if found not in seen:
                    seen.add(found)
                    urls.append(found)
            if str(msg.get("role", "")).lower() == "tool":
                try:
                    payload = json.loads(content)
                except json.JSONDecodeError:
                    payload = {}
                task_result = payload.get("task_result", {}) if isinstance(payload, dict) else {}
                if isinstance(task_result, dict):
                    for row in task_result.get("images", []) or []:
                        if isinstance(row, dict):
                            preview = str(row.get("previewPath", "") or "").strip()
                            if preview and preview not in seen:
                                seen.add(preview)
                                urls.append(preview)
                    for row in task_result.get("videos", []) or []:
                        if isinstance(row, dict):
                            preview = str(row.get("previewPath", "") or row.get("url", "")).strip()
                            if preview and preview not in seen:
                                seen.add(preview)
                                urls.append(preview)
    return urls


async def _api_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        response = await client.post(f"{_im_base()}{path}", headers=_headers(), json=body)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        return {}
    return payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}


async def _api_get(path: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        response = await client.get(f"{_im_base()}{path}", headers=_headers())
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        return {}
    return payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}


def _build_libtv_message(
    *,
    task_description: str,
    scenes: list[dict[str, Any]],
    reference_urls: list[str],
    tenant_id: str,
    user_id: str,
    digital_human_tuning: dict[str, Any] | None = None,
    vlog_tuning: dict[str, Any] | None = None,
    customer_requirements: list[str] | None = None,
) -> str:
    digital_human_tuning = (
        {str(k): v for k, v in digital_human_tuning.items() if str(k).strip()}
        if isinstance(digital_human_tuning, dict)
        else {}
    )
    vlog_tuning = (
        {str(k): v for k, v in vlog_tuning.items() if str(k).strip()}
        if isinstance(vlog_tuning, dict)
        else {}
    )
    customer_requirements = [str(item).strip() for item in (customer_requirements or []) if str(item).strip()]

    payload = {
        "goal": "short_video_generation",
        "task_description": task_description,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "storyboard": scenes,
        "reference_urls": reference_urls[:6],
        "requirements": {
            "duration_sec": 15 if len(scenes) <= 7 else 30,
            "style": "commercial_social_realistic",
            "include_cta": True,
            "output_type": "video",
        },
        "policy_tuning": {
            "digital_human_tuning": digital_human_tuning,
            "vlog_tuning": vlog_tuning,
            "customer_requirements": customer_requirements[:5],
        },
    }
    return "请根据以下 JSON 生成营销短视频，保持角色和叙事风格一致，并优先输出可下载预览链接：\n" + json.dumps(
        payload, ensure_ascii=False
    )


def _extract_reference_urls(reference_assets: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for asset in reference_assets:
        if not isinstance(asset, dict):
            continue
        maybe = str(asset.get("url", "") or "").strip()
        if not maybe:
            continue
        if maybe in seen:
            continue
        seen.add(maybe)
        urls.append(maybe)
    return urls[:8]


async def change_project() -> dict[str, Any]:
    if not _enabled():
        return {"ok": False, "error": "libtv_disabled"}
    try:
        data = await _api_post("/openapi/session/change-project", {})
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    project_uuid = str(data.get("projectUuid", "") or "")
    return {
        "ok": bool(project_uuid),
        "project_uuid": project_uuid,
        "project_url": _build_project_url(project_uuid),
    }


async def query_session(session_id: str, after_seq: int = 0) -> dict[str, Any]:
    sid = str(session_id or "").strip()
    if not sid:
        return {"ok": False, "error": "missing_session_id"}
    if not _enabled():
        return {"ok": False, "error": "libtv_disabled"}
    query = f"/openapi/session/{sid}"
    if after_seq > 0:
        query = f"{query}?afterSeq={after_seq}"
    try:
        data = await _api_get(query)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "session_id": sid}
    messages = data.get("messages", []) if isinstance(data, dict) else []
    if not isinstance(messages, list):
        messages = []
    return {
        "ok": True,
        "mode": "api",
        "session_id": sid,
        "messages": messages,
        "result_urls": _extract_urls_from_messages(messages),
    }


async def generate_storyboard_video(
    *,
    task_description: str,
    scenes: list[dict[str, Any]],
    tenant_id: str,
    user_id: str,
    reference_assets: list[dict[str, Any]] | None = None,
    digital_human_tuning: dict[str, Any] | None = None,
    vlog_tuning: dict[str, Any] | None = None,
    customer_requirements: list[str] | None = None,
) -> dict[str, Any]:
    reference_assets = reference_assets or []
    reference_urls = _extract_reference_urls(reference_assets)
    message = _build_libtv_message(
        task_description=task_description,
        scenes=scenes,
        reference_urls=reference_urls,
        tenant_id=tenant_id,
        user_id=user_id,
        digital_human_tuning=digital_human_tuning,
        vlog_tuning=vlog_tuning,
        customer_requirements=customer_requirements,
    )
    if not _enabled():
        return {
            "ok": False,
            "mode": "disabled",
            "error": "libtv_disabled_or_missing_key",
            "message": "Set LIBTV_ENABLED=true and LIBTV_ACCESS_KEY first.",
        }

    change_each_run = _bool_env("LIBTV_CHANGE_PROJECT_EACH_RUN", False)
    changed_project: dict[str, Any] | None = None
    if change_each_run:
        changed_project = await change_project()

    body = {"message": message}
    try:
        created = await _api_post("/openapi/session", body)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "mode": "api", "error": str(exc), "stage": "create_session"}

    session_id = str(created.get("sessionId", "") or "")
    project_uuid = str(created.get("projectUuid", "") or "")
    if not session_id:
        return {"ok": False, "mode": "api", "error": "missing_session_id", "raw": created}

    rounds = _poll_rounds()
    interval_sec = _poll_interval()
    latest_messages: list[dict[str, Any]] = []
    result_urls: list[str] = []
    poll_errors: list[str] = []

    for _ in range(rounds):
        row = await query_session(session_id=session_id, after_seq=0)
        if not row.get("ok"):
            poll_errors.append(str(row.get("error", "query_failed")))
            await asyncio.sleep(interval_sec)
            continue
        latest_messages = row.get("messages", []) if isinstance(row.get("messages"), list) else []
        result_urls = row.get("result_urls", []) if isinstance(row.get("result_urls"), list) else []
        if result_urls:
            break
        await asyncio.sleep(interval_sec)

    return {
        "ok": True,
        "mode": "api",
        "session_id": session_id,
        "project_uuid": project_uuid or str(changed_project.get("project_uuid", "") if isinstance(changed_project, dict) else ""),
        "project_url": _build_project_url(project_uuid),
        "reference_url_count": len(reference_urls),
        "result_urls": result_urls,
        "messages": latest_messages[-12:],
        "poll_rounds": rounds,
        "poll_interval_sec": interval_sec,
        "poll_errors": poll_errors[:4],
        "applied_tuning": {
            "digital_human_tuning": digital_human_tuning if isinstance(digital_human_tuning, dict) else {},
            "vlog_tuning": vlog_tuning if isinstance(vlog_tuning, dict) else {},
            "customer_requirements": [str(item).strip() for item in (customer_requirements or []) if str(item).strip()][:5],
        },
    }


def libtv_status() -> dict[str, Any]:
    access_key = _access_key()
    return {
        "enabled": _enabled(),
        "has_access_key": bool(access_key),
        "im_base": _im_base(),
        "timeout_sec": _timeout(),
        "poll_interval_sec": _poll_interval(),
        "poll_rounds": _poll_rounds(),
        "change_project_each_run": _bool_env("LIBTV_CHANGE_PROJECT_EACH_RUN", False),
        "access_key_tail": access_key[-4:] if access_key else "",
    }


def render_skill_manifest_entry() -> dict[str, Any]:
    script_path = Path("scripts/skills/libtv_render.py").as_posix()
    return {
        "skill": "libtv-render",
        "description": "Generate short videos through LibTV OpenAPI session runtime.",
        "command": f"pkgx +python@3.12 python {script_path} --storyboard payload.json",
    }
