from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any


CAPABILITY_CATALOG: dict[str, dict[str, Any]] = {
    "wanvideo_lipsync": {
        "repo": "kijai/ComfyUI-WanVideoWrapper",
        "tags": ["t2v", "i2v", "vid2vid", "lipsync", "talking_avatar"],
        "env_flag": "COMFYUI_ENABLE_WANVIDEO",
        "node_hints": ["wanvideo", "fantasytalking", "fantasyportrait", "skyreels"],
    },
    "vibevoice_tts": {
        "repo": "Enemyx-net/VibeVoice-ComfyUI",
        "tags": ["tts", "voice_clone", "multi_speaker", "narration"],
        "env_flag": "COMFYUI_ENABLE_VIBEVOICE",
        "node_hints": ["vibevoice", "voiceclone", "speaker"],
    },
    "portrait_master": {
        "repo": "florestefano1975/comfyui-portrait-master",
        "tags": ["portrait", "identity_consistency", "face_style"],
        "env_flag": "COMFYUI_ENABLE_PORTRAIT_MASTER",
        "node_hints": ["portraitmaster", "basecharacter", "skin", "pose"],
    },
    "controlnet_aux": {
        "repo": "Fannovel16/comfyui_controlnet_aux",
        "tags": ["pose_control", "lineart", "hed", "face_only"],
        "env_flag": "COMFYUI_ENABLE_CONTROLNET_AUX",
        "node_hints": ["dwpose", "openpose", "hed", "lineart"],
    },
    "layerstyle_compositor": {
        "repo": "chflame163/ComfyUI_LayerStyle",
        "tags": ["layer_compose", "subtitle", "mask_video", "video_fx"],
        "env_flag": "COMFYUI_ENABLE_LAYERSTYLE",
        "node_hints": ["layerstyle", "sam2", "maskmotionblur"],
    },
    "easy_use_pack": {
        "repo": "yolain/ComfyUI-Easy-Use",
        "tags": ["rapid_build", "instantid", "workflow_simplify"],
        "env_flag": "COMFYUI_ENABLE_EASY_USE",
        "node_hints": ["easy-use", "instantid", "dynamicrafter"],
    },
    "llm_party_orchestrator": {
        "repo": "heshengtao/comfyui_LLM_party",
        "tags": ["llm_script", "tts_chain", "narration_agent"],
        "env_flag": "COMFYUI_ENABLE_LLM_PARTY",
        "node_hints": ["llm_party", "chattts", "gpt-sovits", "omost"],
    },
    "copilot_workflow_builder": {
        "repo": "AIDC-AI/ComfyUI-Copilot",
        "tags": ["workflow_debug", "workflow_autogen", "prompt_assist"],
        "env_flag": "COMFYUI_ENABLE_COPILOT",
        "node_hints": ["copilot", "workflowassistant"],
    },
    "custom_scripts_ui": {
        "repo": "pythongosssss/ComfyUI-Custom-Scripts",
        "tags": ["preset_text", "ui_productivity", "workflow_maintainability"],
        "env_flag": "COMFYUI_ENABLE_CUSTOM_SCRIPTS",
        "node_hints": ["customscripts", "presettext", "autosort"],
    },
    "ai_dock_runtime": {
        "repo": "ai-dock/comfyui",
        "tags": ["docker_runtime", "cloud_fallback", "gpu_scheduler"],
        "env_flag": "COMFYUI_ENABLE_AI_DOCK",
        "node_hints": ["ai-dock", "docker-comfyui"],
    },
}


INDUSTRY_PROFILE_HINTS: dict[str, dict[str, list[str]]] = {
    "hotel": {
        "must_have": ["wanvideo_lipsync", "vibevoice_tts", "layerstyle_compositor"],
        "nice_to_have": ["portrait_master", "controlnet_aux", "llm_party_orchestrator"],
    },
    "restaurant": {
        "must_have": ["wanvideo_lipsync", "layerstyle_compositor"],
        "nice_to_have": ["vibevoice_tts", "easy_use_pack", "controlnet_aux"],
    },
    "tcm": {
        "must_have": ["wanvideo_lipsync", "vibevoice_tts", "portrait_master"],
        "nice_to_have": ["controlnet_aux", "llm_party_orchestrator", "layerstyle_compositor"],
    },
    "housekeeping": {
        "must_have": ["wanvideo_lipsync", "vibevoice_tts"],
        "nice_to_have": ["layerstyle_compositor", "easy_use_pack"],
    },
    "beauty": {
        "must_have": ["portrait_master", "wanvideo_lipsync"],
        "nice_to_have": ["controlnet_aux", "layerstyle_compositor", "vibevoice_tts"],
    },
    "general": {
        "must_have": ["wanvideo_lipsync"],
        "nice_to_have": ["vibevoice_tts", "layerstyle_compositor", "easy_use_pack"],
    },
}


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _custom_nodes_root() -> Path | None:
    raw = os.getenv("COMFYUI_CUSTOM_NODES_ROOT", "").strip()
    if not raw:
        return None
    root = Path(raw).expanduser()
    return root if root.exists() else None


def _normalize_slug(value: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_-]+", "", str(value or "").strip().lower())
    return out[:96]


def _scan_custom_nodes() -> set[str]:
    root = _custom_nodes_root()
    if root is None:
        return set()
    names: set[str] = set()
    for child in root.iterdir():
        if child.is_dir():
            names.add(_normalize_slug(child.name))
    return names


