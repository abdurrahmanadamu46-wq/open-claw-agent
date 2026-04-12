import asyncio
import inspect
import json
import operator
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Callable
from urllib.parse import urlparse

from langchain_core.documents import Document
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from typing_extensions import TypedDict

from clawteam_inbox import claim_ready_tasks
from clawteam_inbox import enqueue_inbox_tasks
from clawteam_inbox import get_ready_tasks
from clawteam_inbox import mark_many_completed
from clawteam_inbox import mark_many_failed
from clawteam_inbox import summary as clawteam_summary
from comfyui_adapter import generate_storyboard_video_local
from comfyui_capability_matrix import build_comfyui_generation_plan
from comfyui_capability_matrix import inspect_comfyui_capabilities
from artifact_store import get_artifact_store
from industry_workflows import detect_industry, resolve_workflow
from libtv_skill_adapter import generate_storyboard_video
from llm_router import RouteMeta, llm_router
from lossless_memory import append_event as append_lossless_event
from media_post_pipeline import build_post_production_plan
from multimodal_rag_adapter import build_multimodal_documents
from multimodal_rag_adapter import collect_multimodal_assets
from multimodal_rag_adapter import enrich_formulas_with_multimodal
from multimodal_rag_adapter import ingest_raganything_runtime
from multimodal_rag_adapter import query_raganything_hybrid
from smart_routing import ModelTier
from qdrant_config import fetch_recent_formula_documents
from qdrant_config import ingest_formula_documents
from qdrant_config import search_formula_documents
from senate_kernel import build_memory_context as kernel_build_memory_context
from senate_kernel import compute_source_credibility as kernel_compute_source_credibility
from senate_kernel import constitutional_guardian as kernel_constitutional_guardian
from senate_kernel import estimate_strategy_confidence as kernel_estimate_strategy_confidence
from senate_kernel import persist_kernel_memory as kernel_persist_kernel_memory
from senate_kernel import verification_gate as kernel_verification_gate
from policy_bandit import recommend_policy
from policy_bandit import snapshot as policy_bandit_snapshot
from policy_bandit import update_policy as policy_bandit_update
from lobster_pool_manager import get_lobster_registry
from workflow_template_registry import list_templates_by_industry
from workflow_template_registry import resolve_template
from voice_orchestrator import get_voice_orchestrator
from followup_subagent_store import create_spawn_run as create_followup_spawn_run
from followup_subagent_store import finish_spawn_run as finish_followup_spawn_run
from followup_subagent_store import get_spawn_run as get_followup_spawn_run
from followup_subagent_store import plan_deterministic_subagents
from followup_subagent_store import record_child_run as record_followup_child_run


class EdgeTarget(TypedDict, total=False):
    edge_id: str
    account_id: str
    webhook_url: str
    instruction_hint: str
    skills: list[str]
    skill_manifest_path: str
    skill_commands: list[str]
    skill_manifest_meta: dict[str, Any]


class DragonState(TypedDict, total=False):
    trace_id: str
    task_description: str
    user_id: str
    tenant_id: str
    industry_tag: str
    industry_kb_context: list[dict[str, Any]]
    messages: list[Any]
    competitor_handles: list[str]
    target_account_url: str
    analysis_mode: bool
    edge_targets: list[EdgeTarget]

    radar_data: dict[str, Any]
    source_credibility: dict[str, Any]
    memory_context: dict[str, Any]
    strategy_confidence: dict[str, Any]
    constitutional_guardian: dict[str, Any]
    verification_gate: dict[str, Any]
    memory_governor: dict[str, Any]
    publish_allowed: bool
    reason_codes: list[str]
    confidence_band: str
    hot_topics: list[str]
    strategy: dict[str, Any]
    competitor_analysis: dict[str, Any]
    competitor_formulas: list[dict[str, Any]]
    competitor_multimodal_assets: list[dict[str, Any]]
    rag_graph_links: list[dict[str, Any]]
    rag_mode: str
    rag_runtime: dict[str, Any]
    rag_ingested_count: int
    rag_recent_digest: list[dict[str, Any]]

    inkwriter_output: dict[str, Any]
    visualizer_output: dict[str, Any]
    content_package: dict[str, Any]
    dispatch_plan: dict[str, Any]
    edge_skill_plan: dict[str, Any]
    clawteam_queue: dict[str, Any]
    policy_bandit: dict[str, Any]

    edge_target: EdgeTarget
    delivery_results: Annotated[list[dict[str, Any]], operator.add]

    echoer_output: dict[str, Any]
    catcher_output: dict[str, Any]
    abacus_output: dict[str, Any]
    followup_output: dict[str, Any]
    followup_spawn: dict[str, Any]

    leads: list[dict[str, Any]]
    score: float
    hitl_required: bool
    hitl_approval_id: str
    hitl_decision: str
    hitl_reason: str

    call_log: Annotated[list[dict[str, Any]], operator.add]
    evolution_log: Annotated[list[dict[str, Any]], operator.add]


class DMState(TypedDict, total=False):
    edge_id: str
    account_id: str
    dm_text: str
    user_id: str
    tenant_id: str
    trace_id: str

    catcher_output: dict[str, Any]
    abacus_output: dict[str, Any]
    followup_output: dict[str, Any]
    followup_spawn: dict[str, Any]
    clawteam_queue: dict[str, Any]

    leads: list[dict[str, Any]]
    score: float
    call_log: Annotated[list[dict[str, Any]], operator.add]


EdgeDeliveryHook = Callable[[dict[str, Any]], dict[str, Any] | Any]
_edge_delivery_hook: EdgeDeliveryHook | None = None
HumanApprovalRequestHook = Callable[[dict[str, Any]], dict[str, Any] | Any]
HumanApprovalAwaitHook = Callable[[str, int], dict[str, Any] | Any]
_human_approval_request_hook: HumanApprovalRequestHook | None = None
_human_approval_await_hook: HumanApprovalAwaitHook | None = None

_daily_rag_scan_cache: dict[str, dict[str, Any]] = {}

_BUSINESS_LOBSTER_NODE_FACTORY_NAMES: dict[str, str] = {
    "radar": "radar",
    "strategist": "strategist",
    "inkwriter": "inkwriter",
    "visualizer": "visualizer",
    "dispatcher": "dispatcher",
    "echoer": "echoer",
    "catcher": "catcher",
    "abacus": "abacus",
    "followup": "followup",
}


def _resolve_registered_main_graph_roles() -> list[str]:
    try:
        registry = get_lobster_registry()
    except Exception:
        registry = {}
    if not isinstance(registry, dict) or not registry:
        return list(_BUSINESS_LOBSTER_NODE_FACTORY_NAMES.keys())
    ordered = [role_id for role_id in registry.keys() if role_id in _BUSINESS_LOBSTER_NODE_FACTORY_NAMES]
    for role_id in _BUSINESS_LOBSTER_NODE_FACTORY_NAMES:
        if role_id not in ordered:
            ordered.append(role_id)
    return ordered


def set_edge_delivery_hook(hook: EdgeDeliveryHook | None) -> None:
    global _edge_delivery_hook
    _edge_delivery_hook = hook


def set_human_approval_hooks(
    request_hook: HumanApprovalRequestHook | None,
    await_hook: HumanApprovalAwaitHook | None,
) -> None:
    global _human_approval_request_hook
    global _human_approval_await_hook
    _human_approval_request_hook = request_hook
    _human_approval_await_hook = await_hook


