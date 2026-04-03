from __future__ import annotations

import asyncio
import copy
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _base_url() -> str:
    return (os.getenv("COMFYUI_BASE_URL", "").strip() or "http://127.0.0.1:8188").rstrip("/")


def _timeout() -> float:
    try:
        value = float(os.getenv("COMFYUI_TIMEOUT_SEC", "30").strip())
    except ValueError:
        value = 30.0
    return min(max(value, 3.0), 180.0)


def _poll_interval() -> float:
    try:
        value = float(os.getenv("COMFYUI_POLL_INTERVAL_SEC", "2").strip())
    except ValueError:
        value = 2.0
    return min(max(value, 0.5), 20.0)


def _poll_rounds() -> int:
    try:
        value = int(os.getenv("COMFYUI_POLL_ROUNDS", "20").strip())
    except ValueError:
        value = 20
    return min(max(value, 1), 120)


def _enabled() -> bool:
    return _bool_env("COMFYUI_ENABLED", False)


def _workflow_path() -> str:
    return os.getenv("COMFYUI_WORKFLOW_PATH", "").strip()


def _workflow_json() -> str:
    return os.getenv("COMFYUI_WORKFLOW_JSON", "").strip()


def _negative_prompt() -> str:
    return os.getenv(
        "COMFYUI_NEGATIVE_PROMPT",
        "low quality, bad anatomy, watermark, blurry, distorted, artifact",
    ).strip()


def _seed() -> int:
    try:
        return int(os.getenv("COMFYUI_SEED", "42").strip())
    except ValueError:
        return 42


def _width() -> int:
    try:
        return int(os.getenv("COMFYUI_WIDTH", "1024").strip())
    except ValueError:
        return 1024


def _height() -> int:
    try:
        return int(os.getenv("COMFYUI_HEIGHT", "576").strip())
    except ValueError:
        return 576


def _steps() -> int:
    try:
        return int(os.getenv("COMFYUI_STEPS", "25").strip())
    except ValueError:
        return 25


def _client_id(tenant_id: str, user_id: str) -> str:
    tenant = (tenant_id or "tenant").strip()[:48]
    user = (user_id or "user").strip()[:48]
    ts = int(datetime.now(timezone.utc).timestamp())
    return f"{tenant}:{user}:{ts}"


def _build_view_url(*, filename: str, subfolder: str, media_type: str) -> str:
    return f"{_base_url()}/view?filename={filename}&subfolder={subfolder}&type={media_type}"


