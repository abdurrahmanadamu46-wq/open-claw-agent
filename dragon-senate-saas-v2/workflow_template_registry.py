from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from workflow_converter import auto_convert_workflow_payload


def _template_root() -> Path:
    raw = os.getenv("COMFYUI_TEMPLATE_ROOT", "").strip()
    if raw:
        root = Path(raw).expanduser()
    else:
        root = Path(__file__).resolve().parent / "workflow_templates"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _slug(value: str, default: str = "template") -> str:
    norm = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "").strip().lower()).strip("-")
    return norm or default


def _normalize_workflow_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "workflow_json_must_be_object"
    prompt_from_field = payload.get("prompt")
    if isinstance(prompt_from_field, dict):
        return prompt_from_field, None
    workflow_from_field = payload.get("workflow")
    if isinstance(workflow_from_field, dict):
        prompt_in_workflow = workflow_from_field.get("prompt")
        if isinstance(prompt_in_workflow, dict):
            return prompt_in_workflow, None
    if payload and all(str(key).isdigit() for key in payload.keys()):
        return payload, None
    return None, "unsupported_workflow_json_format"


def _auto_convert_enabled() -> bool:
    return os.getenv("COMFYUI_TEMPLATE_AUTO_CONVERT", "true").strip().lower() in {"1", "true", "yes", "on"}


def _risk_patterns() -> list[str]:
    raw = os.getenv(
        "COMFYUI_TEMPLATE_BLOCK_CLASS_PATTERNS",
        "python,exec,shell,cmd,powershell,subprocess,system,nodejs,javascript",
    ).strip()
    if not raw:
        return []
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _strict_mode() -> bool:
    return os.getenv("COMFYUI_TEMPLATE_STRICT", "true").strip().lower() in {"1", "true", "yes", "on"}


def assess_workflow_risk(prompt_graph: dict[str, Any]) -> dict[str, Any]:
    blocked = _risk_patterns()
    node_rows: list[dict[str, Any]] = []
    blocked_hits: list[dict[str, Any]] = []
    for node_id, node_def in prompt_graph.items():
        if not isinstance(node_def, dict):
            continue
        class_type = str(node_def.get("class_type", "")).strip()
        node_rows.append({"id": str(node_id), "class_type": class_type})
        low = class_type.lower()
        for pattern in blocked:
            if pattern and pattern in low:
                blocked_hits.append({"id": str(node_id), "class_type": class_type, "pattern": pattern})
                break

    risk_level = "low"
    if blocked_hits:
        risk_level = "high"
    elif len(node_rows) > 120:
        risk_level = "medium"
    return {
        "risk_level": risk_level,
        "node_count": len(node_rows),
        "blocked_hits": blocked_hits,
        "strict_mode": _strict_mode(),
        "blocked_patterns": blocked,
    }


def _meta_path(industry_slug: str, name_slug: str) -> Path:
    return _template_root() / industry_slug / f"{name_slug}.meta.json"


def _json_path(industry_slug: str, name_slug: str) -> Path:
    return _template_root() / industry_slug / f"{name_slug}.api.json"


def _active_path(industry_slug: str) -> Path:
    return _template_root() / industry_slug / "active.json"