def _clawhub_keys() -> dict[str, str]:
    raw = os.getenv("CLAWHUB_KEYS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except json.JSONDecodeError:
        pass
    return {}


def _registry_skill_bindings() -> dict[str, list[str]]:
    """@deprecated use LobsterSkillRegistry as the primary metadata source."""
    bindings: dict[str, list[str]] = {}
    try:
        from lobster_skill_registry import get_skill_registry

        registry = get_skill_registry()
        for lobster_id in (
            "radar",
            "strategist",
            "inkwriter",
            "visualizer",
            "dispatcher",
            "echoer",
            "catcher",
            "abacus",
            "followup",
        ):
            skills = [skill.id for skill in registry.get_by_lobster(lobster_id)]
            if skills:
                bindings[lobster_id] = skills
    except Exception:
        pass
    return bindings


_DEPRECATED_SKILL_BINDINGS_FALLBACK: dict[str, list[str]] = {
    "radar": ["agent-browser", "summarize"],
    "hotspot_investigation": ["proactive-agent"],
    "strategist": ["ontology", "self-improving-agent", "proactive-agent"],
    "constitutional_guardian": ["ontology", "skill-vetter"],
    "verification_gate": ["ontology"],
    "memory_governor": ["self-improving-agent", "ontology"],
    "competitor_analysis": ["agent-browser", "summarize", "ontology"],
    "competitor_formula_analyzer": ["agent-browser", "ontology", "summarize"],
    "rag_ingest_node": ["ontology", "self-improving-agent"],
    "inkwriter": ["humanizer", "summarize"],
    "visualizer": ["nano-banana-pro", "comfyui-local", "libtv-skill"],
    "dispatcher": ["proactive-agent", "auto-updater"],
    "discover_edge_skills": ["skill-vetter", "cli-anything"],
    "distribute_to_edge": ["api-gateway"],
    "echoer": ["humanizer"],
    "catcher": ["summarize", "ontology"],
    "abacus": ["api-gateway", "gog"],
    "human_approval_gate": ["human-in-the-loop"],
    "followup": ["openai-whisper"],
    "feedback": ["self-improving-agent", "ontology"],
}


SKILL_BINDINGS: dict[str, list[str]] = {
    **_DEPRECATED_SKILL_BINDINGS_FALLBACK,
    **_registry_skill_bindings(),
}


FORMULA_CATEGORIES = ["short_fast", "deep_long", "baoma", "chengfendang", "yangmaodang"]
HOOK_TYPES = [
    "pain-question",
    "benefit-hook",
    "visual-surprise",
    "counter-intuition",
    "identity-callout",
]
CONTENT_STRUCTURES = [
    "hook->pain->solution->proof->cta",
    "scenario->conflict->turn->proof->cta",
    "hook->comparison->showcase->offer->cta",
]
MUSIC_SUGGESTIONS = [
    "upbeat-electronic-95bpm",
    "warm-lifestyle-88bpm",
    "fast-cut-trending-110bpm",
    "soft-storytelling-82bpm",
]
PERSONA_SLANGS = [
    "mom_style: practical, family-safe, easy-to-use",
    "ingredient_nerd: concentration, formula, active-components",
    "deal_hunter: discount, effective-price, coupon",
    "student_style: budget-friendly, value, easy-setup",
]
STORYBOARD_OPTIONS = [5, 7, 15]


def _agent_log(agent: str, summary: str, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    keys = _clawhub_keys()
    return [
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "agent": agent,
            "skills": SKILL_BINDINGS.get(agent, []),
            "skill_key": keys.get(agent),
            "summary": summary,
            "payload": payload or {},
        }
    ]


def _local_media_path(url: str) -> str | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    if re.match(r"^[a-zA-Z]:[\\/]", raw):
        return raw
    parsed = urlparse(raw)
    if parsed.scheme == "file":
        path = parsed.path or ""
        if path.startswith("/") and re.match(r"^/[a-zA-Z]:", path):
            path = path[1:]
        return path
    return None


def _media_cache_dir() -> Path:
    raw = str(os.getenv("VOICE_MEDIA_CACHE_DIR") or "data/voice-compose-cache").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


async def _ensure_local_media_path(url: str) -> str | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    local_candidate = _local_media_path(raw)
    if local_candidate and Path(local_candidate).exists():
        return local_candidate

    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        return None

    import hashlib
    import httpx

    suffix = Path(parsed.path or "").suffix.lower() or ".bin"
    cache_key = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    target = _media_cache_dir() / f"{cache_key}{suffix}"
    if target.exists():
        return str(target)

    timeout_sec = float(os.getenv("VOICE_MEDIA_CACHE_TIMEOUT_SEC", "20"))
    async with httpx.AsyncClient(timeout=timeout_sec, follow_redirects=True) as client:
        response = await client.get(raw)
        response.raise_for_status()
        target.write_bytes(response.content)
    return str(target)


async def _collect_local_video_paths(media_pack: list[dict[str, Any]]) -> list[str]:
    paths: list[str] = []
    for item in media_pack:
        if not isinstance(item, dict):
            continue
        media_type = str(item.get("type") or "").strip().lower()
        candidate = str(item.get("local_path") or item.get("path") or item.get("url") or "").strip()
        if media_type != "video" or not candidate:
            continue
        local_path = await _ensure_local_media_path(candidate)
        if not local_path or not Path(local_path).exists():
            continue
        item["local_path"] = local_path
        paths.append(local_path)
    return paths


async def _maybe_compose_visualizer_video(
    *,
    trace_id: str,
    tenant_id: str,
    media_pack: list[dict[str, Any]],
    voice_result: dict[str, Any],
) -> dict[str, Any]:
    if str(os.getenv("VOICE_DISABLE_VISUALIZER_AUTO_COMPOSE") or "false").strip().lower() in {"1", "true", "yes", "on"}:
        return {"ok": False, "reason": "disabled_by_env"}
    if not bool(voice_result.get("ok")):
        return {"ok": False, "reason": "voice_not_ready"}

    audio_path = str(voice_result.get("audio_path") or "").strip()
    subtitle_srt_path = str(voice_result.get("subtitle_srt_path") or "").strip()
    if not audio_path or not Path(audio_path).exists():
        return {"ok": False, "reason": "missing_audio_path"}

    clip_paths = await _collect_local_video_paths(media_pack)
    if not clip_paths:
        return {"ok": False, "reason": "no_local_video_inputs"}

    output_dir = Path(str(os.getenv("VOICE_COMPOSE_OUTPUT_DIR") or "data/voice-composed"))
    if not output_dir.is_absolute():
        output_dir = (Path(__file__).resolve().parent / output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{trace_id or uuid.uuid4().hex[:8]}_voice_compose.mp4"

    try:
        from video_composer import VideoAspect, VideoComposer, VideoComposerConfig, VideoTransitionMode

        composer = VideoComposer(
            VideoComposerConfig(
                output_path=str(output_path),
                aspect=VideoAspect.portrait,
                transition=VideoTransitionMode.fade_in,
                voice_path=audio_path,
                subtitle_srt=subtitle_srt_path,
            )
        )
        result = composer.compose(clip_paths=clip_paths)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "compose_exception", "error": str(exc)}

    if not result.ok:
        return {"ok": False, "reason": "compose_failed", "error": result.error}

    artifact_id = get_artifact_store().save(
        run_id=trace_id or f"voice_compose_{uuid.uuid4().hex[:8]}",
        lobster="visualizer",
        artifact_type="visual",
        content="voice_composed_video",
        content_url=str(result.output_path),
        status="draft",
        meta={
            "tenant_id": tenant_id,
            "compose_mode": "voice_overlay",
            "clip_paths": clip_paths,
            "audio_path": audio_path,
            "subtitle_srt_path": subtitle_srt_path,
            "duration_sec": result.duration_sec,
            "file_size_mb": result.file_size_mb,
        },
    )
    return {
        "ok": True,
        "artifact_id": artifact_id,
        "output_path": str(result.output_path),
        "duration_sec": result.duration_sec,
        "file_size_mb": result.file_size_mb,
    }


async def _invoke_clawhub_skill(agent: str, skill_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    keys = _clawhub_keys()
    return {
        "agent": agent,
        "skill": skill_name,
        "skill_key": keys.get(agent),
        "ok": True,
        "payload_echo": payload,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


async def _deliver_to_edge(message: dict[str, Any]) -> dict[str, Any]:
    if _edge_delivery_hook is None:
        return {
            "accepted": True,
            "transport": "in_memory",
            "detail": "No external hook configured; accepted by default",
        }
    result = _edge_delivery_hook(message)
    if inspect.isawaitable(result):
        result = await result
    if isinstance(result, dict):
        return result
    return {"accepted": bool(result), "transport": "custom_hook"}


def _keywords(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}", text.lower())
    seen: set[str] = set()
    output: list[str] = []
    for token in raw:
        if token in seen:
            continue
        seen.add(token)
        output.append(token)
    return output[:12]


def _safe_slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-:/\.]+", "_", text).strip("_")
    return cleaned[:120] or "unknown_source"


def _normalize_skill_names(raw: Any) -> list[str]:
    if isinstance(raw, list):
        data = raw
    elif isinstance(raw, str):
        data = [part.strip() for part in raw.split(",")]
    else:
        data = []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        value = str(item).strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _normalize_command_names(raw: Any) -> list[str]:
    if isinstance(raw, list):
        data = raw
    elif isinstance(raw, str):
        data = [part.strip() for part in raw.split(",")]
    else:
        data = []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        value = re.sub(r"\s+", " ", str(item).strip())
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _infer_required_edge_commands(state: DragonState) -> list[str]:
    desc = str(state.get("task_description", "")).lower()
    required: list[str] = ["monitor-dm --json", "publish-content --payload"]
    if any(token in desc for token in ["video", "视频", "短视频", "reel"]):
        required.append("video-publish")
        required.append("libtv-render --storyboard payload.json")
    if any(token in desc for token in ["comment", "评论", "互动"]):
        required.append("comment-reply")
    return required


def _infer_required_edge_skills(state: DragonState) -> list[str]:
    desc = str(state.get("task_description", "")).lower()
    required = {"publish-content", "monitor-dm"}
    if any(token in desc for token in ["video", "视频", "短视频", "reel"]):
        required.add("video-publish")
        required.add("libtv-render")
    if any(token in desc for token in ["comment", "评论", "互动"]):
        required.add("comment-reply")
    if any(token in desc for token in ["私信", "dm", "inbox"]):
        required.add("inbox-watch")
    return sorted(required)


def _build_clawteam_tasks(*, user_id: str, trace_id: str, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    publish_keys: list[str] = []
    for idx, job in enumerate(jobs, start=1):
        base = f"job_{idx}"
        prepare_key = f"{base}.prepare"
        render_key = f"{base}.render"
        publish_key = f"{base}.publish"
        publish_keys.append(publish_key)

        tasks.append(
            {
                "task_key": prepare_key,
                "lane": "planner",
                "priority": 10 + idx,
                "depends_on": [],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "prepare",
                    "script": job.get("script"),
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/planner/{base}",
            }
        )
        tasks.append(
            {
                "task_key": render_key,
                "lane": "content",
                "priority": 30 + idx,
                "depends_on": [prepare_key],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "render",
                    "prompt": job.get("prompt"),
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/content/{base}",
            }
        )
        tasks.append(
            {
                "task_key": publish_key,
                "lane": "delivery",
                "priority": 60 + idx,
                "depends_on": [render_key],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "publish",
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/delivery/{base}",
            }
        )

    if publish_keys:
        tasks.append(
            {
                "task_key": "campaign.audit",
                "lane": "audit",
                "priority": 90,
                "depends_on": publish_keys,
                "payload": {"step": "audit_campaign_delivery"},
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/audit/campaign",
            }
        )
    return tasks


def _default_competitor_handles(state: DragonState) -> list[str]:
    handles = [h.strip() for h in state.get("competitor_handles", []) if str(h).strip()]
    target_url = str(state.get("target_account_url") or "").strip()
    if target_url:
        handles.append(target_url)
    if not handles:
        handles = ["benchmark_a", "benchmark_b"]
    dedup: list[str] = []
    seen: set[str] = set()
    for h in handles:
        if h in seen:
            continue
        seen.add(h)
        dedup.append(h)
    return dedup[:8]


def _build_formula_json(source_handle: str, hot_topics: list[str], radar_data: dict[str, Any]) -> dict[str, Any]:
    seed = abs(hash(source_handle)) % 100000
    category = FORMULA_CATEGORIES[seed % len(FORMULA_CATEGORIES)]
    storyboard_count = STORYBOARD_OPTIONS[seed % len(STORYBOARD_OPTIONS)]
    hook_type = HOOK_TYPES[seed % len(HOOK_TYPES)]
    structure = CONTENT_STRUCTURES[seed % len(CONTENT_STRUCTURES)]
    music = MUSIC_SUGGESTIONS[seed % len(MUSIC_SUGGESTIONS)]
    slang = PERSONA_SLANGS[seed % len(PERSONA_SLANGS)]
    topic = hot_topics[seed % len(hot_topics)] if hot_topics else "generic_conversion_topic"

    if storyboard_count == 5:
        duration_range = {"min": 8, "max": 12}
        pacing = [2, 6, 10]
    elif storyboard_count == 7:
        duration_range = {"min": 13, "max": 18}
        pacing = [3, 9, 14]
    else:
        duration_range = {"min": 24, "max": 36}
        pacing = [5, 16, 28]

    effect_score = round(68 + (seed % 29) + (4 if hot_topics else 0), 2)
    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "source_account": _safe_slug(source_handle),
        "source_url": source_handle if source_handle.startswith("http") else f"https://platform.local/{_safe_slug(source_handle)}",
        "analysis_time": now_iso,
        "hook_type": hook_type,
        "content_structure": structure,
        "storyboard_count": storyboard_count,
        "cta": f"Close with DM CTA and offer the {topic} checklist",
        "rhythm_peak_seconds": pacing,
        "music_suggestion": music,
        "persona_slang": slang,
        "duration_golden_seconds": duration_range,
        "topic_focus": topic,
        "category": category,
        "effect_score": effect_score,
        "radar_context": {
            "keywords": radar_data.get("keywords", []),
            "platforms": radar_data.get("platforms", []),
        },
    }


def _formula_to_document(formula: dict[str, Any]) -> Document:
    metadata = {
        "category": formula.get("category", "unknown"),
        "account": formula.get("source_account", "unknown"),
        "date": formula.get("analysis_time"),
        "effect_score": float(formula.get("effect_score", 0) or 0),
        "source_url": formula.get("source_url", ""),
        "storyboard_count": int(formula.get("storyboard_count", 0) or 0),
        "ingest_ts": int(time.time()),
    }
    page_content = json.dumps(
        {
            "hook_type": formula.get("hook_type"),
            "content_structure": formula.get("content_structure"),
            "cta": formula.get("cta"),
            "rhythm_peak_seconds": formula.get("rhythm_peak_seconds"),
            "music_suggestion": formula.get("music_suggestion"),
            "persona_slang": formula.get("persona_slang"),
            "duration_golden_seconds": formula.get("duration_golden_seconds"),
            "topic_focus": formula.get("topic_focus"),
        },
        ensure_ascii=False,
    )
    return Document(page_content=page_content, metadata=metadata)


def _extract_rag_reference(doc: Document) -> dict[str, Any]:
    metadata = doc.metadata or {}
    return {
        "category": metadata.get("category"),
        "account": metadata.get("account"),
        "effect_score": metadata.get("effect_score"),
        "storyboard_count": metadata.get("storyboard_count"),
        "source_url": metadata.get("source_url"),
        "snippet": doc.page_content[:200],
    }


def _extract_industry_kb_reference(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
    return {
        "category": item.get("entry_type") or metadata.get("entry_type") or metadata.get("category"),
        "account": item.get("source_account") or metadata.get("source_account") or metadata.get("account"),
        "effect_score": item.get("effect_score", metadata.get("effect_score")),
        "storyboard_count": item.get("storyboard_count", metadata.get("storyboard_count")),
        "source_url": item.get("source_url") or metadata.get("source_url"),
        "snippet": str(item.get("snippet") or item.get("content") or "")[:200],
        "source": "industry_kb",
        "industry_tag": metadata.get("industry_tag") or item.get("industry_tag"),
    }


def _strip_markdown_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _safe_json_parse(raw: str) -> Any | None:
    cleaned = _strip_markdown_fence(raw)
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except ValueError:
        return int(default)


def _build_followup_spawn_plan(
    *,
    leads: list[dict[str, Any]],
    trace_id: str,
) -> dict[str, Any]:
    threshold = max(1, _int_env("FOLLOWUP_SUBAGENT_THRESHOLD", 6))
    max_children = max(1, _int_env("FOLLOWUP_MAX_CHILDREN", 10))
    leads_per_child = max(1, _int_env("FOLLOWUP_LEADS_PER_CHILD", 2))
    child_concurrency = max(1, _int_env("FOLLOWUP_CHILD_CONCURRENCY", 4))
    deterministic_enabled = _bool_env("FOLLOWUP_DETERMINISTIC_SPAWN_ENABLED", True)

    if (not deterministic_enabled) or len(leads) < threshold:
        return {
            "enabled": deterministic_enabled,
            "mode": "single",
            "threshold": threshold,
            "max_children": max_children,
            "leads_per_child": leads_per_child,
            "child_concurrency": 1,
            "plan": {
                "trace_id": trace_id,
                "lead_count": len(leads),
                "child_count": 1 if leads else 0,
                "leads_per_child": max(1, len(leads) or 1),
                "shards": (
                    [
                        {
                            "child_id": "sub_01_single",
                            "child_index": 1,
                            "lead_ids": [str(item.get("lead_id") or f"lead_{idx + 1}") for idx, item in enumerate(leads)],
                            "leads": leads,
                        }
                    ]
                    if leads
                    else []
                ),
            },
        }

    plan = plan_deterministic_subagents(
        leads=leads,
        trace_id=trace_id or "followup",
        max_children=max_children,
        leads_per_child=leads_per_child,
    )
    return {
        "enabled": True,
        "mode": "deterministic_subagents",
        "threshold": threshold,
        "max_children": max_children,
        "leads_per_child": leads_per_child,
        "child_concurrency": child_concurrency,
        "plan": plan,
    }


async def _run_followup_child(
    *,
    shard: dict[str, Any],
    user_id: str,
    tenant_id: str,
    score: float,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    child_id = str(shard.get("child_id") or "sub_00")
    worker_id = f"followup:{child_id}"
    leads = shard.get("leads", [])
    if not isinstance(leads, list):
        leads = []
    lead_ids = [str(item) for item in (shard.get("lead_ids") or []) if str(item).strip()]
    started_at = datetime.now(timezone.utc)
    error_text: str | None = None
    llm_brief: str | None = None
    actions: list[dict[str, Any]] = []
    for idx, lead in enumerate(leads):
        fallback_id = lead_ids[idx] if idx < len(lead_ids) else f"lead_{idx + 1}"
        lead_id = str(lead.get("lead_id") or fallback_id)
        actions.append(
            {
                "lead_id": lead_id,
                "action": "call_now" if str(lead.get("grade", "")).upper() == "A" else "dm_then_call",
                "worker_id": worker_id,
            }
        )

    try:
        async with semaphore:
            llm_brief = await llm_router.routed_ainvoke_text(
                system_prompt=(
                    "You are FollowUp sub-agent. Return one short call-brief sentence in plain text, <= 40 words."
                ),
                user_prompt=json.dumps(
                    {
                        "child_id": child_id,
                        "lead_count": len(leads),
                        "avg_score": score,
                        "actions": actions,
                    },
                    ensure_ascii=False,
                ),
                meta=RouteMeta(
                    critical=True,
                    est_tokens=450,
                    tenant_tier="basic",
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type="followup_voice",
                ),
                temperature=0.2,
                force_tier=ModelTier.PRO,
            )
    except Exception as exc:  # noqa: BLE001
        error_text = str(exc)[:300]

    finished_at = datetime.now(timezone.utc)
    duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1000))
    status = "failed" if error_text else "completed"
    return {
        "child_id": child_id,
        "worker_id": worker_id,
        "lead_ids": lead_ids,
        "status": status,
        "action_count": len(actions),
        "actions": actions,
        "call_brief": (llm_brief or "").strip()[:220] or None,
        "error": error_text,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_ms": duration_ms,
    }


async def radar(state: DragonState) -> dict[str, Any]:
    task = state.get("task_description", "")
    keywords = _keywords(task)
    input_sources = state.get("source_credibility", {}).get("source_scores", [])
    seed_sources = [str(item.get("source")) for item in input_sources if isinstance(item, dict) and item.get("source")]
    if not seed_sources:
        seed_sources = ["openalex", "github_projects", "huggingface_papers"]
    await _invoke_clawhub_skill("radar", "agent-browser", {"task": task})
    await _invoke_clawhub_skill("radar", "summarize", {"keywords": keywords})
    radar_data = {
        "platforms": ["xiaohongshu", "douyin"],
        "sources": seed_sources,
        "keywords": keywords,
        "hot_posts": [f"hot_post_{i}" for i in range(1, 6)],
    }
    source_credibility = kernel_compute_source_credibility(radar_data)
    return {
        "radar_data": radar_data,
        "source_credibility": source_credibility,
        "call_log": _agent_log(
            "radar",
            "Radar scan finished with source scoring",
            {
                "keyword_count": len(keywords),
                "source_credibility": source_credibility.get("overall"),
                "weak_source_count": len(source_credibility.get("weak_sources", [])),
            },
        ),
    }


async def hotspot_investigation(state: DragonState) -> dict[str, Any]:
    radar_data = state.get("radar_data", {})
    keywords = radar_data.get("keywords", [])
    await _invoke_clawhub_skill("hotspot_investigation", "proactive-agent", {"keywords": keywords})
    hot_topics = [f"{kw}_trend" for kw in keywords[:5]] or ["general_growth_trend"]
    return {
        "hot_topics": hot_topics,
        "call_log": _agent_log(
            "hotspot_investigation",
            "Hotspot investigation completed",
            {"hot_topic_count": len(hot_topics)},
        ),
    }


async def strategist(state: DragonState) -> dict[str, Any]:
    hot_topics = state.get("hot_topics", [])
    task = state.get("task_description", "")
    user_id = str(state.get("user_id") or "shared")
    tenant_id = str(state.get("tenant_id") or f"tenant_{user_id}")
    industry_tag = str(state.get("industry_tag") or "general").strip().lower() or "general"
    radar_data = state.get("radar_data", {})
    source_credibility = state.get("source_credibility", {}) or kernel_compute_source_credibility(radar_data)
    memory_context = state.get("memory_context", {})
    if not isinstance(memory_context, dict) or "coverage" not in memory_context:
        memory_context = kernel_build_memory_context(
            tenant_id=tenant_id,
            user_id=user_id,
            task_description=task,
            hot_topics=[str(x) for x in hot_topics[:4]],
        )

    await _invoke_clawhub_skill("strategist", "ontology", {"hot_topics": hot_topics, "task": task})

    utc_day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_digest = _daily_rag_scan_cache.get(user_id, {"scan_day": "", "digest": []})
    if user_digest.get("scan_day") != utc_day:
        recent_docs = fetch_recent_formula_documents(limit=12, since_hours=24, user_id=user_id)
        digest = [_extract_rag_reference(doc) for doc in recent_docs[:6]]
        _daily_rag_scan_cache[user_id] = {"scan_day": utc_day, "digest": digest}
        await _invoke_clawhub_skill(
            "strategist",
            "proactive-agent",
            {"scan_day": utc_day, "new_formula_count": len(recent_docs), "user_id": user_id},
        )
    else:
        digest = user_digest.get("digest", [])

    query_text = " ".join([task] + hot_topics).strip() or "generic conversion script"
    similar_docs = search_formula_documents(query_text, k=4, user_id=user_id)
    vector_refs = [_extract_rag_reference(doc) for doc in similar_docs]
    industry_kb_context = state.get("industry_kb_context", [])
    industry_refs = [
        _extract_industry_kb_reference(item)
        for item in industry_kb_context
        if isinstance(item, dict)
    ]
    industry_refs = industry_refs[:6]
    graph_runtime = await query_raganything_hybrid(query_text, top_k=4, user_id=user_id)
    graph_refs = graph_runtime.get("graph_refs", []) if graph_runtime.get("enabled") else []
    rag_runtime_fail_closed = bool(graph_runtime.get("fail_closed", False))
    if rag_runtime_fail_closed:
        graph_refs = []
    rag_refs = (industry_refs + vector_refs + graph_refs)[:10]
    source_overall = float(source_credibility.get("overall", 0.5) or 0.5)
    source_gate_applied = source_overall < 0.6
    if source_gate_applied:
        # Weak source quality: reduce strategy dependence on external references.
        rag_refs = rag_refs[:1]
    preferred_storyboard = next(
        (int(ref.get("storyboard_count")) for ref in rag_refs if ref.get("storyboard_count")),
        7,
    )
    preferred_storyboard = preferred_storyboard if preferred_storyboard in STORYBOARD_OPTIONS else 7
    bandit_policy = recommend_policy(user_id)
    if bool(bandit_policy.get("enabled", True)):
        suggested_storyboard = int(bandit_policy.get("storyboard_count", preferred_storyboard) or preferred_storyboard)
        if suggested_storyboard in STORYBOARD_OPTIONS:
            # Blend RAG prior with online reward signal from bandit.
            if preferred_storyboard == suggested_storyboard:
                preferred_storyboard = suggested_storyboard
            else:
                preferred_storyboard = suggested_storyboard if len(rag_refs) <= 1 else preferred_storyboard

    llm_strategy: dict[str, Any] = {}
    llm_route = "rule_only"
    llm_error: str | None = None
    trace_id = str(state.get("trace_id") or "")
    try:
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                "You are the strategist agent in a multi-agent marketing OS. "
                "Return strict JSON only with keys: strategy_summary (string), "
                "primary_topics (array of strings), publish_window (string), "
                "cta (string), tone (string), preferred_storyboard_count (number)."
            ),
            user_prompt=json.dumps(
                {
                    "task": task,
                    "hot_topics": hot_topics,
                    "rag_references": rag_refs,
                    "daily_digest": digest,
                },
                ensure_ascii=False,
            ),
            meta=RouteMeta(
                critical=True,
                est_tokens=1800,
                tenant_tier="basic",
                user_id=user_id,
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="strategy_planning",
            ),
            temperature=0.2,
            force_tier=ModelTier.PRO,
        )
        parsed = _safe_json_parse(llm_raw)
        if isinstance(parsed, dict):
            llm_strategy = parsed
            llm_route = "llm_routed"
    except Exception as exc:  # noqa: BLE001
        llm_error = str(exc)

    strategy = {
        "persona": "conversion_operator",
        "campaign_type": "short_video_plus_dm_conversion",
        "goal": "increase qualified DM leads",
        "primary_topics": hot_topics[:3],
        "preferred_storyboard_count": preferred_storyboard,
        "rag_references": rag_refs,
        "rag_vector_reference_count": len(vector_refs),
        "rag_graph_reference_count": len(graph_refs),
        "rag_graph_answer": graph_runtime.get("answer", ""),
        "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
        "rag_runtime_used_query_mode": graph_runtime.get("used_query_mode"),
        "rag_runtime_query_mode_chain": graph_runtime.get("query_mode_chain", []),
        "rag_runtime_fail_closed": rag_runtime_fail_closed,
        "rag_runtime_error": graph_runtime.get("error"),
        "daily_rag_digest": digest,
        "llm_route": llm_route,
        "policy_bandit_mode": bandit_policy.get("mode"),
        "policy_bandit_tone": bandit_policy.get("tone"),
        "source_gate_applied": source_gate_applied,
        "source_credibility_overall": round(source_overall, 4),
        "memory_coverage": float(memory_context.get("coverage", 0.0) or 0.0),
        "industry_tag": industry_tag,
        "industry_kb_reference_count": len(industry_refs),
    }
    if llm_strategy:
        if isinstance(llm_strategy.get("primary_topics"), list):
            strategy["primary_topics"] = [str(x) for x in llm_strategy.get("primary_topics", [])][:3] or strategy["primary_topics"]
        storyboard_candidate = llm_strategy.get("preferred_storyboard_count")
        if isinstance(storyboard_candidate, int) and storyboard_candidate in STORYBOARD_OPTIONS:
            strategy["preferred_storyboard_count"] = storyboard_candidate
        strategy["strategy_summary"] = str(llm_strategy.get("strategy_summary", "")).strip()[:800]
        strategy["publish_window"] = str(llm_strategy.get("publish_window", "19:00-22:00 Asia/Shanghai")).strip()
        strategy["cta"] = str(llm_strategy.get("cta", "DM for details")).strip()
        strategy["tone"] = str(llm_strategy.get("tone", "friendly_trustworthy")).strip()
    elif bandit_policy.get("tone"):
        strategy["tone"] = str(bandit_policy.get("tone"))
    if llm_error:
        strategy["llm_error"] = llm_error[:300]
    confidence_interval = kernel_estimate_strategy_confidence(
        rag_reference_count=len(rag_refs),
        rag_graph_reference_count=len(graph_refs),
        llm_route=llm_route,
        llm_error=llm_error,
        source_overall=source_overall,
        memory_coverage=float(memory_context.get("coverage", 0.0) or 0.0),
    )
    strategy["confidence_interval"] = confidence_interval
    strategy["memory_context"] = {
        "coverage": memory_context.get("coverage", 0.0),
        "episode_count": memory_context.get("episode_count", 0),
        "policy_count": memory_context.get("policy_count", 0),
        "tenant_memory_count": memory_context.get("tenant_memory_count", 0),
    }

    await _invoke_clawhub_skill(
        "strategist",
        "self-improving-agent",
        {
            "task": task,
            "rag_reference_count": len(rag_refs),
            "daily_digest_count": len(digest),
        },
    )
    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=trace_id or None,
            node="strategist",
            event_type="strategy_generated",
            payload={
                "rag_reference_count": len(rag_refs),
                "industry_kb_reference_count": len(industry_refs),
                "llm_route": llm_route,
                "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
                "llm_error": llm_error,
                "confidence_interval": confidence_interval,
                "memory_coverage": memory_context.get("coverage", 0.0),
                "source_credibility_overall": source_overall,
            },
            level="error" if bool(llm_error) else "info",
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "strategy": strategy,
        "source_credibility": source_credibility,
        "memory_context": memory_context,
        "strategy_confidence": confidence_interval,
        "policy_bandit": bandit_policy,
        "rag_recent_digest": digest,
        "call_log": _agent_log(
            "strategist",
            "Strategy completed with RAG references",
            {
                "rag_reference_count": len(rag_refs),
                "industry_kb_reference_count": len(industry_refs),
                "rag_vector_reference_count": len(vector_refs),
                "rag_graph_reference_count": len(graph_refs),
                "user_id": user_id,
                "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
                "rag_runtime_used_query_mode": graph_runtime.get("used_query_mode"),
                "rag_runtime_fail_closed": rag_runtime_fail_closed,
                "preferred_storyboard_count": preferred_storyboard,
                "confidence_low": confidence_interval.get("low"),
                "confidence_high": confidence_interval.get("high"),
                "source_gate_applied": source_gate_applied,
            },
        ),
    }