def inspect_comfyui_capabilities() -> dict[str, Any]:
    custom_nodes = _scan_custom_nodes()
    rows: list[dict[str, Any]] = []
    enabled_count = 0
    for cap_key, meta in CAPABILITY_CATALOG.items():
        env_flag = str(meta.get("env_flag", "")).strip()
        hints = [str(item).strip().lower() for item in meta.get("node_hints", []) if str(item).strip()]
        env_enabled = _bool_env(env_flag, False) if env_flag else False
        node_hit = False
        if custom_nodes and hints:
            for node_name in custom_nodes:
                if any(hint in node_name for hint in hints):
                    node_hit = True
                    break
        enabled = bool(env_enabled or node_hit)
        if enabled:
            enabled_count += 1
        rows.append(
            {
                "key": cap_key,
                "enabled": enabled,
                "env_enabled": env_enabled,
                "node_hint_detected": node_hit,
                "repo": meta.get("repo"),
                "tags": meta.get("tags", []),
            }
        )

    readiness = round(enabled_count / max(1, len(rows)), 4)
    return {
        "enabled_count": enabled_count,
        "total_count": len(rows),
        "readiness": readiness,
        "custom_nodes_root": str(_custom_nodes_root() or ""),
        "capabilities": rows,
    }


def _is_digital_human_request(task_description: str) -> bool:
    text = str(task_description or "").lower()
    return any(
        token in text
        for token in [
            "口播",
            "数字人",
            "主播",
            "唇同步",
            "talking head",
            "avatar",
            "lip-sync",
            "lipsync",
        ]
    )


def _is_vlog_request(task_description: str) -> bool:
    text = str(task_description or "").lower()
    return any(
        token in text
        for token in [
            "vlog",
            "旁白",
            "第一视角",
            "探店",
            "日常",
            "narration",
        ]
    )


def build_comfyui_generation_plan(
    *,
    task_description: str,
    industry: str,
    capability_snapshot: dict[str, Any] | None = None,
    policy_context: dict[str, Any] | None = None,
    force_human_approval: bool = True,
) -> dict[str, Any]:
    snapshot = capability_snapshot or inspect_comfyui_capabilities()
    cap_map = {str(row.get("key")): bool(row.get("enabled")) for row in snapshot.get("capabilities", []) if isinstance(row, dict)}
    normalized_industry = _normalize_slug(industry) or "general"
    profile = INDUSTRY_PROFILE_HINTS.get(normalized_industry, INDUSTRY_PROFILE_HINTS["general"])
    must_have = [item for item in profile.get("must_have", []) if item]
    nice_to_have = [item for item in profile.get("nice_to_have", []) if item]
    missing_must = [item for item in must_have if not cap_map.get(item, False)]

    policy_context = policy_context if isinstance(policy_context, dict) else {}
    policy_digital = policy_context.get("digital_human_tuning", {}) if isinstance(policy_context.get("digital_human_tuning"), dict) else {}
    policy_vlog = policy_context.get("vlog_tuning", {}) if isinstance(policy_context.get("vlog_tuning"), dict) else {}
    policy_requirements = [
        str(item).strip()
        for item in policy_context.get("customer_requirements", [])
        if str(item).strip()
    ]

    digital_human_mode = _is_digital_human_request(task_description) or bool(policy_digital)
    vlog_mode = _is_vlog_request(task_description) or bool(policy_vlog)

    stages = [
        {"stage": "script", "engine": "llm_party_orchestrator" if cap_map.get("llm_party_orchestrator") else "inkwriter"},
        {"stage": "voice", "engine": "vibevoice_tts" if cap_map.get("vibevoice_tts") else "basic_tts"},
        {"stage": "avatar", "engine": "portrait_master" if cap_map.get("portrait_master") else "base_avatar"},
        {"stage": "pose_control", "engine": "controlnet_aux" if cap_map.get("controlnet_aux") else "none"},
        {"stage": "lip_sync", "engine": "wanvideo_lipsync" if cap_map.get("wanvideo_lipsync") else "libtv_fallback"},
        {"stage": "post_edit", "engine": "layerstyle_compositor" if cap_map.get("layerstyle_compositor") else "basic_overlay"},
    ]

    auto_image_retouch = bool(cap_map.get("portrait_master") or cap_map.get("easy_use_pack"))
    auto_video_edit = bool(cap_map.get("layerstyle_compositor") or cap_map.get("wanvideo_lipsync"))
    auto_clip_cut = bool(cap_map.get("layerstyle_compositor"))

    risk_level = "P2"
    if digital_human_mode and vlog_mode:
        risk_level = "P1"
    elif digital_human_mode or vlog_mode:
        risk_level = "P2"

    strategy_version = str(policy_context.get("strategy_version") or "").strip()

    return {
        "industry": normalized_industry,
        "digital_human_mode": digital_human_mode,
        "vlog_narration_mode": vlog_mode,
        "strategy_version": strategy_version,
        "customer_requirements": policy_requirements[:8],
        "digital_human_tuning": policy_digital,
        "vlog_tuning": policy_vlog,
        "must_have": must_have,
        "nice_to_have": nice_to_have,
        "missing_must": missing_must,
        "fallback_required": bool(missing_must),
        "render_provider_order": ["comfyui-local", "libtv-skill", "prompt-only"],
        "stages": stages,
        "auto_post_production": {
            "auto_image_retouch": auto_image_retouch,
            "auto_video_edit": auto_video_edit,
            "auto_clip_cut": auto_clip_cut,
        },
        "human_approval_required": bool(force_human_approval),
        "risk_level": risk_level,
        "readiness": snapshot.get("readiness", 0.0),
        "enabled_capability_count": snapshot.get("enabled_count", 0),
        "total_capability_count": snapshot.get("total_count", 0),
        "auto_post_pipeline_targets": {
            "enable_scene_analysis": True,
            "enable_image_retouch": auto_image_retouch,
            "enable_video_auto_cut": auto_clip_cut,
            "enable_vlog_auto_edit": auto_video_edit and vlog_mode,
        },
    }