def save_template(
    *,
    industry: str,
    name: str,
    workflow_payload: dict[str, Any],
    source_url: str = "",
    source_repo: str = "",
    ref: str = "",
    conversion_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    industry_slug = _slug(industry, "general")
    name_slug = _slug(name, "default")
    local_conversion_info: dict[str, Any] = dict(conversion_info or {})
    normalized, normalize_error = _normalize_workflow_payload(workflow_payload)
    if normalized is None and _auto_convert_enabled():
        converted = _run_convert_sync(workflow_payload)
        if bool(converted.get("ok")):
            normalized = converted.get("prompt") if isinstance(converted.get("prompt"), dict) else None
            local_conversion_info = {
                "converted": bool(converted.get("converted", False)),
                "source_format": str(converted.get("source_format", "")),
                "diagnostics": converted.get("diagnostics", {}),
            }
        else:
            normalize_error = str(converted.get("error", normalize_error))

    if normalized is None:
        return {"ok": False, "error": normalize_error}
    risk = assess_workflow_risk(normalized)
    if risk.get("strict_mode") and risk.get("risk_level") == "high":
        return {
            "ok": False,
            "error": "workflow_blocked_by_policy",
            "risk": risk,
        }

    target_dir = _template_root() / industry_slug
    target_dir.mkdir(parents=True, exist_ok=True)

    json_path = _json_path(industry_slug, name_slug)
    meta_path = _meta_path(industry_slug, name_slug)

    json_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "industry": industry_slug,
        "name": name_slug,
        "source_url": source_url.strip(),
        "source_repo": source_repo.strip(),
        "ref": ref.strip() or "main",
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "json_path": json_path.as_posix(),
        "risk": risk,
        "conversion": local_conversion_info,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "industry": industry_slug,
        "name": name_slug,
        "json_path": json_path.as_posix(),
        "meta_path": meta_path.as_posix(),
        "risk": risk,
        "conversion": local_conversion_info,
    }


async def import_template_from_github_raw(
    *,
    industry: str,
    name: str,
    raw_url: str,
    source_repo: str = "",
    ref: str = "main",
    timeout_sec: float = 20.0,
) -> dict[str, Any]:
    url = str(raw_url or "").strip()
    if not url:
        return {"ok": False, "error": "raw_url_required"}
    if "raw.githubusercontent.com" not in url and "github.com" not in url:
        return {"ok": False, "error": "only_github_urls_allowed"}

    if "github.com" in url and "raw.githubusercontent.com" not in url:
        # https://github.com/org/repo/blob/ref/path -> raw
        url = url.replace("https://github.com/", "https://raw.githubusercontent.com/")
        url = url.replace("/blob/", "/")

    try:
        async with httpx.AsyncClient(timeout=max(3.0, min(timeout_sec, 120.0))) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"download_failed: {exc}"}

    if not isinstance(payload, dict):
        return {"ok": False, "error": "workflow_json_not_object"}

    conversion_info: dict[str, Any] = {}
    if _auto_convert_enabled():
        converted = await auto_convert_workflow_payload(payload)
        if not bool(converted.get("ok")):
            return {"ok": False, "error": str(converted.get("error", "workflow_convert_failed"))}
        prompt_payload = converted.get("prompt")
        if isinstance(prompt_payload, dict):
            payload = prompt_payload
        conversion_info = {
            "converted": bool(converted.get("converted", False)),
            "source_format": str(converted.get("source_format", "")),
            "diagnostics": converted.get("diagnostics", {}),
        }

    return save_template(
        industry=industry,
        name=name,
        workflow_payload=payload,
        source_url=url,
        source_repo=source_repo,
        ref=ref,
        conversion_info=conversion_info,
    )