async def constitutional_guardian_node(state: DragonState) -> dict[str, Any]:
    task_description = str(state.get("task_description", ""))
    strategy = dict(state.get("strategy", {}) or {})
    source_credibility = state.get("source_credibility", {}) or {}
    memory_context = state.get("memory_context", {}) or {}
    hot_topics = [str(item) for item in state.get("hot_topics", []) if str(item).strip()]

    guardian = kernel_constitutional_guardian(
        task_description=task_description,
        strategy=strategy,
        source_credibility=source_credibility,
        memory_context=memory_context,
        hot_topics=hot_topics,
    )
    policy_context = guardian.get("policy_context", {}) if isinstance(guardian.get("policy_context"), dict) else {}
    if policy_context:
        strategy["industry_policy"] = {
            "industry": policy_context.get("industry", "general"),
            "strategy_version": policy_context.get("strategy_version", "general_safe_v1"),
            "customer_requirements": policy_context.get("customer_requirements", []),
        }
        strategy["customer_micro_tuning"] = policy_context.get("micro_tuning", {})
        strategy["digital_human_tuning"] = policy_context.get("digital_human_tuning", {})
        strategy["vlog_tuning"] = policy_context.get("vlog_tuning", {})

    reason_codes = [str(item) for item in guardian.get("reason_codes", []) if str(item).strip()]
    publish_allowed = str(guardian.get("decision", "review")).lower() == "allow"
    return {
        "strategy": strategy,
        "constitutional_guardian": guardian,
        "publish_allowed": publish_allowed,
        "reason_codes": reason_codes,
        "hitl_required": bool(state.get("hitl_required", False)) or (not publish_allowed),
        "hitl_reason": str(guardian.get("reason", "")).strip()[:300] or state.get("hitl_reason"),
        "call_log": _agent_log(
            "constitutional_guardian",
            "Constitutional guardian evaluated strategy",
            {
                "decision": guardian.get("decision"),
                "industry": guardian.get("industry"),
                "strategy_version": guardian.get("strategy_version"),
                "reason_codes": reason_codes[:8],
            },
        ),
    }


async def verification_gate_node(state: DragonState) -> dict[str, Any]:
    confidence = state.get("strategy_confidence", {}) or {}
    guardian = state.get("constitutional_guardian", {}) or {}
    source_credibility = state.get("source_credibility", {}) or {}
    verification = kernel_verification_gate(
        confidence=confidence,
        guardian=guardian,
        source_credibility=source_credibility,
    )
    guardian_codes = [str(item) for item in guardian.get("reason_codes", []) if str(item).strip()]
    verify_codes = [str(item) for item in verification.get("reason_codes", []) if str(item).strip()]
    merged_codes = sorted({*guardian_codes, *verify_codes})
    publish_allowed = bool(verification.get("publish_allowed", verification.get("accepted", False)))
    confidence_band = str(verification.get("confidence_band", "medium")).strip() or "medium"
    route = str(verification.get("route", "continue")).strip().lower()
    hitl_required = bool(state.get("hitl_required", False)) or route == "review"

    return {
        "verification_gate": verification,
        "publish_allowed": publish_allowed,
        "reason_codes": merged_codes,
        "confidence_band": confidence_band,
        "hitl_required": hitl_required,
        "hitl_reason": (
            str(verification.get("reason", "")).strip()[:300]
            if route in {"review", "reject"}
            else state.get("hitl_reason")
        ),
        "call_log": _agent_log(
            "verification_gate",
            "Verification gate completed",
            {
                "route": route,
                "publish_allowed": publish_allowed,
                "confidence_band": confidence_band,
                "reason_codes": merged_codes[:10],
            },
        ),
    }


async def memory_governor_node(state: DragonState) -> dict[str, Any]:
    tenant_id = str(state.get("tenant_id") or f"tenant_{state.get('user_id') or 'shared'}")
    user_id = str(state.get("user_id") or "shared")
    trace_id = str(state.get("trace_id") or f"trace_{uuid.uuid4().hex[:12]}")
    strategy = state.get("strategy", {}) if isinstance(state.get("strategy"), dict) else {}
    guardian = state.get("constitutional_guardian", {}) if isinstance(state.get("constitutional_guardian"), dict) else {}
    verification = state.get("verification_gate", {}) if isinstance(state.get("verification_gate"), dict) else {}
    confidence = state.get("strategy_confidence", {}) if isinstance(state.get("strategy_confidence"), dict) else {}

    persisted = kernel_persist_kernel_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
        task_description=str(state.get("task_description", "")),
        strategy=strategy,
        guardian=guardian,
        verification=verification,
        confidence=confidence,
    )
    governor_row = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "trace_id": trace_id,
        "episode_id": persisted.get("episode_id"),
        "policy_version": persisted.get("policy_version"),
        "industry": persisted.get("industry"),
        "confidence_band": verification.get("confidence_band"),
        "publish_allowed": bool(state.get("publish_allowed", False)),
    }
    return {
        "memory_governor": governor_row,
        "call_log": _agent_log(
            "memory_governor",
            "Memory governor wrote episode/policy/tenant snapshot",
            governor_row,
        ),
    }