def _load_workflow_template(
    *,
    workflow_path_override: str | None = None,
    workflow_json_override: str | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    def _normalize_template(parsed: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        prompt_from_field = parsed.get("prompt")
        if isinstance(prompt_from_field, dict):
            return prompt_from_field, None
        workflow_from_field = parsed.get("workflow")
        if isinstance(workflow_from_field, dict):
            prompt_in_workflow = workflow_from_field.get("prompt")
            if isinstance(prompt_in_workflow, dict):
                return prompt_in_workflow, None
        if parsed and all(str(key).isdigit() for key in parsed.keys()):
            return parsed, None
        if "nodes" in parsed and "links" in parsed:
            return (
                None,
                "workflow_export_not_supported: please provide API prompt graph JSON (or wrap under prompt field)",
            )
        return None, "invalid_workflow_template: expected prompt graph object"

    raw_json = (workflow_json_override or "").strip() or _workflow_json()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            return None, f"invalid_COMFYUI_WORKFLOW_JSON: {exc}"
        if not isinstance(parsed, dict):
            return None, "invalid_COMFYUI_WORKFLOW_JSON: expected object"
        return _normalize_template(parsed)

    raw_path = (workflow_path_override or "").strip() or _workflow_path()
    if not raw_path:
        return None, "missing_COMFYUI_WORKFLOW_PATH_or_JSON"

    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        return None, f"workflow_not_found: {path.as_posix()}"

    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, f"workflow_load_error: {exc}"
    if not isinstance(parsed, dict):
        return None, "workflow_template_must_be_object"
    return _normalize_template(parsed)


def _replace_tokens(value: Any, mapping: dict[str, Any]) -> Any:
    if isinstance(value, str):
        if value in mapping:
            return mapping[value]
        replaced = value
        for token, mapped in mapping.items():
            replaced = replaced.replace(token, str(mapped))
        return replaced
    if isinstance(value, list):
        return [_replace_tokens(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _replace_tokens(item, mapping) for key, item in value.items()}
    return value


def _extract_result_urls(history_payload: dict[str, Any], prompt_id: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    prompt_data = history_payload.get(prompt_id) if isinstance(history_payload, dict) else None
    if not isinstance(prompt_data, dict):
        prompt_data = history_payload if isinstance(history_payload, dict) else {}

    outputs = prompt_data.get("outputs", {})
    if not isinstance(outputs, dict):
        return urls

    for output in outputs.values():
        if not isinstance(output, dict):
            continue
        for media_key in ("images", "gifs", "videos"):
            rows = output.get(media_key, [])
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                direct_url = str(row.get("url", "")).strip()
                if direct_url and direct_url not in seen:
                    seen.add(direct_url)
                    urls.append(direct_url)
                    continue
                filename = str(row.get("filename", "")).strip()
                if not filename:
                    continue
                subfolder = str(row.get("subfolder", "")).strip()
                media_type = str(row.get("type", "output")).strip() or "output"
                view_url = _build_view_url(filename=filename, subfolder=subfolder, media_type=media_type)
                if view_url not in seen:
                    seen.add(view_url)
                    urls.append(view_url)
    return urls


async def _api_get(path: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        response = await client.get(f"{_base_url()}{path}")
        response.raise_for_status()
        payload = response.json()
    if isinstance(payload, dict):
        return payload
    return {}


async def _api_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        response = await client.post(f"{_base_url()}{path}", json=body)
        response.raise_for_status()
        payload = response.json()
    if isinstance(payload, dict):
        return payload
    return {}


def _build_prompt(task_description: str, scenes: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    desc = task_description.strip()
    if desc:
        lines.append(desc)
    for scene in scenes[:15]:
        if not isinstance(scene, dict):
            continue
        idx = scene.get("scene")
        copy_text = str(scene.get("copy", "")).strip()
        hook_text = str(scene.get("hook", "")).strip()
        lines.append(f"Scene {idx}: {copy_text} | Hook={hook_text}")
    if not lines:
        lines.append("Generate a conversion-focused short commercial video.")
    return "\n".join(lines)


def _normalize_tuning(value: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {str(k): v for k, v in value.items() if str(k).strip()}


async def query_prompt(prompt_id: str) -> dict[str, Any]:
    pid = str(prompt_id or "").strip()
    if not pid:
        return {"ok": False, "error": "missing_prompt_id"}
    if not _enabled():
        return {"ok": False, "error": "comfyui_disabled"}
    try:
        history = await _api_get(f"/history/{pid}")
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "prompt_id": pid}
    return {
        "ok": True,
        "mode": "api",
        "prompt_id": pid,
        "history": history,
        "result_urls": _extract_result_urls(history, pid),
    }


async def generate_storyboard_video_local(
    *,
    task_description: str,
    scenes: list[dict[str, Any]],
    tenant_id: str,
    user_id: str,
    reference_assets: list[dict[str, Any]] | None = None,
    digital_human_tuning: dict[str, Any] | None = None,
    vlog_tuning: dict[str, Any] | None = None,
    voice_profile: dict[str, Any] | None = None,
    customer_requirements: list[str] | None = None,
    workflow_path_override: str | None = None,
    workflow_json_override: str | None = None,
) -> dict[str, Any]:
    reference_assets = reference_assets or []
    digital_human_tuning = _normalize_tuning(digital_human_tuning)
    vlog_tuning = _normalize_tuning(vlog_tuning)
    voice_profile = _normalize_tuning(voice_profile)
    customer_requirements = [str(item).strip() for item in (customer_requirements or []) if str(item).strip()]

    prompt_text = _build_prompt(task_description, scenes)
    policy_lines: list[str] = []
    if digital_human_tuning:
        policy_lines.append(f"DigitalHumanTuning={json.dumps(digital_human_tuning, ensure_ascii=False)}")
    if vlog_tuning:
        policy_lines.append(f"VlogTuning={json.dumps(vlog_tuning, ensure_ascii=False)}")
    if voice_profile:
        policy_lines.append(f"VoiceProfile={json.dumps(voice_profile, ensure_ascii=False)}")
    if customer_requirements:
        policy_lines.append("CustomerRequirements=" + " | ".join(customer_requirements[:5]))
    if policy_lines:
        prompt_text = f"{prompt_text}\n\nPolicyHints:\n" + "\n".join(policy_lines)
    if not _enabled():
        return {
            "ok": False,
            "mode": "disabled",
            "error": "comfyui_disabled",
            "message": "Set COMFYUI_ENABLED=true first.",
        }

    workflow_template, workflow_error = _load_workflow_template(
        workflow_path_override=workflow_path_override,
        workflow_json_override=workflow_json_override,
    )
    if workflow_template is None:
        return {"ok": False, "mode": "api", "error": workflow_error or "workflow_template_missing"}

    mapping: dict[str, Any] = {
        "{{PROMPT}}": prompt_text,
        "{{NEGATIVE_PROMPT}}": _negative_prompt(),
        "{{SEED}}": _seed(),
        "{{WIDTH}}": _width(),
        "{{HEIGHT}}": _height(),
        "{{STEPS}}": _steps(),
        "{{SPEECH_RATE}}": float(digital_human_tuning.get("speech_rate", 1.0) or 1.0),
        "{{LIP_SYNC_WEIGHT}}": float(digital_human_tuning.get("lip_sync_weight", 0.82) or 0.82),
        "{{EXPRESSION_INTENSITY}}": float(digital_human_tuning.get("expression_intensity", 0.5) or 0.5),
        "{{NARRATION_TONE}}": str(vlog_tuning.get("narration_tone", "neutral") or "neutral"),
        "{{BEAT_CUT_STRENGTH}}": float(vlog_tuning.get("beat_cut_strength", 0.55) or 0.55),
        "{{SUBTITLE_DENSITY}}": str(vlog_tuning.get("subtitle_density", "medium") or "medium"),
        "{{VOICE_STYLE}}": str(voice_profile.get("style", "neutral") or "neutral"),
    }
    workflow = _replace_tokens(copy.deepcopy(workflow_template), mapping)
    payload = {
        "prompt": workflow,
        "client_id": _client_id(tenant_id=tenant_id, user_id=user_id),
    }

    try:
        created = await _api_post("/prompt", payload)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "mode": "api", "error": str(exc), "stage": "submit_prompt"}

    prompt_id = str(created.get("prompt_id", "")).strip()
    if not prompt_id:
        return {"ok": False, "mode": "api", "error": "missing_prompt_id", "raw": created}

    rounds = _poll_rounds()
    interval_sec = _poll_interval()
    result_urls: list[str] = []
    latest_history: dict[str, Any] = {}
    poll_errors: list[str] = []

    for _ in range(rounds):
        row = await query_prompt(prompt_id)
        if not row.get("ok"):
            poll_errors.append(str(row.get("error", "query_failed")))
            await asyncio.sleep(interval_sec)
            continue
        latest_history = row.get("history", {}) if isinstance(row.get("history"), dict) else {}
        result_urls = row.get("result_urls", []) if isinstance(row.get("result_urls"), list) else []
        if result_urls:
            break
        await asyncio.sleep(interval_sec)

    return {
        "ok": True,
        "mode": "api",
        "prompt_id": prompt_id,
        "message": prompt_text[:500],
        "result_urls": result_urls,
        "history": latest_history,
        "poll_rounds": rounds,
        "poll_interval_sec": interval_sec,
        "poll_errors": poll_errors[:4],
        "reference_asset_count": len(reference_assets),
        "applied_tuning": {
            "digital_human_tuning": digital_human_tuning,
            "vlog_tuning": vlog_tuning,
            "voice_profile": voice_profile,
            "customer_requirements": customer_requirements[:5],
        },
    }


async def comfyui_status() -> dict[str, Any]:
    row = {
        "enabled": _enabled(),
        "base_url": _base_url(),
        "timeout_sec": _timeout(),
        "poll_interval_sec": _poll_interval(),
        "poll_rounds": _poll_rounds(),
        "workflow_path": _workflow_path(),
        "has_workflow_json": bool(_workflow_json()),
    }
    if not _enabled():
        row["reachable"] = False
        row["mode"] = "disabled"
        return row
    try:
        stats = await _api_get("/system_stats")
    except Exception as exc:  # noqa: BLE001
        row["reachable"] = False
        row["mode"] = "api"
        row["error"] = str(exc)
        return row

    devices = []
    system = stats.get("system", {}) if isinstance(stats, dict) else {}
    if isinstance(system, dict):
        for item in system.get("devices", []) or []:
            if isinstance(item, dict):
                devices.append(
                    {
                        "name": item.get("name"),
                        "type": item.get("type"),
                        "vram_total": item.get("vram_total"),
                        "vram_free": item.get("vram_free"),
                    }
                )
    row["reachable"] = True
    row["mode"] = "api"
    row["devices"] = devices
    return row