def _run_convert_sync(payload: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        # Avoid deadlock in async contexts; keep fallback to legacy parser only.
        return {"ok": False, "error": "convert_in_running_loop_not_supported"}
    return asyncio.run(auto_convert_workflow_payload(payload))


def activate_template(*, industry: str, name: str) -> dict[str, Any]:
    industry_slug = _slug(industry, "general")
    name_slug = _slug(name, "default")
    src = _json_path(industry_slug, name_slug)
    if not src.exists():
        return {"ok": False, "error": "template_not_found"}
    active = _active_path(industry_slug)
    active.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return {"ok": True, "industry": industry_slug, "active_path": active.as_posix(), "source_path": src.as_posix()}


def resolve_active_template(industry: str) -> dict[str, Any]:
    industry_slug = _slug(industry, "general")
    active = _active_path(industry_slug)
    if active.exists():
        return {
            "industry": industry_slug,
            "workflow_path": active.as_posix(),
            "has_workflow": True,
            "source": "registry_active",
        }

    candidates = sorted((_template_root() / industry_slug).glob("*.api.json"))
    if candidates:
        latest = candidates[-1]
        return {
            "industry": industry_slug,
            "workflow_path": latest.as_posix(),
            "has_workflow": True,
            "source": "registry_latest",
        }
    return {
        "industry": industry_slug,
        "workflow_path": "",
        "has_workflow": False,
        "source": "registry_none",
    }


def resolve_template(industry: str, name: str) -> dict[str, Any]:
    industry_slug = _slug(industry, "general")
    name_slug = _slug(name, "default")
    row = _json_path(industry_slug, name_slug)
    if not row.exists():
        return {
            "industry": industry_slug,
            "name": name_slug,
            "workflow_path": "",
            "has_workflow": False,
            "source": "registry_named_missing",
        }
    return {
        "industry": industry_slug,
        "name": name_slug,
        "workflow_path": row.as_posix(),
        "has_workflow": True,
        "source": "registry_named",
    }


def list_templates_by_industry(industry: str) -> list[dict[str, Any]]:
    industry_slug = _slug(industry, "general")
    return [row for row in list_templates() if str(row.get("industry", "")) == industry_slug]


def list_templates() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    root = _template_root()
    for industry_dir in sorted(root.glob("*")):
        if not industry_dir.is_dir():
            continue
        industry = industry_dir.name
        active_path = _active_path(industry)
        for workflow_file in sorted(industry_dir.glob("*.api.json")):
            name = workflow_file.stem.replace(".api", "")
            meta_file = industry_dir / f"{name}.meta.json"
            meta: dict[str, Any] = {}
            if meta_file.exists():
                try:
                    parsed = json.loads(meta_file.read_text(encoding="utf-8"))
                    if isinstance(parsed, dict):
                        meta = parsed
                except Exception:  # noqa: BLE001
                    meta = {}
            rows.append(
                {
                    "industry": industry,
                    "name": name,
                    "workflow_path": workflow_file.as_posix(),
                    "meta_path": meta_file.as_posix() if meta_file.exists() else "",
                    "is_active": active_path.exists() and workflow_file.read_bytes() == active_path.read_bytes(),
                    "source_url": meta.get("source_url", ""),
                    "source_repo": meta.get("source_repo", ""),
                    "ref": meta.get("ref", ""),
                    "saved_at": meta.get("saved_at", ""),
                    "conversion": meta.get("conversion", {}),
                }
            )
    return rows


def recommended_github_sources() -> list[dict[str, Any]]:
    return [
        {
            "name": "ComfyUI Official Examples",
            "repo": "Comfy-Org/ComfyUI",
            "note": "Official script_examples and API export references",
            "example_raw_url": "https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/script_examples/basic_api_example.py",
        },
        {
            "name": "ComfyUI-Workflow-Hub",
            "repo": "ennis-ma/ComfyUI-Workflow-Hub",
            "note": "Workflow API hub and execution surface",
            "example_url": "https://github.com/ennis-ma/ComfyUI-Workflow-Hub",
        },
        {
            "name": "ComfyUI Workspace Manager",
            "repo": "11cafe/comfyui-workspace-manager",
            "note": "Workspace/model sync for local edge runtime",
            "example_url": "https://github.com/11cafe/comfyui-workspace-manager",
        },
        {
            "name": "ComfyUI Workflow Modules",
            "repo": "ruucm/ComfyUI-Workflow-Modules",
            "note": "Reusable sub-workflow architecture",
            "example_url": "https://github.com/ruucm/ComfyUI-Workflow-Modules",
        },
        {
            "name": "AEmotionStudio Workflows",
            "repo": "AEmotionStudio/AEmotionStudio-ComfyUI-Workflows",
            "note": "Template library for structured workflow patterns",
            "example_url": "https://github.com/AEmotionStudio/AEmotionStudio-ComfyUI-Workflows",
        },
        {
            "name": "ComfyUI Manager",
            "repo": "ltdrdata/ComfyUI-Manager",
            "note": "Node/model package manager (production baseline)",
            "example_url": "https://github.com/ltdrdata/ComfyUI-Manager",
        },
    ]