async def competitor_analysis(state: DragonState) -> dict[str, Any]:
    handles = _default_competitor_handles(state)
    await _invoke_clawhub_skill(
        "competitor_analysis",
        "agent-browser",
        {"handles": handles, "mode": "account_deep_dive"},
    )
    await _invoke_clawhub_skill("competitor_analysis", "summarize", {"handles": handles})
    await _invoke_clawhub_skill("competitor_analysis", "ontology", {"handles": handles})

    analysis = {
        "handles": handles,
        "insights": [
            "Top accounts post between 19:00-22:00",
            "Short hook + proof + CTA performs best",
            "Comments with pricing intent convert fastest",
        ],
    }
    return {
        "competitor_analysis": analysis,
        "call_log": _agent_log("competitor_analysis", "Competitor analysis finished", analysis),
    }


async def competitor_formula_analyzer(state: DragonState) -> dict[str, Any]:
    handles = state.get("competitor_analysis", {}).get("handles") or _default_competitor_handles(state)
    radar_data = state.get("radar_data", {})
    hot_topics = state.get("hot_topics", [])

    await _invoke_clawhub_skill(
        "competitor_formula_analyzer",
        "agent-browser",
        {"handles": handles, "extract": "viral_formula"},
    )
    await _invoke_clawhub_skill(
        "competitor_formula_analyzer",
        "ontology",
        {"handles": handles, "schema": "viral_formula_json"},
    )
    await _invoke_clawhub_skill(
        "competitor_formula_analyzer",
        "summarize",
        {"handles": handles, "focus": "hook_structure_cta"},
    )

    formulas = [_build_formula_json(handle, hot_topics, radar_data) for handle in handles]
    assets = collect_multimodal_assets(handles, radar_data)
    enriched_formulas, graph_links, rag_mode = enrich_formulas_with_multimodal(formulas, assets)
    return {
        "competitor_formulas": enriched_formulas,
        "competitor_multimodal_assets": assets,
        "rag_graph_links": graph_links,
        "rag_mode": rag_mode,
        "call_log": _agent_log(
            "competitor_formula_analyzer",
            "Competitor viral formulas extracted",
            {
                "formula_count": len(enriched_formulas),
                "asset_count": len(assets),
                "graph_link_count": len(graph_links),
                "rag_mode": rag_mode,
                "categories": [f.get("category") for f in enriched_formulas],
            },
        ),
    }


async def rag_ingest_node(state: DragonState) -> dict[str, Any]:
    formulas = state.get("competitor_formulas", [])
    assets = state.get("competitor_multimodal_assets", [])
    user_id = str(state.get("user_id") or "shared")
    if not formulas:
        return {
            "rag_ingested_count": 0,
            "rag_runtime": {"mode": "fallback_disabled", "runtime_ingested": 0},
            "call_log": _agent_log("rag_ingest_node", "No formulas to ingest", {"user_id": user_id}),
        }

    docs = [_formula_to_document(formula) for formula in formulas]
    multimodal_docs = build_multimodal_documents(formulas, assets)
    all_docs = docs + multimodal_docs
    ingested = ingest_formula_documents(all_docs, user_id=user_id)
    runtime_row = await ingest_raganything_runtime(formulas, assets, user_id=user_id)
    runtime_mode = str(runtime_row.get("mode", "fallback_disabled"))
    runtime_ingested = int(runtime_row.get("runtime_ingested", 0) or 0)
    fail_closed = bool(runtime_row.get("fail_closed", False))
    merged_ingested = runtime_ingested if fail_closed else max(ingested, runtime_ingested)
    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=str(state.get("trace_id") or "") or None,
            node="rag_ingest_node",
            event_type="formula_ingested",
            payload={
                "vector_ingested": ingested,
                "runtime_ingested": runtime_ingested,
                "merged_ingested": merged_ingested,
                "rag_mode": runtime_mode,
                "runtime_fail_closed": fail_closed,
                "runtime_error": runtime_row.get("error"),
            },
            level="error" if bool(runtime_row.get("error")) else "info",
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "rag_ingested_count": merged_ingested,
        "rag_mode": runtime_mode,
        "rag_runtime": runtime_row,
        "call_log": _agent_log(
            "rag_ingest_node",
            "Formula docs ingested into RAG runtime chain",
            {
                "requested_formula_docs": len(docs),
                "requested_multimodal_docs": len(multimodal_docs),
                "requested_total_docs": len(all_docs),
                "vector_ingested": ingested,
                "runtime_ingested": runtime_ingested,
                "merged_ingested": merged_ingested,
                "rag_mode": runtime_mode,
                "scope": runtime_row.get("scope"),
                "user_id": user_id,
                "runtime_error": runtime_row.get("error"),
                "runtime_fail_closed": fail_closed,
            },
        ),
    }


async def content_factory_gate(state: DragonState) -> dict[str, Any]:
    return {
        "call_log": _agent_log(
            "dispatcher",
            "Content factory gate opened",
            {"analysis_mode": bool(state.get("analysis_mode", False))},
        )
    }


async def inkwriter(state: DragonState) -> dict[str, Any]:
    strategy = state.get("strategy", {})
    topics = strategy.get("primary_topics", [])
    storyboard_count = int(strategy.get("preferred_storyboard_count", 7) or 7)
    storyboard_count = storyboard_count if storyboard_count in STORYBOARD_OPTIONS else 7
    rag_refs = strategy.get("rag_references", [])
    top_ref = rag_refs[0] if rag_refs else {}

    await _invoke_clawhub_skill(
        "inkwriter",
        "humanizer",
        {"topics": topics, "storyboard_count": storyboard_count, "top_category": top_ref.get("category")},
    )
    await _invoke_clawhub_skill("inkwriter", "summarize", {"rag_reference_count": len(rag_refs)})

    scripts = [
        {
            "scene": idx + 1,
            "copy": f"Scene {idx + 1}: {topics[idx % len(topics)] if topics else 'core_offer'} story beat",
            "hook": top_ref.get("category", "generic"),
        }
        for idx in range(storyboard_count)
    ]

    industry_tag = str(state.get("industry_tag") or "general").strip().lower() or "general"
    industry_kb_refs = [
        {"statement": item.get("statement", ""), "category": item.get("category", "")}
        for item in (state.get("industry_kb_context") or [])
        if isinstance(item, dict)
    ][:4]

    llm_script_error: str | None = None
    try:
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                f"You are InkWriter agent specializing in the {industry_tag} industry. "
                "Return strict JSON array only. "
                "Each item must include scene(number), copy(string), hook(string). "
                "Copy must reflect the industry context and brand voice provided."
            ),
            user_prompt=json.dumps(
                {
                    "storyboard_count": storyboard_count,
                    "topics": topics,
                    "rag_reference": top_ref,
                    "task_description": state.get("task_description", ""),
                    "industry_tag": industry_tag,
                    "industry_kb_insights": industry_kb_refs,
                },
                ensure_ascii=False,
            ),
            meta=RouteMeta(
                critical=False,
                est_tokens=2200,
                tenant_tier="basic",
                user_id=str(state.get("user_id") or "shared"),
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="content_generation",
            ),
            temperature=0.55,
            force_tier=ModelTier.STANDARD,
        )
        parsed = _safe_json_parse(llm_raw)
        if isinstance(parsed, list):
            llm_scenes: list[dict[str, Any]] = []
            for idx, item in enumerate(parsed[:storyboard_count]):
                if not isinstance(item, dict):
                    continue
                llm_scenes.append(
                    {
                        "scene": int(item.get("scene", idx + 1)),
                        "copy": str(item.get("copy", "")).strip() or scripts[idx]["copy"],
                        "hook": str(item.get("hook", top_ref.get("category", "generic"))).strip(),
                    }
                )
            if llm_scenes:
                scripts = llm_scenes
    except Exception as exc:  # noqa: BLE001
        llm_script_error = str(exc)

    return {
        "inkwriter_output": {
            "format": "video_script_json",
            "template": "strict_template_map",
            "storyboard_count": storyboard_count,
            "scenes": scripts,
            "rag_formula_reference": top_ref,
            "llm_error": llm_script_error[:280] if llm_script_error else None,
        },
        "call_log": _agent_log(
            "inkwriter",
            "Script package generated",
            {"scene_count": storyboard_count, "rag_reference_used": bool(top_ref)},
        ),
    }


async def visualizer(state: DragonState) -> dict[str, Any]:
    scenes = state.get("inkwriter_output", {}).get("scenes", [])
    await _invoke_clawhub_skill("visualizer", "nano-banana-pro", {"scene_count": len(scenes)})
    raw_task_text = str(state.get("task_description", "")).strip()
    task_text = raw_task_text.lower()
    strategy_obj = state.get("strategy", {}) if isinstance(state.get("strategy"), dict) else {}
    industry_policy = strategy_obj.get("industry_policy", {}) if isinstance(strategy_obj.get("industry_policy"), dict) else {}
    digital_human_tuning = (
        strategy_obj.get("digital_human_tuning", {})
        if isinstance(strategy_obj.get("digital_human_tuning"), dict)
        else {}
    )
    vlog_tuning = strategy_obj.get("vlog_tuning", {}) if isinstance(strategy_obj.get("vlog_tuning"), dict) else {}
    customer_requirements = [
        str(item).strip()
        for item in industry_policy.get("customer_requirements", [])
        if str(item).strip()
    ]
    micro_tuning = strategy_obj.get("customer_micro_tuning", {}) if isinstance(strategy_obj.get("customer_micro_tuning"), dict) else {}
    voice_profile = {
        "style": str(micro_tuning.get("tone", "neutral") or "neutral"),
        "pace": str(micro_tuning.get("pace", "medium") or "medium"),
    }
    digital_human_mode = any(token in task_text for token in ["口播", "数字人", "主播", "talking head", "avatar"]) or bool(
        digital_human_tuning
    )
    vlog_mode = any(token in task_text for token in ["vlog", "旁白", "第一视角", "日常记录", "探店"]) or bool(vlog_tuning)
    style_tokens = []
    if digital_human_mode:
        style_tokens.append("digital human talking-head, strong lip-sync alignment, clean studio voiceover")
    if vlog_mode:
        style_tokens.append("first-person vlog narration, cinematic b-roll transitions, natural handheld rhythm")
    style_suffix = "; ".join(style_tokens) if style_tokens else "short-video marketing style"
    prompts = [
        {
            "scene": item.get("scene", idx + 1),
            "prompt": f"Commercial social scene {idx + 1}, realistic style, conversion CTA in frame, {style_suffix}",
        }
        for idx, item in enumerate(scenes)
    ]
    tenant_id = str(state.get("tenant_id") or f"tenant_{state.get('user_id') or 'shared'}")
    user_id = str(state.get("user_id") or "shared")
    industry = detect_industry(
        raw_task_text,
        [str(item) for item in state.get("hot_topics", []) if isinstance(item, str)],
    )
    capability_snapshot = inspect_comfyui_capabilities()
    generation_plan = build_comfyui_generation_plan(
        task_description=raw_task_text,
        industry=industry,
        capability_snapshot=capability_snapshot,
        policy_context={
            "strategy_version": industry_policy.get("strategy_version"),
            "customer_requirements": customer_requirements,
            "digital_human_tuning": digital_human_tuning,
            "vlog_tuning": vlog_tuning,
        },
        force_human_approval=True,
    )
    workflow = resolve_workflow(industry)
    template_rows = list_templates_by_industry(industry)
    template_candidates = [str(row.get("name", "")).strip() for row in template_rows if str(row.get("name", "")).strip()]
    active_template = next((str(row.get("name", "")).strip() for row in template_rows if row.get("is_active")), "")
    template_scope = f"workflow_template:{industry}"
    template_policy = recommend_policy(
        user_id,
        template_scope=template_scope,
        template_candidates=template_candidates,
        default_template=active_template or (template_candidates[0] if template_candidates else ""),
    )
    selected_template = str(template_policy.get("workflow_template", "")).strip()
    selected_template_row = resolve_template(industry, selected_template) if selected_template else {}
    if bool(selected_template_row.get("has_workflow")):
        workflow = {
            "industry": industry,
            "env_key": "",
            "workflow_path": str(selected_template_row.get("workflow_path", "")),
            "has_workflow": True,
            "source": str(selected_template_row.get("source", "registry_named")),
        }

    comfyui_result = await generate_storyboard_video_local(
        task_description=raw_task_text,
        scenes=[item for item in scenes if isinstance(item, dict)],
        tenant_id=tenant_id,
        user_id=user_id,
        reference_assets=state.get("competitor_multimodal_assets", []),
        digital_human_tuning=digital_human_tuning,
        vlog_tuning=vlog_tuning,
        voice_profile=voice_profile,
        customer_requirements=customer_requirements,
        workflow_path_override=str(workflow.get("workflow_path", "")).strip() or None,
    )
    media_pack: list[dict[str, Any]] = []
    engine = "nano-banana-pro"

    comfy_urls = comfyui_result.get("result_urls", [])
    if isinstance(comfy_urls, list):
        for idx, url in enumerate(comfy_urls):
            clean_url = str(url).strip()
            if not clean_url:
                continue
            media_pack.append(
                {
                    "scene": idx + 1,
                    "url": clean_url,
                    "type": "video" if clean_url.lower().endswith((".mp4", ".mov", ".webm")) else "image",
                    "source": "comfyui",
                }
            )
    if media_pack:
        engine = "comfyui-local"

    libtv_result: dict[str, Any] = {"ok": False, "mode": "skipped", "reason": "comfyui_success"}
    if not media_pack:
        libtv_result = await generate_storyboard_video(
            task_description=str(state.get("task_description", "")).strip(),
            scenes=[item for item in scenes if isinstance(item, dict)],
            tenant_id=tenant_id,
            user_id=user_id,
            reference_assets=state.get("competitor_multimodal_assets", []),
            digital_human_tuning=digital_human_tuning,
            vlog_tuning=vlog_tuning,
            customer_requirements=customer_requirements,
        )
        urls = libtv_result.get("result_urls", [])
        if isinstance(urls, list):
            for idx, url in enumerate(urls):
                clean_url = str(url).strip()
                if not clean_url:
                    continue
                media_pack.append(
                    {
                        "scene": idx + 1,
                        "url": clean_url,
                        "type": "video" if clean_url.lower().endswith((".mp4", ".mov", ".webm")) else "image",
                        "source": "libtv",
                    }
                )
        if media_pack:
            engine = "libtv-skill"

    narration_lines = [
        str(item.get("copy") or "").strip()
        for item in scenes
        if isinstance(item, dict) and str(item.get("copy") or "").strip()
    ]
    narration_script = "\n".join(narration_lines).strip()
    subtitle_text = narration_script
    voice_mode = "brand_clone" if str(voice_profile.get("reference_audio_path") or "").strip() else "standard"
    voice_result: dict[str, Any] = {"ok": False, "reason": "not_required"}
    force_enable_voice = str(os.getenv("VOICE_AUTO_SYNTHESIZE_VISUALIZER") or "false").strip().lower() in {"1", "true", "yes", "on"}
    disable_voice = str(os.getenv("VOICE_DISABLE_VISUALIZER_AUTO_SYNTHESIZE") or "false").strip().lower() in {"1", "true", "yes", "on"}
    should_auto_voice = bool(narration_script) and not disable_voice and (
        force_enable_voice or digital_human_mode or vlog_mode
    )
    if narration_script and should_auto_voice:
        try:
            synthesized = await get_voice_orchestrator().synthesize_and_store(
                run_id=str(state.get("trace_id") or f"visualizer_{uuid.uuid4().hex[:8]}"),
                lobster_id="visualizer",
                tenant_id=tenant_id,
                text=narration_script,
                voice_mode=voice_mode,
                voice_prompt=f"{voice_profile.get('style', 'neutral')} / {voice_profile.get('pace', 'medium')}",
                voice_profile=voice_profile,
                subtitle_required=True,
                meta={
                    "user_id": user_id,
                    "industry": industry,
                    "engine": engine,
                },
            )
            voice_result = {
                "ok": synthesized.ok,
                "provider": synthesized.provider,
                "mode": synthesized.mode,
                "audio_path": synthesized.audio_path,
                "subtitle_srt_path": synthesized.subtitle_srt_path,
                "duration_sec": synthesized.duration_sec,
                "artifact_ids": synthesized.artifact_ids or [],
                "fallback_used": synthesized.fallback_used,
                "error": synthesized.error,
            }
        except Exception as exc:  # noqa: BLE001
            voice_result = {"ok": False, "reason": "orchestrator_error", "error": str(exc)}
    elif narration_script and disable_voice:
        voice_result = {"ok": False, "reason": "disabled_by_env"}

    compose_result = await _maybe_compose_visualizer_video(
        trace_id=str(state.get("trace_id") or ""),
        tenant_id=tenant_id,
        media_pack=media_pack,
        voice_result=voice_result,
    )
    if bool(compose_result.get("ok")) and str(compose_result.get("output_path") or "").strip():
        composed_path = str(compose_result.get("output_path") or "").strip()
        media_pack.append(
            {
                "scene": len(media_pack) + 1,
                "url": composed_path,
                "local_path": composed_path,
                "type": "video",
                "source": "video_composer",
            }
        )

    return {
        "visualizer_output": {
            "prompt_pack": prompts,
            "media_pack": media_pack,
            "engine": engine,
            "narration_script": narration_script,
            "subtitle_text": subtitle_text,
            "voice_mode": voice_mode,
            "voice_result": voice_result,
            "compose_result": compose_result,
            "style_profile": {
                "digital_human_mode": digital_human_mode,
                "vlog_narration_mode": vlog_mode,
                "style_tokens": style_tokens,
                "strategy_version": industry_policy.get("strategy_version", "general_safe_v1"),
                "customer_requirements": customer_requirements[:5],
                "digital_human_tuning": digital_human_tuning,
                "vlog_tuning": vlog_tuning,
                "voice_profile": voice_profile,
            },
            "industry": industry,
            "workflow_template": workflow,
            "template_selection": {
                "scope": template_scope,
                "selected": selected_template,
                "active": active_template,
                "candidates": template_candidates[:20],
                "mode": template_policy.get("workflow_template_mode", "fallback"),
            },
            "capability_snapshot": capability_snapshot,
            "generation_plan": generation_plan,
            "comfyui_render": comfyui_result,
            "libtv_session": libtv_result,
        },
        "call_log": _agent_log(
            "visualizer",
            "Visual prompts generated; local ComfyUI first and LibTV fallback",
            {
                "prompt_count": len(prompts),
                "media_count": len(media_pack),
                "comfyui_ok": bool(comfyui_result.get("ok")),
                "comfyui_mode": comfyui_result.get("mode"),
                "comfyui_prompt_id": comfyui_result.get("prompt_id"),
                "industry": industry,
                "workflow_env_key": workflow.get("env_key"),
                "workflow_path": workflow.get("workflow_path"),
                "template_scope": template_scope,
                "template_selected": selected_template,
                "template_mode": template_policy.get("workflow_template_mode", "fallback"),
                "generation_plan_fallback_required": bool(generation_plan.get("fallback_required", False)),
                "generation_plan_readiness": generation_plan.get("readiness", 0),
                "libtv_ok": bool(libtv_result.get("ok")),
                "libtv_mode": libtv_result.get("mode"),
                "engine_selected": engine,
                "digital_human_mode": digital_human_mode,
                "vlog_narration_mode": vlog_mode,
                "strategy_version": industry_policy.get("strategy_version", "general_safe_v1"),
            },
        ),
    }


async def dispatcher(state: DragonState) -> dict[str, Any]:
    scenes = state.get("inkwriter_output", {}).get("scenes", [])
    prompts = state.get("visualizer_output", {}).get("prompt_pack", [])
    media = state.get("visualizer_output", {}).get("media_pack", [])
    visualizer_industry = state.get("visualizer_output", {}).get("industry")
    visualizer_workflow = state.get("visualizer_output", {}).get("workflow_template", {})
    visualizer_generation_plan = state.get("visualizer_output", {}).get("generation_plan", {})
    visualizer_style_profile = state.get("visualizer_output", {}).get("style_profile", {})
    comfyui_render = state.get("visualizer_output", {}).get("comfyui_render", {})
    libtv_session = state.get("visualizer_output", {}).get("libtv_session", {})
    hot_topics = state.get("hot_topics", [])
    user_id = str(state.get("user_id") or "shared")
    trace_id = str(state.get("trace_id") or f"trace_{uuid.uuid4().hex[:12]}")

    jobs = []
    for idx in range(max(len(scenes), len(prompts), len(media))):
        jobs.append(
            {
                "job_id": f"content_job_{idx + 1}",
                "script": scenes[idx] if idx < len(scenes) else None,
                "prompt": prompts[idx] if idx < len(prompts) else None,
                "media": media[idx] if idx < len(media) else None,
            }
        )

    content_package = {
        "package_id": f"pkg_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "topics": hot_topics,
        "jobs": jobs,
        "ops_instruction": {
            "publish_window": "19:00-22:00 Asia/Shanghai",
            "cta": "DM for pricing and details",
            "tone": "friendly_trustworthy",
            "rag_boost": {
                "formula_count": int(state.get("rag_ingested_count", 0) or 0),
                "reference_count": len(state.get("strategy", {}).get("rag_references", [])),
            },
            "visual_delivery": {
                "engine": state.get("visualizer_output", {}).get("engine", "nano-banana-pro"),
                "industry": visualizer_industry,
                "workflow_template": visualizer_workflow,
                "generation_plan": visualizer_generation_plan,
                "style_profile": visualizer_style_profile,
                "media_count": len(media),
                "comfyui_prompt_id": comfyui_render.get("prompt_id"),
                "comfyui_mode": comfyui_render.get("mode"),
                "libtv_session_id": libtv_session.get("session_id"),
                "libtv_project_url": libtv_session.get("project_url"),
                "voice_result": state.get("visualizer_output", {}).get("voice_result", {}),
                "compose_result": state.get("visualizer_output", {}).get("compose_result", {}),
            },
        },
    }
    post_plan = build_post_production_plan(
        media_urls=[
            str(item.get("url", "")).strip()
            for item in media
            if isinstance(item, dict) and str(item.get("url", "")).strip()
        ],
        industry=str(visualizer_industry or "general"),
        auto_image_retouch=bool((visualizer_generation_plan.get("auto_post_production", {}) or {}).get("auto_image_retouch", True)),
        auto_video_edit=bool((visualizer_generation_plan.get("auto_post_production", {}) or {}).get("auto_video_edit", True)),
        auto_clip_cut=bool((visualizer_generation_plan.get("auto_post_production", {}) or {}).get("auto_clip_cut", True)),
        digital_human_mode=bool((visualizer_generation_plan or {}).get("digital_human_mode", False)),
        vlog_narration_mode=bool((visualizer_generation_plan or {}).get("vlog_narration_mode", False)),
        digital_human_tuning=(visualizer_style_profile.get("digital_human_tuning", {}) if isinstance(visualizer_style_profile, dict) else {}),
        vlog_tuning=(visualizer_style_profile.get("vlog_tuning", {}) if isinstance(visualizer_style_profile, dict) else {}),
    )
    content_package["ops_instruction"]["post_production"] = post_plan

    await _invoke_clawhub_skill("dispatcher", "proactive-agent", {"job_count": len(jobs)})
    clawteam_tasks = _build_clawteam_tasks(user_id=user_id, trace_id=trace_id, jobs=jobs)
    inserted = enqueue_inbox_tasks(user_id=user_id, trace_id=trace_id, tasks=clawteam_tasks)

    planner_worker = f"{trace_id}:planner"
    planner_claimed = claim_ready_tasks(
        user_id=user_id,
        trace_id=trace_id,
        worker_id=planner_worker,
        lanes=["planner"],
        limit=max(1, len(jobs) + 4),
    )
    planner_completed = mark_many_completed(
        trace_id=trace_id,
        task_keys=[item["task_key"] for item in planner_claimed],
        worker_id=planner_worker,
    )

    content_worker = f"{trace_id}:content"
    content_claimed = claim_ready_tasks(
        user_id=user_id,
        trace_id=trace_id,
        worker_id=content_worker,
        lanes=["content"],
        limit=max(1, len(jobs) + 4),
    )
    content_completed = mark_many_completed(
        trace_id=trace_id,
        task_keys=[item["task_key"] for item in content_claimed],
        worker_id=content_worker,
    )

    ready = [
        task
        for task in get_ready_tasks(user_id=user_id, trace_id=trace_id, limit=30)
        if str(task.get("lane", "")).lower() == "delivery"
    ][:15]
    queue_summary = clawteam_summary(user_id=user_id, trace_id=trace_id)
    queue_snapshot = {
        "trace_id": trace_id,
        "inserted_count": len(inserted),
        "planner_claimed_count": len(planner_claimed),
        "planner_completed_count": planner_completed,
        "content_claimed_count": len(content_claimed),
        "content_completed_count": content_completed,
        "ready_count": len(ready),
        "ready_tasks": ready[:10],
        "summary": queue_summary,
    }

    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=trace_id,
            node="dispatcher",
            event_type="clawteam_queue_enqueued",
            payload={
                "job_count": len(jobs),
                "inserted_count": len(inserted),
                "planner_completed": planner_completed,
                "content_completed": content_completed,
                "ready_count": len(ready),
                "queue_summary": queue_summary,
            },
            level="info",
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "content_package": content_package,
        "dispatch_plan": {
            "queue": "edge_content_distribution",
            "edge_count": len(state.get("edge_targets", [])),
            "job_count": len(jobs),
            "clawteam_trace_id": trace_id,
            "clawteam_ready_count": len(ready),
            "clawteam_planner_completed": planner_completed,
            "clawteam_content_completed": content_completed,
        },
        "clawteam_queue": queue_snapshot,
        "call_log": _agent_log("dispatcher", "Dispatch plan built", {"job_count": len(jobs)}),
    }


async def discover_edge_skills(state: DragonState) -> dict[str, Any]:
    targets = state.get("edge_targets", [])
    await _invoke_clawhub_skill(
        "discover_edge_skills",
        "skill-vetter",
        {
            "target_count": len(targets),
            "required_skills": _infer_required_edge_skills(state),
            "required_commands": _infer_required_edge_commands(state),
        },
    )
    await _invoke_clawhub_skill(
        "discover_edge_skills",
        "cli-anything",
        {"target_count": len(targets), "mode": "skill_manifest_binding"},
    )
    if not targets:
        return {
            "edge_skill_plan": {
                "required_skills": [],
                "required_commands": [],
                "selected_targets": 0,
            },
            "call_log": _agent_log("discover_edge_skills", "No edge targets available", {}),
        }

    required_skills = _infer_required_edge_skills(state)
    required_commands = _infer_required_edge_commands(state)
    scored_targets: list[tuple[float, dict[str, Any], list[str], list[str]]] = []

    for target in targets:
        target_skills = _normalize_skill_names(target.get("skills"))
        target_commands = _normalize_command_names(target.get("skill_commands"))
        skill_set = set(target_skills)
        command_blob = " | ".join(target_commands).lower()
        if required_skills:
            skill_score = len([s for s in required_skills if s in skill_set]) / len(required_skills)
        else:
            skill_score = 1.0

        if required_commands:
            command_hits = 0
            for cmd_hint in required_commands:
                hint = cmd_hint.strip().lower()
                if hint and hint in command_blob:
                    command_hits += 1
            command_score = command_hits / len(required_commands)
        else:
            command_score = 1.0

        if not target_skills and not target_commands:
            score = 0.2
        elif target_skills and not target_commands:
            score = 0.7 * skill_score
        else:
            score = 0.7 * skill_score + 0.3 * command_score

        scored_targets.append((score, target, target_skills, target_commands))

    scored_targets.sort(key=lambda row: row[0], reverse=True)
    has_positive = any(score > 0 for score, _, _, _ in scored_targets)
    selected_rows = [row for row in scored_targets if row[0] > 0] if has_positive else scored_targets
    selected_targets = [row[1] for row in selected_rows]

    coverage = 0.0
    if selected_rows:
        coverage = sum(row[0] for row in selected_rows) / len(selected_rows)

    dispatch_plan = {
        **state.get("dispatch_plan", {}),
        "required_edge_skills": required_skills,
        "required_edge_commands": required_commands,
        "selected_edges": len(selected_targets),
        "skill_coverage": round(coverage, 3),
    }
    edge_skill_plan = {
        "required_skills": required_skills,
        "required_commands": required_commands,
        "selected_targets": len(selected_targets),
        "coverage": round(coverage, 3),
        "top_edges": [
            {
                "edge_id": row[1].get("edge_id"),
                "score": round(row[0], 3),
                "skills": row[2][:10],
                "commands": row[3][:5],
            }
            for row in selected_rows[:8]
        ],
    }
    return {
        "edge_targets": selected_targets,
        "dispatch_plan": dispatch_plan,
        "edge_skill_plan": edge_skill_plan,
        "call_log": _agent_log(
            "discover_edge_skills",
            "Edge skill discovery completed",
            {
                "required_skills": required_skills,
                "required_commands": required_commands,
                "selected_targets": len(selected_targets),
                "coverage": round(coverage, 3),
            },
        ),
    }


async def distribute_to_edge(state: DragonState) -> dict[str, Any]:
    targets = state.get("edge_targets", [])
    await _invoke_clawhub_skill(
        "distribute_to_edge",
        "api-gateway",
        {"target_count": len(targets)},
    )
    return {
        "call_log": _agent_log(
            "distribute_to_edge",
            "Distribution stage entered",
            {"target_count": len(targets)},
        )
    }


def _route_distribution(state: DragonState):
    targets = state.get("edge_targets", [])
    if not targets:
        return "skip_distribution"
    return "dispatch"


async def edge_delivery_worker(state: DragonState) -> dict[str, Any]:
    from runtime_stage_router import derive_dispatcher_risk_flags

    content_package = state.get("content_package", {})
    targets = state.get("edge_targets", [])
    user_id = str(state.get("user_id") or "shared")
    trace_id = str(state.get("trace_id") or "")
    delivery_worker = f"{trace_id}:delivery_worker" if trace_id else "delivery_worker"
    claimed = (
        claim_ready_tasks(
            user_id=user_id,
            trace_id=trace_id,
            worker_id=delivery_worker,
            lanes=["delivery"],
            limit=max(1, len(content_package.get("jobs", [])) + 4),
        )
        if trace_id
        else []
    )
    claimed_keys = [str(item.get("task_key")) for item in claimed if str(item.get("task_key")).strip()]
    rows: list[dict[str, Any]] = []

    for edge_target in targets:
        message = {
            "edge_id": edge_target.get("edge_id"),
            "account_id": edge_target.get("account_id"),
            "webhook_url": edge_target.get("webhook_url"),
            "edge_skills": edge_target.get("skills", []),
            "edge_skill_commands": edge_target.get("skill_commands", []),
            "content_package": content_package,
            "ops_instruction": content_package.get("ops_instruction", {}),
            "issued_at": datetime.now(timezone.utc).isoformat(),
        }

        delivery_result = await _deliver_to_edge(message)
        rows.append(
            {
                "edge_id": edge_target.get("edge_id"),
                "account_id": edge_target.get("account_id"),
                "accepted": bool(delivery_result.get("accepted", True)),
                "transport": delivery_result.get("transport", "unknown"),
                "detail": delivery_result.get("detail"),
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )

    accepted = len([x for x in rows if x.get("accepted")])
    worker_completed = 0
    worker_failed = 0
    if trace_id and claimed_keys:
        all_accepted = len(rows) > 0 and accepted >= len(rows)
        if all_accepted:
            worker_completed = mark_many_completed(
                trace_id=trace_id,
                task_keys=claimed_keys,
                worker_id=delivery_worker,
            )
        else:
            worker_failed = mark_many_failed(
                trace_id=trace_id,
                task_keys=claimed_keys,
                worker_id=delivery_worker,
                error=f"delivery_not_fully_accepted accepted={accepted}/{len(rows)}",
            )
    queue_summary = clawteam_summary(user_id=user_id, trace_id=trace_id) if trace_id else {}
    risk_flags = derive_dispatcher_risk_flags(
        queue_summary=queue_summary,
        selected_edges=len(targets),
        expected_deliveries=len(targets),
        delivered=len(rows),
        accepted=accepted,
        worker_failed_count=worker_failed,
    )

    return {
        "delivery_results": rows,
        "clawteam_queue": {
            **(state.get("clawteam_queue", {}) or {}),
            "delivery_claimed_count": len(claimed_keys),
            "delivery_completed_count": worker_completed,
            "delivery_failed_count": worker_failed,
            "summary": queue_summary,
        },
        "dispatch_plan": {
            **(state.get("dispatch_plan", {}) or {}),
            "risk_flags": risk_flags,
        },
        "call_log": _agent_log(
            "distribute_to_edge",
            "Edge package batch delivered",
            {
                "target_count": len(targets),
                "accepted": accepted,
                "claimed_delivery_tasks": len(claimed_keys),
                "delivery_completed_count": worker_completed,
                "delivery_failed_count": worker_failed,
            },
        ),
    }


async def collect_delivery(state: DragonState) -> dict[str, Any]:
    from runtime_stage_router import derive_dispatcher_risk_flags

    expected = len(state.get("edge_targets", []))
    delivered = len(state.get("delivery_results", []))
    accepted = len([x for x in state.get("delivery_results", []) if x.get("accepted")])
    user_id = str(state.get("user_id") or "shared")
    trace_id = str(state.get("trace_id") or "")
    completed_count = 0
    failed_count = 0
    audit_worker = f"{trace_id}:audit_worker" if trace_id else "audit_worker"
    audit_claimed = (
        claim_ready_tasks(
            user_id=user_id,
            trace_id=trace_id,
            worker_id=audit_worker,
            lanes=["audit"],
            limit=4,
        )
        if trace_id
        else []
    )
    audit_task_keys = [str(item.get("task_key")) for item in audit_claimed if str(item.get("task_key")).strip()]
    if trace_id and audit_task_keys:
        if expected > 0 and accepted >= expected:
            completed_count = mark_many_completed(
                trace_id=trace_id,
                task_keys=audit_task_keys,
                worker_id=audit_worker,
            )
        elif expected > 0 and delivered >= expected and accepted < expected:
            failed_count = mark_many_failed(
                trace_id=trace_id,
                task_keys=audit_task_keys,
                worker_id=audit_worker,
                error=f"audit_rejected accepted={accepted} expected={expected}",
            )
    queue_summary = clawteam_summary(user_id=user_id, trace_id=trace_id) if trace_id else {}

    dispatch_plan = {
        **state.get("dispatch_plan", {}),
        "expected_deliveries": expected,
        "delivered": delivered,
        "accepted": accepted,
        "clawteam_marked_completed": completed_count,
        "clawteam_marked_failed": failed_count,
        "risk_flags": derive_dispatcher_risk_flags(
            queue_summary=queue_summary,
            selected_edges=expected,
            expected_deliveries=expected,
            delivered=delivered,
            accepted=accepted,
            worker_failed_count=failed_count,
        ),
    }
    return {
        "dispatch_plan": dispatch_plan,
        "clawteam_queue": {
            **(state.get("clawteam_queue", {}) or {}),
            "summary": queue_summary,
        },
        "call_log": _agent_log(
            "dispatcher",
            "Delivery collection updated",
            {
                "expected": expected,
                "delivered": delivered,
                "accepted": accepted,
                "clawteam_marked_completed": completed_count,
                "clawteam_marked_failed": failed_count,
                "audit_claimed_count": len(audit_task_keys),
            },
        ),
    }


def _route_collect_delivery(state: DragonState) -> str:
    expected = len(state.get("edge_targets", []))
    delivered = len(state.get("delivery_results", []))
    if expected == 0 or delivered >= expected:
        return "done"
    return "pending"


async def engagement_gate(state: DragonState) -> dict[str, Any]:
    return {
        "call_log": _agent_log(
            "echoer",
            "Engagement fan-out entered",
            {"delivery_accepted": len([x for x in state.get("delivery_results", []) if x.get("accepted")])},
        )
    }


async def echoer(state: DragonState) -> dict[str, Any]:
    await _invoke_clawhub_skill("echoer", "humanizer", {"mode": "engagement_seed"})
    replies = [
        "This method worked for us, start with a small test batch.",
        "Happy to share details in DM if you need pricing breakdown.",
    ]
    llm_error: str | None = None
    _industry_tag = str(state.get("industry_tag") or "general").strip().lower() or "general"
    _industry_kb_refs = [
        {"statement": item.get("statement", ""), "category": item.get("category", "")}
        for item in (state.get("industry_kb_context") or [])
        if isinstance(item, dict)
    ][:3]
    try:
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                f"You are Echoer agent for social engagement in the {_industry_tag} industry. "
                "Return strict JSON array of 2 short replies, each <= 24 words. "
                "Replies must feel native to the industry and match the brand tone."
            ),
            user_prompt=json.dumps(
                {
                    "task": state.get("task_description", ""),
                    "topics": state.get("hot_topics", []),
                    "tone": state.get("strategy", {}).get("tone", "friendly_trustworthy"),
                    "industry_tag": _industry_tag,
                    "industry_kb_insights": _industry_kb_refs,
                },
                ensure_ascii=False,
            ),
            meta=RouteMeta(
                critical=False,
                est_tokens=800,
                tenant_tier="basic",
                user_id=str(state.get("user_id") or "shared"),
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="engagement_copy",
            ),
            temperature=0.7,
            force_tier=ModelTier.STANDARD,
        )
        parsed = _safe_json_parse(llm_raw)
        if isinstance(parsed, list):
            refined = [str(item).strip() for item in parsed if str(item).strip()]
            if refined:
                replies = refined[:3]
    except Exception as exc:  # noqa: BLE001
        llm_error = str(exc)
    return {
        "echoer_output": {"seed_replies": replies, "llm_error": llm_error[:280] if llm_error else None},
        "call_log": _agent_log("echoer", "Engagement prompts prepared", {"count": len(replies)}),
    }


async def catcher(state: DragonState) -> dict[str, Any]:
    await _invoke_clawhub_skill("catcher", "summarize", {"source": "campaign_comments"})
    await _invoke_clawhub_skill("catcher", "ontology", {"extract": ["price", "buy", "contact"]})

    leads = [
        {
            "lead_id": "lead_hot_1",
            "intent": "hot",
            "text": "How much and where to buy?",
            "channel": "comment",
        },
        {
            "lead_id": "lead_warm_1",
            "intent": "warm",
            "text": "Can you DM product details?",
            "channel": "comment",
        },
    ]
    return {
        "catcher_output": {"captured_leads": leads},
        "leads": leads,
        "call_log": _agent_log("catcher", "Lead intents captured", {"count": len(leads)}),
    }


async def abacus(state: DragonState) -> dict[str, Any]:
    leads = state.get("leads", [])
    scored = []
    for lead in leads:
        score = 0.92 if lead.get("intent") == "hot" else 0.74
        scored.append({**lead, "score": score, "grade": "A" if score >= 0.85 else "B"})

    avg_score = sum(item["score"] for item in scored) / len(scored) if scored else 0.0
    await _invoke_clawhub_skill("abacus", "api-gateway", {"lead_count": len(scored)})

    return {
        "abacus_output": {"scored_leads": scored, "avg_score": round(avg_score, 4)},
        "leads": scored,
        "score": round(avg_score, 4),
        "call_log": _agent_log("abacus", "Lead scoring completed", {"avg_score": round(avg_score, 4)}),
    }


def _route_after_verification_gate(state: DragonState) -> str:
    route = str((state.get("verification_gate") or {}).get("route", "continue")).strip().lower()
    if route == "continue":
        return "continue"
    if route == "review":
        return "review"
    return "reject"


def _route_after_abacus(state: DragonState) -> str:
    if bool(state.get("hitl_required", False)):
        return "human_approval_gate"
    score = float(state.get("score", 0))
    if score >= 0.75:
        return "human_approval_gate"
    return "feedback"


async def human_approval_gate(state: DragonState) -> dict[str, Any]:
    hitl_enabled = _bool_env("HITL_ENABLED", False)
    pre_required = bool(state.get("hitl_required", False))
    if not hitl_enabled:
        return {
            "hitl_required": pre_required,
            "hitl_decision": "approved",
            "hitl_reason": (
                "HITL required but disabled; auto-approved by policy fallback"
                if pre_required
                else "HITL disabled by env"
            ),
            "call_log": _agent_log(
                "followup",
                "HITL fallback used (disabled)",
                {"pre_required": pre_required},
            ),
        }

    timeout_sec = max(30, int(os.getenv("HITL_WAIT_TIMEOUT_SEC", "300")))
    action_scope = {
        "user_id": state.get("user_id"),
        "trace_id": state.get("trace_id"),
        "task_description": state.get("task_description"),
        "score": float(state.get("score", 0) or 0),
        "lead_count": len(state.get("leads", [])),
        "dispatch_plan": state.get("dispatch_plan", {}),
        "preflight_hitl_reason": state.get("hitl_reason"),
    }

    approval_id = f"hitl_{uuid.uuid4().hex[:12]}"
    if _human_approval_request_hook is not None:
        req_result = _human_approval_request_hook(
            {
                "approval_id": approval_id,
                "type": "followup_action",
                "scope": action_scope,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if inspect.isawaitable(req_result):
            req_result = await req_result
        if isinstance(req_result, dict) and req_result.get("approval_id"):
            approval_id = str(req_result["approval_id"])

    decision_payload: dict[str, Any] = {"decision": "pending", "reason": "awaiting_approval"}
    if _human_approval_await_hook is not None:
        await_result = _human_approval_await_hook(approval_id, timeout_sec)
        if inspect.isawaitable(await_result):
            await_result = await await_result
        if isinstance(await_result, dict):
            decision_payload = await_result
    else:
        # fallback loop when no external approval backend is configured
        await asyncio.sleep(0.05)
        decision_payload = {"decision": "approved", "reason": "no_approval_backend_auto_approved"}

    decision = str(decision_payload.get("decision", "rejected")).lower()
    if decision not in {"approved", "rejected"}:
        decision = "rejected"
    reason = str(decision_payload.get("reason", ""))[:300] or "unknown"

    return {
        "hitl_required": True,
        "hitl_approval_id": approval_id,
        "hitl_decision": decision,
        "hitl_reason": reason,
        "call_log": _agent_log(
            "followup",
            "HITL decision resolved",
            {"approval_id": approval_id, "decision": decision, "reason": reason},
        ),
    }


def _route_after_human_approval(state: DragonState) -> str:
    decision = str(state.get("hitl_decision", "rejected")).lower()
    if decision == "approved":
        preflight_route = str((state.get("verification_gate") or {}).get("route", "")).strip().lower()
        has_leads = bool(state.get("leads"))
        if preflight_route == "review" and not has_leads:
            return "memory_governor"
        return "followup"
    return "feedback"


async def followup(state: DragonState) -> dict[str, Any]:
    leads = state.get("leads", [])
    await _invoke_clawhub_skill("followup", "openai-whisper", {"lead_count": len(leads)})
    user_id = str(state.get("user_id") or "shared")
    tenant_id = str(state.get("tenant_id") or "tenant_main")
    trace_id = str(state.get("trace_id") or f"trace_{uuid.uuid4().hex[:8]}")
    avg_score = float(state.get("score", 0) or 0.0)

    spawn_cfg = _build_followup_spawn_plan(leads=leads, trace_id=trace_id)
    plan = spawn_cfg.get("plan", {}) if isinstance(spawn_cfg.get("plan"), dict) else {}
    shards = plan.get("shards", []) if isinstance(plan.get("shards"), list) else []
    mode = str(spawn_cfg.get("mode", "single"))
    child_concurrency = max(1, int(spawn_cfg.get("child_concurrency", 1) or 1))
    max_concurrency = min(max(1, int(plan.get("child_count", len(shards) or 1))), child_concurrency)

    spawn_run_id = create_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
        mode=mode,
        parent_agent="followup",
        plan=plan,
        max_concurrency=max_concurrency,
    )

    queue_inserted: list[dict[str, Any]] = []
    if trace_id and shards:
        queue_inserted = enqueue_inbox_tasks(
            user_id=user_id,
            trace_id=trace_id,
            tasks=[
                {
                    "task_key": f"followup_child_{str(shard.get('child_id') or idx + 1)}",
                    "lane": "followup_call",
                    "priority": 65,
                    "depends_on": [],
                    "payload": {
                        "spawn_run_id": spawn_run_id,
                        "child_id": str(shard.get("child_id") or ""),
                        "lead_ids": list(shard.get("lead_ids") or []),
                        "lead_count": len(shard.get("leads") or []),
                    },
                }
                for idx, shard in enumerate(shards)
            ],
        )

    child_runs: list[dict[str, Any]] = []
    if shards:
        semaphore = asyncio.Semaphore(max_concurrency)
        child_runs = await asyncio.gather(
            *[
                _run_followup_child(
                    shard=shard,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    score=avg_score,
                    semaphore=semaphore,
                )
                for shard in shards
            ]
        )

    claimed_count = 0
    queue_completed = 0
    queue_failed = 0
    if trace_id and shards:
        claimed = claim_ready_tasks(
            user_id=user_id,
            trace_id=trace_id,
            worker_id=f"{trace_id}:followup_orchestrator",
            lanes=["followup_call"],
            limit=max(1, len(shards) + 4),
        )
        claimed_count = len(claimed)
        by_child_id: dict[str, str] = {}
        for task in claimed:
            payload = task.get("payload", {}) if isinstance(task.get("payload"), dict) else {}
            child_id = str(payload.get("child_id") or "").strip()
            task_key = str(task.get("task_key") or "").strip()
            if child_id and task_key:
                by_child_id[child_id] = task_key
        completed_task_keys: list[str] = []
        failed_task_keys: list[str] = []
        for run in child_runs:
            key = by_child_id.get(str(run.get("child_id") or ""))
            if not key:
                continue
            if str(run.get("status")) == "completed":
                completed_task_keys.append(key)
            else:
                failed_task_keys.append(key)
        if completed_task_keys:
            queue_completed = mark_many_completed(
                trace_id=trace_id,
                task_keys=completed_task_keys,
                worker_id=f"{trace_id}:followup_orchestrator",
            )
        if failed_task_keys:
            queue_failed = mark_many_failed(
                trace_id=trace_id,
                task_keys=failed_task_keys,
                worker_id=f"{trace_id}:followup_orchestrator",
                error="followup_child_failed",
            )

    actions: list[dict[str, Any]] = []
    child_failures = 0
    for run in child_runs:
        actions.extend(run.get("actions", []) if isinstance(run.get("actions"), list) else [])
        if str(run.get("status")) != "completed":
            child_failures += 1
        record_followup_child_run(
            spawn_run_id=spawn_run_id,
            child_id=str(run.get("child_id") or ""),
            worker_id=str(run.get("worker_id") or ""),
            lead_ids=[str(x) for x in run.get("lead_ids", []) if str(x).strip()],
            status=str(run.get("status") or "unknown"),
            action_count=int(run.get("action_count", 0) or 0),
            started_at=str(run.get("started_at") or datetime.now(timezone.utc).isoformat()),
            finished_at=str(run.get("finished_at") or datetime.now(timezone.utc).isoformat()),
            duration_ms=int(run.get("duration_ms", 0) or 0),
            error=(str(run.get("error"))[:300] if run.get("error") else None),
            detail={
                "call_brief": run.get("call_brief"),
                "action_count": int(run.get("action_count", 0) or 0),
            },
        )

    if not actions:
        actions = [
            {
                "lead_id": lead.get("lead_id"),
                "action": "call_now" if str(lead.get("grade", "")).upper() == "A" else "dm_then_call",
            }
            for lead in leads
        ]

    child_briefs = [
        str(run.get("call_brief") or "").strip()
        for run in child_runs
        if str(run.get("call_brief") or "").strip()
    ]
    merged_brief = " | ".join(child_briefs[:3]) if child_briefs else None

    run_status = "completed" if child_failures == 0 else ("partial_failed" if actions else "failed")
    spawn_summary = {
        "spawn_run_id": spawn_run_id,
        "mode": mode,
        "lead_count": len(leads),
        "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
        "max_concurrency": max_concurrency,
        "queue_inserted_count": len(queue_inserted),
        "queue_claimed_count": claimed_count,
        "queue_completed_count": queue_completed,
        "queue_failed_count": queue_failed,
        "child_failure_count": child_failures,
        "status": run_status,
    }
    finish_followup_spawn_run(
        spawn_run_id=spawn_run_id,
        status=run_status,
        summary=spawn_summary,
    )
    persisted_spawn = get_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
    )

    return {
        "followup_output": {
            "actions": actions,
            "call_brief": merged_brief,
            "subagent_spawn": {
                **spawn_summary,
                "children": persisted_spawn.get("children", [])[:20] if isinstance(persisted_spawn, dict) else [],
            },
        },
        "followup_spawn": spawn_summary,
        "clawteam_queue": {
            **(state.get("clawteam_queue", {}) or {}),
            "followup_inserted_count": len(queue_inserted),
            "followup_claimed_count": claimed_count,
            "followup_completed_count": queue_completed,
            "followup_failed_count": queue_failed,
            "followup_spawn_run_id": spawn_run_id,
        },
        "call_log": _agent_log(
            "followup",
            "Follow-up plan generated with deterministic sub-agent spawning",
            {
                "action_count": len(actions),
                "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
                "max_concurrency": max_concurrency,
                "child_failure_count": child_failures,
            },
        ),
    }


async def feedback(state: DragonState) -> dict[str, Any]:
    user_id = str(state.get("user_id") or "shared")
    query = " ".join(
        [state.get("task_description", "")] + state.get("hot_topics", [])
    ).strip() or "campaign optimization"
    similar_docs = search_formula_documents(query, k=3, user_id=user_id)
    refs = [_extract_rag_reference(doc) for doc in similar_docs]

    suggestions: list[str] = []
    for ref in refs:
        category = ref.get("category") or "generic"
        account = ref.get("account") or "unknown"
        suggestions.append(
            f"Priority reuse of {category} formulas (reference account: {account}); strengthen the first 3-second hook and final CTA."
        )
    if not suggestions:
        suggestions.append(
            "No reusable formulas found yet. Continue ingesting benchmark account samples to expand the strategy library."
        )

    delivery = state.get("dispatch_plan", {})
    summary = {
        "score": state.get("score", 0),
        "lead_count": len(state.get("leads", [])),
        "delivery": delivery,
        "rag_similar_count": len(refs),
        "rag_ingested_count": int(state.get("rag_ingested_count", 0) or 0),
        "user_id": user_id,
    }
    score = float(state.get("score", 0) or 0.0)
    expected_deliveries = max(0, int(delivery.get("expected_deliveries", 0) or 0))
    accepted_deliveries = max(0, int(delivery.get("accepted", 0) or 0))
    delivered = max(0, int(delivery.get("delivered", 0) or 0))
    replay_success_rate = (
        accepted_deliveries / expected_deliveries if expected_deliveries > 0 else 1.0
    )
    conversion_rate = max(0.0, min(1.0, score))
    complaint_signals_raw = state.get("catcher_output", {}).get("complaint_signals", [])
    if isinstance(complaint_signals_raw, list):
        complaint_count = len(complaint_signals_raw)
    else:
        complaint_count = int(complaint_signals_raw or 0)
    traffic_base = max(1, delivered or expected_deliveries or len(state.get("leads", [])) or 1)
    complaint_rate = complaint_count / float(traffic_base)
    if expected_deliveries > accepted_deliveries:
        complaint_rate += (expected_deliveries - accepted_deliveries) / max(1.0, expected_deliveries * 5.0)
    complaint_rate = max(0.0, min(1.0, complaint_rate))
    bandit_objectives = {
        "conversion_rate": round(conversion_rate, 6),
        "replay_success_rate": round(replay_success_rate, 6),
        "complaint_rate": round(complaint_rate, 6),
    }
    selected_storyboard = int(state.get("strategy", {}).get("preferred_storyboard_count", 7) or 7)
    selected_tone = str(state.get("strategy", {}).get("tone", "friendly_trustworthy"))
    template_selection = state.get("visualizer_output", {}).get("template_selection", {})
    template_scope = str(template_selection.get("scope", "")).strip() or None
    template_arm = str(template_selection.get("selected", "")).strip() or None
    bandit_snapshot = policy_bandit_update(
        user_id=user_id,
        storyboard_count=selected_storyboard,
        tone=selected_tone,
        conversion_rate=conversion_rate,
        replay_success_rate=replay_success_rate,
        complaint_rate=complaint_rate,
        trace_id=str(state.get("trace_id") or "") or None,
        template_scope=template_scope,
        template_arm=template_arm,
    )
    reward = float((bandit_snapshot.get("latest_update") or {}).get("reward", 0.0) or 0.0)

    evolution_entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "summary": "Campaign loop closed and RAG-based optimization generated",
        "payload": {
            **summary,
            "bandit_reward": reward,
            "bandit_objectives": bandit_objectives,
                "selected_storyboard": selected_storyboard,
                "selected_tone": selected_tone,
                "selected_template": template_arm,
                "template_scope": template_scope,
                "suggestions": suggestions,
                "similar_formulas": refs,
            },
        }

    await _invoke_clawhub_skill(
        "feedback",
        "ontology",
        {"summary": summary, "suggestion_count": len(suggestions)},
    )
    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=str(state.get("trace_id") or "") or None,
            node="feedback",
            event_type="optimization_generated",
            payload={
                "score": state.get("score", 0),
                "lead_count": len(state.get("leads", [])),
                "suggestion_count": len(suggestions),
                "rag_similar_count": len(refs),
                "bandit_reward": reward,
                "bandit_objectives": bandit_objectives,
            },
            level="info",
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "call_log": _agent_log("feedback", "Feedback node completed with RAG optimization", summary),
        "policy_bandit": bandit_snapshot,
        "evolution_log": [evolution_entry],
    }


async def self_improving_loop(state: DragonState) -> dict[str, Any]:
    await _invoke_clawhub_skill(
        "feedback",
        "self-improving-agent",
        {
            "score": state.get("score", 0),
            "lead_count": len(state.get("leads", [])),
            "delivery_accepted": len([x for x in state.get("delivery_results", []) if x.get("accepted")]),
            "rag_ingested_count": int(state.get("rag_ingested_count", 0) or 0),
            "latest_suggestion": (
                state.get("evolution_log", [{}])[-1]
                .get("payload", {})
                .get("suggestions", [""])[0]
            ),
        },
    )
    return {
        "call_log": _agent_log("feedback", "Self-improving memory updated"),
    }


def _route_after_rag_ingest(state: DragonState) -> str:
    if bool(state.get("analysis_mode", False)):
        return "formula_only"
    return "full_pipeline"


# -------- DM Sub-flow --------


async def dm_catcher(state: DMState) -> dict[str, Any]:
    dm_text = state.get("dm_text", "")
    await _invoke_clawhub_skill("catcher", "ontology", {"dm_text": dm_text})
    intent = "hot" if any(token in dm_text.lower() for token in ["price", "buy", "how", "deal", "order"]) else "warm"
    leads = [
        {
            "lead_id": f"dm_{datetime.now(timezone.utc).strftime('%H%M%S')}",
            "intent": intent,
            "text": dm_text,
            "edge_id": state.get("edge_id"),
            "account_id": state.get("account_id"),
        }
    ]
    return {
        "catcher_output": {"captured_leads": leads},
        "leads": leads,
        "call_log": _agent_log("catcher", "DM lead extracted", {"intent": intent}),
    }


async def dm_abacus(state: DMState) -> dict[str, Any]:
    leads = state.get("leads", [])
    scored = []
    for lead in leads:
        score = 0.95 if lead.get("intent") == "hot" else 0.7
        scored.append({**lead, "score": score, "grade": "A" if score >= 0.85 else "B"})

    avg = sum(item["score"] for item in scored) / len(scored) if scored else 0.0
    return {
        "abacus_output": {"scored_leads": scored, "avg_score": round(avg, 4)},
        "leads": scored,
        "score": round(avg, 4),
        "call_log": _agent_log("abacus", "DM lead scored", {"avg_score": round(avg, 4)}),
    }


async def dm_followup(state: DMState) -> dict[str, Any]:
    leads = state.get("leads", [])
    user_id = str(state.get("user_id") or state.get("account_id") or "shared")
    tenant_id = str(state.get("tenant_id") or "tenant_main")
    trace_id = str(state.get("trace_id") or f"dm_trace_{uuid.uuid4().hex[:8]}")
    avg_score = float(state.get("score", 0) or 0.0)

    spawn_cfg = _build_followup_spawn_plan(leads=leads, trace_id=trace_id)
    plan = spawn_cfg.get("plan", {}) if isinstance(spawn_cfg.get("plan"), dict) else {}
    shards = plan.get("shards", []) if isinstance(plan.get("shards"), list) else []
    mode = str(spawn_cfg.get("mode", "single"))
    child_concurrency = max(1, int(spawn_cfg.get("child_concurrency", 1) or 1))
    max_concurrency = min(max(1, int(plan.get("child_count", len(shards) or 1))), child_concurrency)

    spawn_run_id = create_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
        mode=f"dm_{mode}",
        parent_agent="dm_followup",
        plan=plan,
        max_concurrency=max_concurrency,
    )

    queue_inserted: list[dict[str, Any]] = []
    if trace_id and shards:
        queue_inserted = enqueue_inbox_tasks(
            user_id=user_id,
            trace_id=trace_id,
            tasks=[
                {
                    "task_key": f"dm_followup_child_{str(shard.get('child_id') or idx + 1)}",
                    "lane": "followup_call",
                    "priority": 68,
                    "depends_on": [],
                    "payload": {
                        "spawn_run_id": spawn_run_id,
                        "child_id": str(shard.get("child_id") or ""),
                        "lead_ids": list(shard.get("lead_ids") or []),
                        "lead_count": len(shard.get("leads") or []),
                        "dm_mode": True,
                    },
                }
                for idx, shard in enumerate(shards)
            ],
        )

    child_runs: list[dict[str, Any]] = []
    if shards:
        semaphore = asyncio.Semaphore(max_concurrency)
        child_runs = await asyncio.gather(
            *[
                _run_followup_child(
                    shard=shard,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    score=avg_score,
                    semaphore=semaphore,
                )
                for shard in shards
            ]
        )

    claimed_count = 0
    queue_completed = 0
    queue_failed = 0
    if trace_id and shards:
        claimed = claim_ready_tasks(
            user_id=user_id,
            trace_id=trace_id,
            worker_id=f"{trace_id}:dm_followup_orchestrator",
            lanes=["followup_call"],
            limit=max(1, len(shards) + 4),
        )
        claimed_count = len(claimed)
        by_child_id: dict[str, str] = {}
        for task in claimed:
            payload = task.get("payload", {}) if isinstance(task.get("payload"), dict) else {}
            child_id = str(payload.get("child_id") or "").strip()
            task_key = str(task.get("task_key") or "").strip()
            if child_id and task_key:
                by_child_id[child_id] = task_key

        completed_task_keys: list[str] = []
        failed_task_keys: list[str] = []
        for run in child_runs:
            key = by_child_id.get(str(run.get("child_id") or ""))
            if not key:
                continue
            if str(run.get("status")) == "completed":
                completed_task_keys.append(key)
            else:
                failed_task_keys.append(key)
        if completed_task_keys:
            queue_completed = mark_many_completed(
                trace_id=trace_id,
                task_keys=completed_task_keys,
                worker_id=f"{trace_id}:dm_followup_orchestrator",
            )
        if failed_task_keys:
            queue_failed = mark_many_failed(
                trace_id=trace_id,
                task_keys=failed_task_keys,
                worker_id=f"{trace_id}:dm_followup_orchestrator",
                error="dm_followup_child_failed",
            )

    actions: list[dict[str, Any]] = []
    child_failures = 0
    for run in child_runs:
        for item in (run.get("actions") or []):
            actions.append(
                {
                    "lead_id": item.get("lead_id"),
                    "action": (
                        "phone_call_immediate"
                        if str(item.get("action")) == "call_now"
                        else "manual_followup"
                    ),
                    "owner": user_id,
                    "worker_id": item.get("worker_id"),
                }
            )
        if str(run.get("status")) != "completed":
            child_failures += 1
        record_followup_child_run(
            spawn_run_id=spawn_run_id,
            child_id=str(run.get("child_id") or ""),
            worker_id=str(run.get("worker_id") or ""),
            lead_ids=[str(x) for x in run.get("lead_ids", []) if str(x).strip()],
            status=str(run.get("status") or "unknown"),
            action_count=int(run.get("action_count", 0) or 0),
            started_at=str(run.get("started_at") or datetime.now(timezone.utc).isoformat()),
            finished_at=str(run.get("finished_at") or datetime.now(timezone.utc).isoformat()),
            duration_ms=int(run.get("duration_ms", 0) or 0),
            error=(str(run.get("error"))[:300] if run.get("error") else None),
            detail={
                "call_brief": run.get("call_brief"),
                "dm_text_preview": str(state.get("dm_text", ""))[:120],
                "action_count": int(run.get("action_count", 0) or 0),
            },
        )

    if not actions:
        actions = [
            {
                "lead_id": lead.get("lead_id"),
                "action": "phone_call_immediate" if lead.get("grade") == "A" else "manual_followup",
                "owner": user_id,
            }
            for lead in leads
        ]

    child_briefs = [
        str(run.get("call_brief") or "").strip()
        for run in child_runs
        if str(run.get("call_brief") or "").strip()
    ]
    llm_brief = " | ".join(child_briefs[:3]) if child_briefs else None

    run_status = "completed" if child_failures == 0 else ("partial_failed" if actions else "failed")
    spawn_summary = {
        "spawn_run_id": spawn_run_id,
        "mode": f"dm_{mode}",
        "lead_count": len(leads),
        "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
        "max_concurrency": max_concurrency,
        "queue_inserted_count": len(queue_inserted),
        "queue_claimed_count": claimed_count,
        "queue_completed_count": queue_completed,
        "queue_failed_count": queue_failed,
        "child_failure_count": child_failures,
        "status": run_status,
    }
    finish_followup_spawn_run(
        spawn_run_id=spawn_run_id,
        status=run_status,
        summary=spawn_summary,
    )
    persisted_spawn = get_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
    )

    return {
        "followup_output": {
            "actions": actions,
            "call_brief": (llm_brief or "").strip()[:240] or None,
            "subagent_spawn": {
                **spawn_summary,
                "children": persisted_spawn.get("children", [])[:20] if isinstance(persisted_spawn, dict) else [],
            },
        },
        "followup_spawn": spawn_summary,
        "clawteam_queue": {
            **(state.get("clawteam_queue", {}) or {}),
            "followup_inserted_count": len(queue_inserted),
            "followup_claimed_count": claimed_count,
            "followup_completed_count": queue_completed,
            "followup_failed_count": queue_failed,
            "followup_spawn_run_id": spawn_run_id,
        },
        "call_log": _agent_log(
            "followup",
            "DM follow-up generated with deterministic sub-agent spawning",
            {
                "action_count": len(actions),
                "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
                "max_concurrency": max_concurrency,
                "child_failure_count": child_failures,
            },
        ),
    }


def build_main_graph() -> StateGraph:
    builder = StateGraph(DragonState)

    for role_id in _resolve_registered_main_graph_roles():
        builder.add_node(role_id, globals()[_BUSINESS_LOBSTER_NODE_FACTORY_NAMES[role_id]])
    builder.add_node("hotspot_investigation", hotspot_investigation)
    # NOTE:
    # LangGraph forbids node names that collide with state keys.
    # DragonState already contains keys:
    # - constitutional_guardian
    # - verification_gate
    # - memory_governor
    # Keep node IDs distinct with *_node suffix.
    builder.add_node("constitutional_guardian_node", constitutional_guardian_node)
    builder.add_node("verification_gate_node", verification_gate_node)
    builder.add_node("memory_governor_node", memory_governor_node)
    builder.add_node("competitor_analysis_node", competitor_analysis)
    builder.add_node("competitor_formula_analyzer", competitor_formula_analyzer)
    builder.add_node("rag_ingest_node", rag_ingest_node)
    builder.add_node("content_factory_gate", content_factory_gate)
    builder.add_node("discover_edge_skills", discover_edge_skills)
    builder.add_node("distribute_to_edge", distribute_to_edge)
    builder.add_node("edge_delivery_worker", edge_delivery_worker)
    builder.add_node("collect_delivery", collect_delivery)
    builder.add_node("engagement_gate", engagement_gate)
    builder.add_node("human_approval_gate", human_approval_gate)
    builder.add_node("feedback", feedback)
    builder.add_node("self_improving_loop", self_improving_loop)

    builder.add_edge(START, "radar")
    builder.add_edge("radar", "hotspot_investigation")
    builder.add_edge("hotspot_investigation", "strategist")
    builder.add_edge("strategist", "constitutional_guardian_node")
    builder.add_edge("constitutional_guardian_node", "verification_gate_node")
    builder.add_conditional_edges(
        "verification_gate_node",
        _route_after_verification_gate,
        {
            "continue": "memory_governor_node",
            "review": "human_approval_gate",
            "reject": "feedback",
        },
    )
    builder.add_edge("memory_governor_node", "competitor_analysis_node")
    builder.add_edge("competitor_analysis_node", "competitor_formula_analyzer")
    builder.add_edge("competitor_formula_analyzer", "rag_ingest_node")

    builder.add_conditional_edges(
        "rag_ingest_node",
        _route_after_rag_ingest,
        {
            "formula_only": "feedback",
            "full_pipeline": "content_factory_gate",
        },
    )

    builder.add_edge("content_factory_gate", "inkwriter")
    builder.add_edge("content_factory_gate", "visualizer")
    builder.add_edge("inkwriter", "dispatcher")
    builder.add_edge("visualizer", "dispatcher")

    builder.add_edge("dispatcher", "discover_edge_skills")
    builder.add_edge("discover_edge_skills", "distribute_to_edge")
    builder.add_conditional_edges(
        "distribute_to_edge",
        _route_distribution,
        {
            "skip_distribution": "engagement_gate",
            "dispatch": "edge_delivery_worker",
        },
    )

    builder.add_edge("edge_delivery_worker", "collect_delivery")
    builder.add_conditional_edges(
        "collect_delivery",
        _route_collect_delivery,
        {
            "done": "engagement_gate",
            "pending": END,
        },
    )

    # Parallel engagement tier (echoer + catcher)
    builder.add_edge("engagement_gate", "echoer")
    builder.add_edge("engagement_gate", "catcher")
    builder.add_edge("echoer", "abacus")
    builder.add_edge("catcher", "abacus")

    builder.add_conditional_edges(
        "abacus",
        _route_after_abacus,
        {
            "human_approval_gate": "human_approval_gate",
            "feedback": "feedback",
        },
    )
    builder.add_conditional_edges(
        "human_approval_gate",
        _route_after_human_approval,
        {
            "followup": "followup",
            "memory_governor": "memory_governor_node",
            "feedback": "feedback",
        },
    )
    builder.add_edge("followup", "feedback")
    builder.add_edge("feedback", "self_improving_loop")
    builder.add_edge("self_improving_loop", END)

    return builder


def build_dm_graph() -> StateGraph:
    builder = StateGraph(DMState)
    builder.add_node("catcher", dm_catcher)
    builder.add_node("abacus", dm_abacus)
    builder.add_node("followup", dm_followup)

    builder.add_edge(START, "catcher")
    builder.add_edge("catcher", "abacus")
    builder.add_edge("abacus", "followup")
    builder.add_edge("followup", END)
    return builder


app = build_main_graph()
dm_app = build_dm_graph()


# ─────────────────────────────────────────────────────────────────────────────
# 动态图入口：根据 goal + industry_context 动态组装龙虾协作图
# 替代固定 build_main_graph()，让 commander 真正按意图路由
# ─────────────────────────────────────────────────────────────────────────────

async def build_graph_for_goal(
    goal: str,
    industry_context: dict[str, Any],
    checkpointer: Any | None = None,
) -> tuple[Any, "RoutePlan"]:
    """
    根据任务目标动态组装龙虾协作图。

    流程：
      1. CommanderRouter.route(goal) → RoutePlan（决定哪几只虾、并行对、审批节点）
      2. DynamicGraphBuilder.build(route_plan) → StateGraph
      3. graph.compile(checkpointer) → 可执行图

    返回 (compiled_graph, route_plan)，route_plan 可写入 DragonState 供观测。

    兜底逻辑：
      - router 抛异常 → 降级到全员虾固定图（build_main_graph）
      - 空 goal → router 内部已处理，返回 wf_signal_scan（radar+strategist）
    """
    from commander_router import CommanderRouter
    from commander_graph_builder import DynamicGraphBuilder

    try:
        router = CommanderRouter()
        route_plan = await router.route(goal, industry_context)
    except Exception as exc:  # noqa: BLE001
        # router 失败时兜底：全员虾固定图
        import logging
        logging.getLogger(__name__).warning(
            "CommanderRouter.route() failed, falling back to fixed main graph: %s", exc
        )
        compiled = build_main_graph().compile(checkpointer=checkpointer) if checkpointer else build_main_graph().compile()
        # 构造一个最小 RoutePlan 供调用方记录
        from commander_router import _fallback_all_shrimp_plan
        fallback_plan = _fallback_all_shrimp_plan(f"router_exception: {exc}")
        return compiled, fallback_plan

    try:
        builder = DynamicGraphBuilder()
        graph = builder.build(route_plan)
        compiled = graph.compile(checkpointer=checkpointer) if checkpointer else graph.compile()
        return compiled, route_plan
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning(
            "DynamicGraphBuilder.build() failed (route_plan=%s), falling back to fixed main graph: %s",
            route_plan.workflow_id, exc,
        )
        compiled = build_main_graph().compile(checkpointer=checkpointer) if checkpointer else build_main_graph().compile()
        return compiled, route_plan


async def ainvoke_for_goal(
    goal: str,
    state_input: dict[str, Any],
    industry_context: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    checkpointer: Any | None = None,
) -> dict[str, Any]:
    """
    一步完成：路由 → 组图 → 执行，返回最终 DragonState。

    state_input 须包含 DragonState 所需字段（task_description / tenant_id / user_id 等）。
    route_plan 信息会注入到 state_input["route_plan"] 供龙虾和 dashboard 使用。
    """
    ctx = industry_context or {}
    # 确保 tenant_id / user_id 传给 router
    if "tenant_id" not in ctx and "tenant_id" in state_input:
        ctx = {**ctx, "tenant_id": state_input["tenant_id"]}
    if "user_id" not in ctx and "user_id" in state_input:
        ctx = {**ctx, "user_id": state_input["user_id"]}

    compiled_graph, route_plan = await build_graph_for_goal(goal, ctx, checkpointer=checkpointer)

    enriched_input = {
        **state_input,
        "route_plan": {
            "workflow_id": route_plan.workflow_id,
            "lobster_sequence": route_plan.lobster_sequence,
            "parallelizable": [list(p) for p in route_plan.parallelizable],
            "risk_level": route_plan.risk_level,
            "reasons": route_plan.reasons,
            "workflow_chain": route_plan.workflow_chain,
        },
    }

    result = await compiled_graph.ainvoke(enriched_input, config or {})
    return result


