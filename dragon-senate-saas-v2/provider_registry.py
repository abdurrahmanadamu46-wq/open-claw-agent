"""
Provider Registry — LLM Provider 注册表
=========================================
借鉴 NanoBot ProviderSpec 的设计，将所有 LLM provider 的配置、
路由规则、降级策略统一管理。

添加新 provider 只需两步：
  1. 在 PROVIDERS 列表中加一个 ProviderSpec
  2. 设置对应的环境变量

替代原来 llm_router.py 中硬编码的 cloud_targets dict。

Features:
  - 声明式 provider 定义
  - 自动环境变量检测
  - 按 keyword 自动路由模型名
  - 按 API key 前缀自动检测 provider
  - 支持 per-model 参数覆盖
  - 健康状态跟踪
"""

from __future__ import annotations

import json
import os
import time
import logging
import sqlite3
import asyncio
import uuid
import base64
import hashlib
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from collections import deque
from threading import Lock
from typing import Any, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken

from failover_provider import FailoverProvider

logger = logging.getLogger("provider_registry")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_secret(secret: str) -> str:
    text = str(secret or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}{'*' * max(1, len(text) - 8)}{text[-4:]}"


def _provider_secret() -> str:
    return (
        os.getenv("PROVIDER_REGISTRY_SECRET", "").strip()
        or os.getenv("APP_SECRET", "").strip()
        or os.getenv("SECRET_KEY", "").strip()
        or "lobster-provider-registry-secret"
    )


def _provider_fernet() -> Fernet:
    digest = hashlib.sha256(_provider_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_secret(secret: str) -> str:
    text = str(secret or "").strip()
    if not text:
        return ""
    return _provider_fernet().encrypt(text.encode("utf-8")).decode("utf-8")


def _decrypt_secret(ciphertext: str) -> str:
    text = str(ciphertext or "").strip()
    if not text:
        return ""
    try:
        return _provider_fernet().decrypt(text.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("Failed to decrypt provider secret, fallback to raw value")
        return text


# ────────────────────────────────────────────────────────────────────
# ProviderSpec — 声明式 Provider 定义
# ────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ProviderSpec:
    """
    Declarative specification for an LLM provider.

    Adding a new provider = adding a ProviderSpec to PROVIDERS.
    Everything else (routing, config, status display) works automatically.
    """
    # ── Identity ──
    name: str                          # config field name, e.g. "deepseek"
    display_name: str                  # shown in status UI, e.g. "DeepSeek"

    # ── Connection ──
    default_api_base: str              # default OpenAI-compatible endpoint
    provider_type: str = "openai_compatible"  # local | openai_compatible | anthropic | gemini
    env_key: str = ""                  # env var for API key, e.g. "DEEPSEEK_API_KEY"
    env_model: str = ""                # env var for model override
    env_base_url: str = ""             # env var for base URL override

    # ── Routing ──
    keywords: tuple[str, ...] = ()     # model-name keywords for auto-matching
    route: str = "cloud"               # "local" | "cloud"
    is_gateway: bool = False           # can route any model (like OpenRouter)
    detect_by_key_prefix: str = ""     # detect by API key prefix, e.g. "sk-or-"
    detect_by_base_keyword: str = ""   # detect by base URL keyword

    # ── Multi-Key Round-Robin (借鉴 MoneyPrinterTurbo get_api_key 轮询设计) ──
    # 在环境变量中用逗号分隔多个 key，如 DEEPSEEK_API_KEY="key1,key2,key3"
    # ProviderInstance 初始化时会解析并存入 api_keys 列表，调用时轮询
    env_key_multi: str = ""            # 支持多 key 的环境变量（与 env_key 相同，保持兼容）

    # ── Defaults ──
    default_model: str = ""            # default model name
    default_temperature: float = 0.3
    max_retries: int = 1
    timeout_sec: float = 25.0

    # ── Capabilities ──
    supports_streaming: bool = True
    supports_tool_use: bool = False
    supports_vision: bool = False
    supports_max_completion_tokens: bool = False

    # ── Per-model overrides ──
    model_overrides: tuple[tuple[str, dict[str, Any]], ...] = ()
    # e.g. (("deepseek-reasoner", {"temperature": 1.0}),)

    # ── Pricing (CNY per million tokens) ──
    input_price_per_mtok: float = 0.0
    output_price_per_mtok: float = 0.0


@dataclass
class ProviderConfigRecord:
    """Persisted provider config stored in config/providers.json."""

    id: str
    name: str
    provider_type: str
    route: str
    base_url: str
    api_key: str
    default_model: str
    models: list[str] = field(default_factory=list)
    enabled: bool = True
    priority: int = 100
    weight: float = 1.0
    created_at: str = field(default_factory=_utc_now_iso)
    updated_at: str = field(default_factory=_utc_now_iso)
    note: str = ""
    keywords: list[str] = field(default_factory=list)
    is_gateway: bool = False
    detect_by_key_prefix: str = ""
    detect_by_base_keyword: str = ""
    supports_streaming: bool = True
    supports_tool_use: bool = False
    supports_vision: bool = False
    supports_max_completion_tokens: bool = False
    input_price_per_mtok: float = 0.0
    output_price_per_mtok: float = 0.0

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.provider_type,
            "route": self.route,
            "base_url": self.base_url,
            "api_key_masked": _mask_secret(self.api_key),
            "api_key_configured": bool(self.api_key),
            "models": list(self.models),
            "default_model": self.default_model,
            "priority": self.priority,
            "weight": self.weight,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "note": self.note,
        }


# ────────────────────────────────────────────────────────────────────
# PROVIDERS — 全部 Provider 注册表
# ────────────────────────────────────────────────────────────────────

PROVIDERS: list[ProviderSpec] = [
    # ── Local ──
    ProviderSpec(
        name="local_ollama",
        display_name="Local Ollama",
        default_api_base="http://127.0.0.1:11434/v1",
        provider_type="local",
        env_key="LOCAL_LLM_API_KEY",
        env_model="LOCAL_LLM_MODEL",
        env_base_url="LOCAL_LLM_BASE_URL",
        keywords=("ollama", "qwen3", "llama", "mistral", "phi"),
        route="local",
        default_model="qwen3:59b",
    ),

    ProviderSpec(
        name="vllm_self_hosted",
        display_name="vLLM Self-Hosted",
        default_api_base="http://127.0.0.1:8000/v1",
        provider_type="openai_compatible",
        env_key="VLLM_API_KEY",
        env_model="VLLM_MODEL",
        env_base_url="VLLM_BASE_URL",
        keywords=("vllm", "qwen3-72b", "deepseek-v3"),
        route="local",
        default_model="Qwen/Qwen3-72B-Instruct",
        supports_tool_use=True,
        supports_streaming=True,
        input_price_per_mtok=0.05,
        output_price_per_mtok=0.08,
    ),

    # ── Cloud: DeepSeek ──
    ProviderSpec(
        name="deepseek",
        display_name="DeepSeek",
        default_api_base="https://api.deepseek.com/v1",
        env_key="DEEPSEEK_API_KEY",
        env_model="DEEPSEEK_MODEL",
        env_base_url="DEEPSEEK_BASE_URL",
        keywords=("deepseek",),
        default_model="deepseek-chat",
        detect_by_key_prefix="sk-",
        detect_by_base_keyword="deepseek",
        supports_tool_use=True,
        input_price_per_mtok=1.0,
        output_price_per_mtok=2.0,
        model_overrides=(
            ("deepseek-reasoner", {"temperature": 1.0}),
        ),
    ),

    # ── Cloud: DashScope (Alibaba Qwen) ──
    ProviderSpec(
        name="dashscope",
        display_name="DashScope (Qwen)",
        default_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        env_key="DASHSCOPE_API_KEY",
        env_model="CLOUD_LLM_MODEL",
        env_base_url="CLOUD_LLM_BASE_URL",
        keywords=("qwen", "dashscope", "tongyi"),
        default_model="qwen-flash",
        detect_by_base_keyword="dashscope",
        supports_tool_use=True,
        input_price_per_mtok=0.5,
        output_price_per_mtok=1.0,
    ),

    # ── Cloud: VolcEngine (ByteDance) ──
    ProviderSpec(
        name="volcengine",
        display_name="VolcEngine",
        default_api_base="https://ark.cn-beijing.volces.com/api/v3",
        env_key="VOLCENGINE_API_KEY",
        env_model="VOLCENGINE_MODEL",
        env_base_url="VOLCENGINE_BASE_URL",
        keywords=("volcengine", "doubao", "skylark"),
        detect_by_base_keyword="volces",
        supports_max_completion_tokens=True,
        input_price_per_mtok=0.8,
        output_price_per_mtok=2.0,
    ),

    # ── Cloud: OpenAI ──
    ProviderSpec(
        name="openai",
        display_name="OpenAI",
        default_api_base="https://api.openai.com/v1",
        env_key="OPENAI_API_KEY",
        env_model="OPENAI_MODEL",
        env_base_url="OPENAI_BASE_URL",
        keywords=("gpt", "o1", "o3", "o4"),
        default_model="gpt-4o-mini",
        detect_by_key_prefix="sk-",
        detect_by_base_keyword="openai",
        supports_tool_use=True,
        supports_vision=True,
        supports_streaming=True,
        input_price_per_mtok=2.5,
        output_price_per_mtok=10.0,
    ),

    # ── Cloud: Anthropic ──
    ProviderSpec(
        name="anthropic",
        display_name="Anthropic",
        default_api_base="https://api.anthropic.com/v1",
        provider_type="anthropic",
        env_key="ANTHROPIC_API_KEY",
        env_model="ANTHROPIC_MODEL",
        keywords=("claude", "anthropic"),
        default_model="claude-sonnet-4-20250514",
        supports_tool_use=True,
        supports_vision=True,
        input_price_per_mtok=3.0,
        output_price_per_mtok=15.0,
    ),

    # ── Cloud: OpenRouter (gateway) ──
    ProviderSpec(
        name="openrouter",
        display_name="OpenRouter",
        default_api_base="https://openrouter.ai/api/v1",
        env_key="OPENROUTER_API_KEY",
        keywords=("openrouter",),
        is_gateway=True,
        detect_by_key_prefix="sk-or-",
        detect_by_base_keyword="openrouter",
        supports_tool_use=True,
        supports_vision=True,
    ),

    # ── Cloud: Gemini ──
    ProviderSpec(
        name="gemini",
        display_name="Google Gemini",
        default_api_base="https://generativelanguage.googleapis.com/v1beta",
        provider_type="gemini",
        env_key="GEMINI_API_KEY",
        env_model="GEMINI_MODEL",
        keywords=("gemini",),
        default_model="gemini-2.5-flash",
        supports_tool_use=True,
        supports_vision=True,
        input_price_per_mtok=0.15,
        output_price_per_mtok=0.60,
    ),

    # ── Cloud: Groq ──
    ProviderSpec(
        name="groq",
        display_name="Groq",
        default_api_base="https://api.groq.com/openai/v1",
        env_key="GROQ_API_KEY",
        keywords=("groq",),
        default_model="llama-3.3-70b-versatile",
        supports_tool_use=True,
        input_price_per_mtok=0.59,
        output_price_per_mtok=0.79,
    ),

    # ── Cloud: MiniMax ──
    ProviderSpec(
        name="minimax",
        display_name="MiniMax",
        default_api_base="https://api.minimax.chat/v1",
        env_key="MINIMAX_API_KEY",
        keywords=("minimax",),
        default_model="MiniMax-M2.7",
        detect_by_base_keyword="minimax",
    ),

    # ── Cloud: SiliconFlow ──
    ProviderSpec(
        name="siliconflow",
        display_name="SiliconFlow",
        default_api_base="https://api.siliconflow.cn/v1",
        env_key="SILICONFLOW_API_KEY",
        keywords=("siliconflow",),
        detect_by_base_keyword="siliconflow",
    ),

    # ── Cloud: Moonshot / Kimi ──
    ProviderSpec(
        name="moonshot",
        display_name="Moonshot (Kimi)",
        default_api_base="https://api.moonshot.cn/v1",
        env_key="MOONSHOT_API_KEY",
        keywords=("moonshot", "kimi"),
        default_model="moonshot-v1-8k",
        detect_by_base_keyword="moonshot",
    ),

    # ── Cloud: Zhipu GLM ──
    ProviderSpec(
        name="zhipu",
        display_name="Zhipu (GLM)",
        default_api_base="https://open.bigmodel.cn/api/paas/v4",
        env_key="ZHIPU_API_KEY",
        keywords=("zhipu", "glm", "chatglm"),
        default_model="glm-4-flash",
        detect_by_base_keyword="bigmodel",
    ),

    # ── Cloud: StepFun ──
    ProviderSpec(
        name="stepfun",
        display_name="Step Fun",
        default_api_base="https://api.stepfun.com/v1",
        env_key="STEPFUN_API_KEY",
        keywords=("stepfun", "step"),
        detect_by_base_keyword="stepfun",
    ),
]


# ────────────────────────────────────────────────────────────────────
# ProviderInstance — 运行时 Provider 实例
# ────────────────────────────────────────────────────────────────────

@dataclass
class ProviderInstance:
    """Runtime instance of a provider with resolved configuration."""
    spec: ProviderSpec
    api_key: str = ""
    api_base: str = ""
    model: str = ""
    models: list[str] = field(default_factory=list)
    enabled: bool = True
    priority: int = 100
    weight: float = 1.0
    created_at: str = field(default_factory=_utc_now_iso)
    updated_at: str = field(default_factory=_utc_now_iso)
    note: str = ""
    is_available: bool = False
    last_success_at: float = 0.0
    last_error_at: float = 0.0
    last_error: str = ""
    call_count: int = 0
    error_count: int = 0
    last_latency_ms: float = 0.0
    _recent_calls: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=512))

    # ── Multi-Key Round-Robin ──────────────────────────────────────
    # 借鉴 MoneyPrinterTurbo material.py get_api_key() 设计
    # 如果 env 里提供了逗号分隔的多个 key，则存入此列表并轮询使用
    _api_keys: list[str] = field(default_factory=list)
    _key_index: int = 0

    def parse_multi_keys(self) -> None:
        """
        从 api_key 字段解析多 key（逗号分隔）。
        MPT 原始设计：DEEPSEEK_API_KEY="key1,key2,key3"
        调用 initialize() 后自动执行。
        """
        if not self.api_key:
            self._api_keys = []
            return
        keys = [k.strip() for k in self.api_key.split(",") if k.strip()]
        self._api_keys = keys

    def get_api_key(self) -> str:
        """
        获取当前轮询到的 API Key（线程安全轮询）。
        单 key 时直接返回；多 key 时按调用次序循环轮换。
        """
        if not self._api_keys:
            return self.api_key  # 兜底：返回原始 key
        key = self._api_keys[self._key_index % len(self._api_keys)]
        self._key_index = (self._key_index + 1) % len(self._api_keys)
        return key

    @property
    def multi_key_count(self) -> int:
        """已配置的 key 数量（诊断用）。"""
        return len(self._api_keys) if self._api_keys else (1 if self.api_key else 0)

    @property
    def health_score(self) -> float:
        """0.0 (dead) to 1.0 (healthy). Based on error rate and recency."""
        if self.call_count == 0:
            return 0.5 if self.is_available else 0.0
        error_rate = self.error_count / self.call_count
        base = 1.0 - error_rate
        # Penalize if last error was recent (within 5 min)
        if self.last_error_at and (time.time() - self.last_error_at) < 300:
            base *= 0.5
        return max(0.0, min(1.0, base))

    def _append_recent_call(self, *, success: bool, latency_ms: float = 0.0, error: str = "") -> None:
        self._recent_calls.append(
            {
                "ts": time.time(),
                "success": bool(success),
                "latency_ms": max(0.0, float(latency_ms or 0.0)),
                "error": str(error or "")[:300],
            }
        )

    def record_success(self, latency_ms: float = 0.0) -> None:
        self.call_count += 1
        self.last_success_at = time.time()
        self.last_latency_ms = max(0.0, float(latency_ms or 0.0))
        self._append_recent_call(success=True, latency_ms=latency_ms)

    def record_error(self, error: str, latency_ms: float = 0.0) -> None:
        self.call_count += 1
        self.error_count += 1
        self.last_error_at = time.time()
        self.last_error = error[:300]
        self.last_latency_ms = max(0.0, float(latency_ms or 0.0))
        self._append_recent_call(success=False, latency_ms=latency_ms, error=error)

    @property
    def status(self) -> str:
        if not self.enabled or not self.is_available:
            return "offline"
        if self.health_score >= 0.75 and not self.last_error:
            return "healthy"
        if self.health_score >= 0.45:
            return "degraded"
        return "offline"

    def recent_calls(self, *, within_sec: float | None = None) -> list[dict[str, Any]]:
        items = list(self._recent_calls)
        if within_sec is None:
            return items
        cutoff = time.time() - max(0.0, float(within_sec))
        return [item for item in items if float(item.get("ts", 0.0) or 0.0) >= cutoff]

    def summary_metrics(self) -> dict[str, Any]:
        recent_1h = self.recent_calls(within_sec=3600)
        recent_24h = self.recent_calls(within_sec=24 * 3600)
        success_count = sum(1 for item in recent_1h if bool(item.get("success")))
        latency_values = [float(item.get("latency_ms", 0.0) or 0.0) for item in recent_24h if float(item.get("latency_ms", 0.0) or 0.0) > 0]
        return {
            "success_rate_1h": round((success_count / len(recent_1h)) * 100, 2) if recent_1h else (100.0 if self.last_success_at else 0.0),
            "total_calls_24h": len(recent_24h),
            "avg_latency_ms": round(sum(latency_values) / len(latency_values), 2) if latency_values else round(self.last_latency_ms, 2),
        }

    def to_dict(self) -> dict[str, Any]:
        metrics = self.summary_metrics()
        return {
            "id": self.spec.name,
            "name": self.spec.name,
            "display_name": self.spec.display_name,
            "type": self.spec.provider_type,
            "route": self.spec.route,
            "model": self.model,
            "models": list(self.models or ([self.model] if self.model else [])),
            "api_base": self.api_base,
            "key_configured": bool(self.api_key),
            "api_key_masked": _mask_secret(self.api_key),
            "enabled": self.enabled,
            "priority": self.priority,
            "weight": self.weight,
            "note": self.note,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "is_available": self.is_available,
            "status": self.status,
            "health_score": round(self.health_score, 2),
            "call_count": self.call_count,
            "error_count": self.error_count,
            "last_latency_ms": round(self.last_latency_ms, 2),
            "last_error": self.last_error or None,
            **metrics,
            "supports_tool_use": self.spec.supports_tool_use,
            "supports_vision": self.spec.supports_vision,
            "supports_streaming": self.spec.supports_streaming,
        }


# ────────────────────────────────────────────────────────────────────
# ProviderRegistry — Provider 管理器
# ────────────────────────────────────────────────────────────────────

class ProviderRegistry:
    """
    Registry and router for all LLM providers.

    Usage:
        registry = ProviderRegistry()
        registry.initialize()  # reads env vars, sets up instances

        # Get best provider for a model
        instance = registry.resolve("deepseek-chat")

        # Get provider by name
        instance = registry.get("deepseek")

        # Get all available cloud providers in priority order
        providers = registry.get_cloud_providers()

    Features:
    - Auto-detect providers from env vars
    - Route by model name keywords
    - Route by API key prefix
    - Health tracking per provider
    - Priority ordering (configurable via env)
    """

    def __init__(self, specs: list[ProviderSpec] | None = None) -> None:
        self._base_specs = {s.name: s for s in (specs or PROVIDERS)}
        self._instances: dict[str, ProviderInstance] = {}
        self._cloud_order: list[str] = []
        self._config_path = self._resolve_config_path()
        self._mutation_lock = asyncio.Lock()
        self._initialized = False

    @staticmethod
    def _resolve_config_path() -> Path:
        raw = os.getenv("PROVIDER_REGISTRY_CONFIG_PATH", "").strip()
        if raw:
            path = Path(raw)
            if not path.is_absolute():
                path = (Path(__file__).resolve().parent / path).resolve()
        else:
            path = (Path(__file__).resolve().parent / "config" / "providers.json").resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _normalize_provider_name(self, name: str) -> str:
        normalized = str(name or "").strip().lower()
        if normalized in {"local", "ollama"}:
            return "local_ollama"
        return normalized

    def _default_priority_map(self) -> dict[str, int]:
        order_raw = os.getenv("LLM_CLOUD_PROVIDER_ORDER", "deepseek,dashscope,volcengine,openai")
        order = [self._normalize_provider_name(item) for item in order_raw.split(",") if item.strip()]
        priority_map: dict[str, int] = {}
        next_priority = 10
        for provider_id in order:
            if provider_id not in priority_map:
                priority_map[provider_id] = next_priority
                next_priority += 10
        for spec in self._base_specs.values():
            if spec.route == "local":
                priority_map.setdefault(spec.name, 0)
            else:
                priority_map.setdefault(spec.name, next_priority)
                next_priority += 10
        return priority_map

    def _default_records_from_env(self) -> list[ProviderConfigRecord]:
        priority_map = self._default_priority_map()
        records: list[ProviderConfigRecord] = []
        for spec in self._base_specs.values():
            api_key = os.getenv(spec.env_key, "").strip() if spec.env_key else ""
            if spec.route == "local" and not api_key:
                api_key = "ollama"
            base_url = os.getenv(spec.env_base_url, "").strip() if spec.env_base_url else ""
            if not base_url:
                base_url = spec.default_api_base
            default_model = os.getenv(spec.env_model, "").strip() if spec.env_model else ""
            if not default_model:
                default_model = spec.default_model
            records.append(
                ProviderConfigRecord(
                    id=spec.name,
                    name=spec.display_name,
                    provider_type=spec.provider_type,
                    route=spec.route,
                    base_url=base_url,
                    api_key=api_key,
                    default_model=default_model,
                    models=[default_model] if default_model else [],
                    enabled=bool(api_key) or spec.route == "local",
                    priority=priority_map.get(spec.name, 100),
                    keywords=list(spec.keywords),
                    is_gateway=spec.is_gateway,
                    detect_by_key_prefix=spec.detect_by_key_prefix,
                    detect_by_base_keyword=spec.detect_by_base_keyword,
                    supports_streaming=spec.supports_streaming,
                    supports_tool_use=spec.supports_tool_use,
                    supports_vision=spec.supports_vision,
                    supports_max_completion_tokens=spec.supports_max_completion_tokens,
                    input_price_per_mtok=spec.input_price_per_mtok,
                    output_price_per_mtok=spec.output_price_per_mtok,
                )
            )
        return records

    def _coerce_record(self, payload: dict[str, Any], existing: ProviderConfigRecord | None = None) -> ProviderConfigRecord:
        base = existing or ProviderConfigRecord(
            id=self._normalize_provider_name(str(payload.get("id") or payload.get("provider_id") or "")),
            name=str(payload.get("name") or payload.get("label") or payload.get("display_name") or "").strip(),
            provider_type=str(payload.get("type") or payload.get("provider_type") or "openai_compatible").strip().lower() or "openai_compatible",
            route=str(payload.get("route") or "cloud").strip().lower() or "cloud",
            base_url=str(payload.get("base_url") or payload.get("api_base") or "").strip(),
            api_key=str(payload.get("api_key") or "").strip(),
            default_model=str(payload.get("default_model") or payload.get("model") or "").strip(),
        )
        provider_id = self._normalize_provider_name(str(payload.get("id") or payload.get("provider_id") or base.id))
        if not provider_id:
            raise ValueError("provider_id is required")
        provider_type = str(payload.get("type") or payload.get("provider_type") or base.provider_type or "openai_compatible").strip().lower()
        if provider_type not in {"local", "openai_compatible", "anthropic", "gemini"}:
            provider_type = "openai_compatible"
        route = str(payload.get("route") or base.route or "cloud").strip().lower()
        if route not in {"local", "cloud"}:
            route = "cloud"
        default_model = str(payload.get("default_model") or payload.get("model") or base.default_model or "").strip()
        models_raw = payload.get("models", base.models or ([default_model] if default_model else []))
        models = [str(item).strip() for item in (models_raw if isinstance(models_raw, list) else [models_raw]) if str(item).strip()]
        if default_model and default_model not in models:
            models.insert(0, default_model)
        if not default_model and models:
            default_model = models[0]
        now = _utc_now_iso()
        return ProviderConfigRecord(
            id=provider_id,
            name=str(payload.get("name") or payload.get("label") or payload.get("display_name") or base.name or provider_id).strip(),
            provider_type=provider_type,
            route=route,
            base_url=str(payload.get("base_url") or payload.get("api_base") or base.base_url or "").strip(),
            api_key=str(payload.get("api_key") if payload.get("api_key") is not None else base.api_key).strip(),
            default_model=default_model,
            models=models,
            enabled=bool(payload.get("enabled", base.enabled)),
            priority=max(0, int(payload.get("priority", base.priority))),
            weight=max(0.0, float(payload.get("weight", base.weight))),
            created_at=str(base.created_at or now),
            updated_at=now,
            note=str(payload.get("note") if payload.get("note") is not None else base.note).strip(),
            keywords=[str(item).strip().lower() for item in payload.get("keywords", base.keywords) or [] if str(item).strip()],
            is_gateway=bool(payload.get("is_gateway", base.is_gateway)),
            detect_by_key_prefix=str(payload.get("detect_by_key_prefix", base.detect_by_key_prefix)).strip(),
            detect_by_base_keyword=str(payload.get("detect_by_base_keyword", base.detect_by_base_keyword)).strip(),
            supports_streaming=bool(payload.get("supports_streaming", base.supports_streaming)),
            supports_tool_use=bool(payload.get("supports_tool_use", base.supports_tool_use)),
            supports_vision=bool(payload.get("supports_vision", base.supports_vision)),
            supports_max_completion_tokens=bool(
                payload.get("supports_max_completion_tokens", base.supports_max_completion_tokens)
            ),
            input_price_per_mtok=float(payload.get("input_price_per_mtok", base.input_price_per_mtok) or 0.0),
            output_price_per_mtok=float(payload.get("output_price_per_mtok", base.output_price_per_mtok) or 0.0),
        )

    def _load_records(self) -> list[ProviderConfigRecord]:
        records: list[ProviderConfigRecord] = []
        if self._config_path.exists():
            try:
                payload = json.loads(self._config_path.read_text(encoding="utf-8"))
                for item in payload.get("providers", []):
                    if isinstance(item, dict):
                        normalized = dict(item)
                        if "api_key_ciphertext" in normalized and "api_key" not in normalized:
                            normalized["api_key"] = _decrypt_secret(str(normalized.get("api_key_ciphertext") or ""))
                        records.append(self._coerce_record(normalized))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to load provider config %s: %s", self._config_path, exc)
        if not records:
            records = self._default_records_from_env()
            self._persist_records(records)
        return records

    def _persist_records(self, records: list[ProviderConfigRecord]) -> None:
        payload = {
            "providers": [
                {
                    "id": record.id,
                    "name": record.name,
                    "provider_type": record.provider_type,
                    "route": record.route,
                    "base_url": record.base_url,
                    "api_key_ciphertext": _encrypt_secret(record.api_key),
                    "default_model": record.default_model,
                    "models": list(record.models),
                    "enabled": record.enabled,
                    "priority": record.priority,
                    "weight": record.weight,
                    "created_at": record.created_at,
                    "updated_at": record.updated_at,
                    "note": record.note,
                    "keywords": list(record.keywords),
                    "is_gateway": record.is_gateway,
                    "detect_by_key_prefix": record.detect_by_key_prefix,
                    "detect_by_base_keyword": record.detect_by_base_keyword,
                    "supports_streaming": record.supports_streaming,
                    "supports_tool_use": record.supports_tool_use,
                    "supports_vision": record.supports_vision,
                    "supports_max_completion_tokens": record.supports_max_completion_tokens,
                    "input_price_per_mtok": record.input_price_per_mtok,
                    "output_price_per_mtok": record.output_price_per_mtok,
                }
                for record in sorted(records, key=lambda item: (item.priority, item.id))
            ]
        }
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _build_instance(self, record: ProviderConfigRecord, previous: ProviderInstance | None = None) -> ProviderInstance:
        base_spec = self._base_specs.get(record.id)
        spec = ProviderSpec(
            name=record.id,
            display_name=record.name or (base_spec.display_name if base_spec else record.id),
            default_api_base=record.base_url or (base_spec.default_api_base if base_spec else ""),
            provider_type=record.provider_type or (base_spec.provider_type if base_spec else "openai_compatible"),
            env_key=base_spec.env_key if base_spec else "",
            env_model=base_spec.env_model if base_spec else "",
            env_base_url=base_spec.env_base_url if base_spec else "",
            keywords=tuple(record.keywords or (list(base_spec.keywords) if base_spec else [])),
            route=record.route or (base_spec.route if base_spec else "cloud"),
            is_gateway=record.is_gateway or (base_spec.is_gateway if base_spec else False),
            detect_by_key_prefix=record.detect_by_key_prefix or (base_spec.detect_by_key_prefix if base_spec else ""),
            detect_by_base_keyword=record.detect_by_base_keyword or (base_spec.detect_by_base_keyword if base_spec else ""),
            default_model=record.default_model or (base_spec.default_model if base_spec else ""),
            default_temperature=base_spec.default_temperature if base_spec else 0.3,
            max_retries=base_spec.max_retries if base_spec else 1,
            timeout_sec=base_spec.timeout_sec if base_spec else 25.0,
            supports_streaming=record.supports_streaming if record.supports_streaming is not None else (base_spec.supports_streaming if base_spec else True),
            supports_tool_use=record.supports_tool_use if record.supports_tool_use is not None else (base_spec.supports_tool_use if base_spec else False),
            supports_vision=record.supports_vision if record.supports_vision is not None else (base_spec.supports_vision if base_spec else False),
            supports_max_completion_tokens=(
                record.supports_max_completion_tokens
                if record.supports_max_completion_tokens is not None
                else (base_spec.supports_max_completion_tokens if base_spec else False)
            ),
            model_overrides=base_spec.model_overrides if base_spec else (),
            input_price_per_mtok=record.input_price_per_mtok or (base_spec.input_price_per_mtok if base_spec else 0.0),
            output_price_per_mtok=record.output_price_per_mtok or (base_spec.output_price_per_mtok if base_spec else 0.0),
        )
        instance = ProviderInstance(
            spec=spec,
            api_key=record.api_key,
            api_base=record.base_url or spec.default_api_base,
            model=record.default_model or spec.default_model,
            models=list(record.models or ([record.default_model] if record.default_model else [])),
            enabled=record.enabled,
            priority=record.priority,
            weight=record.weight,
            created_at=record.created_at,
            updated_at=record.updated_at,
            note=record.note,
            is_available=record.enabled and (bool(record.api_key) or spec.route == "local"),
        )
        if instance.spec.route == "local" and not instance.api_key:
            instance.api_key = "ollama"
            instance.is_available = bool(instance.enabled)
        instance.parse_multi_keys()
        if previous is not None:
            instance.last_success_at = previous.last_success_at
            instance.last_error_at = previous.last_error_at
            instance.last_error = previous.last_error
            instance.call_count = previous.call_count
            instance.error_count = previous.error_count
            instance.last_latency_ms = previous.last_latency_ms
            instance._recent_calls = deepcopy(previous._recent_calls)
        return instance

    def _apply_records(self, records: list[ProviderConfigRecord]) -> None:
        previous_instances = self._instances
        new_instances: dict[str, ProviderInstance] = {}
        for record in sorted(records, key=lambda item: (item.priority, item.id)):
            new_instances[record.id] = self._build_instance(record, previous=previous_instances.get(record.id))
        self._instances = new_instances
        self._cloud_order = [
            record.id
            for record in sorted(records, key=lambda item: (item.priority, item.id))
            if record.route == "cloud"
        ]
        self._initialized = True

    def _ensure_initialized(self) -> None:
        if not self._initialized:
            self.initialize()

    def initialize(self) -> None:
        """Initialize providers from persisted JSON or env defaults."""
        self._apply_records(self._load_records())

    def get(self, name: str) -> ProviderInstance | None:
        """Get a provider instance by name."""
        self._ensure_initialized()
        return self._instances.get(self._normalize_provider_name(name))

    def get_provider_config(self, provider_id: str) -> dict[str, Any] | None:
        instance = self.get(provider_id)
        return instance.to_dict() if instance is not None else None

    def list_provider_configs(self) -> list[dict[str, Any]]:
        self._ensure_initialized()
        return [instance.to_dict() for instance in sorted(self._instances.values(), key=lambda item: (item.priority, item.spec.name))]

    def record_provider_success(self, name: str, *, latency_ms: float = 0.0) -> None:
        instance = self.get(name)
        if instance is not None:
            instance.record_success(latency_ms=latency_ms)

    def record_provider_error(self, name: str, error: str, *, latency_ms: float = 0.0) -> None:
        instance = self.get(name)
        if instance is not None:
            instance.record_error(error, latency_ms=latency_ms)

    def provider_health_report(self) -> list[dict[str, Any]]:
        return self.list_provider_configs()

    def router_snapshot(self) -> dict[str, Any]:
        self._ensure_initialized()
        local = self.get_local_provider()
        local_target = {
            "name": "local",
            "provider_id": local.spec.name if local else "local_ollama",
            "route": local.spec.route if local else "local",
            "model": local.model if local else os.getenv("LOCAL_LLM_MODEL", "qwen3:59b").strip(),
            "base_url": local.api_base if local else os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434/v1").strip(),
            "api_key": local.get_api_key() if local else (os.getenv("LOCAL_LLM_API_KEY", "ollama").strip() or "ollama"),
        }
        return {
            "local": local_target,
            "cloud_order": list(self._cloud_order),
            "cloud_targets": {
                instance.spec.name: {
                    "name": instance.spec.name,
                    "route": instance.spec.route,
                    "model": instance.model,
                    "base_url": instance.api_base,
                    "api_key": instance.get_api_key(),
                }
                for instance in self.get_cloud_providers()
            },
        }

    def get_failover_provider(
        self,
        primary_names: list[str] | None = None,
        *,
        max_retries_per_provider: int = 1,
    ) -> FailoverProvider:
        self._ensure_initialized()
        order_raw = os.getenv("PROVIDER_FAILOVER_ORDER", "").strip()
        ordered_names = []
        if order_raw:
            ordered_names.extend([self._normalize_provider_name(item) for item in order_raw.split(",") if item.strip()])
        if primary_names:
            ordered_names.extend([self._normalize_provider_name(item) for item in primary_names if str(item).strip()])
        if not ordered_names:
            ordered_names.extend(self._cloud_order)

        providers: list[ProviderInstance] = []
        seen: set[str] = set()
        for name in ordered_names:
            if name in seen:
                continue
            seen.add(name)
            instance = self._instances.get(name)
            if instance is not None and instance.is_available:
                providers.append(instance)

        if not providers:
            providers = [instance for instance in self.get_cloud_providers()]
        if not providers:
            raise ValueError("No providers available for failover")

        return FailoverProvider(
            providers,
            name_resolver=lambda instance: instance.spec.name,
            max_retries_per_provider=max_retries_per_provider,
        )

    def resolve(self, model_name: str) -> ProviderInstance | None:
        """
        Resolve the best provider for a given model name.

        Resolution order:
        1. Exact provider name match (e.g. "deepseek")
        2. Model name keyword match (e.g. "deepseek-chat" → deepseek provider)
        3. API key prefix detection
        4. First available cloud provider in priority order
        """
        self._ensure_initialized()
        model_lower = str(model_name or "").lower()

        # 1. Direct name match
        if model_lower in self._instances:
            inst = self._instances[model_lower]
            if inst.is_available:
                return inst

        # 2. Keyword match
        for name, inst in self._instances.items():
            if not inst.is_available:
                continue
            for kw in inst.spec.keywords:
                if kw in model_lower:
                    return inst

        # 3. Gateway providers can handle anything
        for name, inst in self._instances.items():
            if inst.is_available and inst.spec.is_gateway:
                return inst

        # 4. Default: first available cloud in priority order
        for provider_name in self._cloud_order:
            inst = self._instances.get(provider_name)
            if inst and inst.is_available:
                return inst

        # 5. Absolute fallback: any available
        for inst in self._instances.values():
            if inst.is_available:
                return inst

        return None

    def get_model_overrides(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Get per-model parameter overrides for a specific model."""
        inst = self.get(provider_name)
        if not inst:
            return {}
        for pattern, overrides in inst.spec.model_overrides:
            if pattern in model_name:
                return dict(overrides)
        return {}

    def get_cloud_providers(self) -> list[ProviderInstance]:
        """Get available cloud providers in priority order."""
        self._ensure_initialized()
        result: list[ProviderInstance] = []
        seen: set[str] = set()

        # Priority order first
        for name in self._cloud_order:
            inst = self._instances.get(name)
            if inst and inst.enabled and inst.is_available and inst.spec.route == "cloud":
                result.append(inst)
                seen.add(name)

        # Then remaining cloud providers
        for name, inst in self._instances.items():
            if name not in seen and inst.enabled and inst.is_available and inst.spec.route == "cloud":
                result.append(inst)

        return result

    def get_local_provider(self) -> ProviderInstance | None:
        """Get the local provider instance."""
        self._ensure_initialized()
        for inst in self._instances.values():
            if inst.enabled and inst.spec.route == "local" and inst.is_available:
                return inst
        return None

    def list_all(self) -> list[dict[str, Any]]:
        """List all providers with their status."""
        return self.list_provider_configs()

    def get_provider_metrics(self, provider_id: str) -> dict[str, Any]:
        instance = self.get(provider_id)
        if instance is None:
            raise KeyError(provider_id)
        recent_24h = instance.recent_calls(within_sec=24 * 3600)
        buckets: dict[str, dict[str, Any]] = {}
        for item in recent_24h:
            ts = float(item.get("ts", 0.0) or 0.0)
            bucket = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:00")
            entry = buckets.setdefault(bucket, {"hour": bucket, "count": 0, "success": 0})
            entry["count"] += 1
            if bool(item.get("success")):
                entry["success"] += 1
        metrics = instance.summary_metrics()
        total_calls = len(recent_24h)
        error_calls = sum(1 for item in recent_24h if not bool(item.get("success")))
        return {
            "id": instance.spec.name,
            "status": instance.status,
            "avg_latency_ms": metrics["avg_latency_ms"],
            "success_rate_1h": metrics["success_rate_1h"],
            "total_calls_24h": metrics["total_calls_24h"],
            "error_rate": round((error_calls / total_calls), 4) if total_calls else 0.0,
            "calls_by_hour": [buckets[key] for key in sorted(buckets.keys())],
        }

    async def health_check(self, provider_id: str) -> bool:
        instance = self.get(provider_id)
        if instance is None or not instance.enabled:
            return False
        headers: dict[str, str] = {}
        api_key = instance.get_api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        base_url = str(instance.api_base or "").rstrip("/")
        candidates = [base_url] if base_url else []
        if base_url.endswith("/v1"):
            candidates.append(f"{base_url}/models")
        elif base_url:
            candidates.append(f"{base_url}/v1/models")
        timeout = httpx.Timeout(8.0, connect=5.0)
        started_at = time.perf_counter()
        last_error = ""
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            for url in candidates:
                try:
                    response = await client.get(url, headers=headers)
                    latency_ms = (time.perf_counter() - started_at) * 1000.0
                    if response.status_code in {200, 400, 401, 403, 404, 405}:
                        self.record_provider_success(provider_id, latency_ms=latency_ms)
                        return True
                    last_error = f"status={response.status_code}"
                except Exception as exc:  # noqa: BLE001
                    last_error = str(exc)
        self.record_provider_error(provider_id, last_error or "health_check_failed", latency_ms=(time.perf_counter() - started_at) * 1000.0)
        return False

    async def smoke_provider(self, provider_id: str, prompt: str = "请回复 ok") -> dict[str, Any]:
        instance = self.get(provider_id)
        if instance is None:
            raise KeyError(provider_id)
        if not instance.enabled:
            raise ValueError(f"provider {provider_id} is disabled")
        from langchain_core.messages import HumanMessage, SystemMessage
        from llm_factory import llm_factory

        started_at = time.perf_counter()
        try:
            build = llm_factory.build(
                target_name=instance.spec.name,
                model=instance.model,
                base_url=instance.api_base,
                api_key=instance.get_api_key(),
                temperature=instance.spec.default_temperature,
                timeout=instance.spec.timeout_sec,
                max_retries=max(1, int(instance.spec.max_retries)),
                route_if_success=instance.spec.route,
            )
            response = await build.model.ainvoke(
                [
                    SystemMessage(content="你是 Provider 连通性测试助手，仅返回一句自然语言。"),
                    HumanMessage(content=prompt),
                ]
            )
            latency_ms = (time.perf_counter() - started_at) * 1000.0
            self.record_provider_success(provider_id, latency_ms=latency_ms)
            return {
                "ok": True,
                "provider_id": instance.spec.name,
                "status": instance.status,
                "response": str(response.content)[:1000],
                "latency_ms": round(latency_ms, 2),
            }
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - started_at) * 1000.0
            self.record_provider_error(provider_id, str(exc), latency_ms=latency_ms)
            return {
                "ok": False,
                "provider_id": instance.spec.name,
                "status": instance.status,
                "error": str(exc),
                "latency_ms": round(latency_ms, 2),
            }

    async def add_provider(self, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._mutation_lock:
            records = self._load_records()
            provider_id = self._normalize_provider_name(str(payload.get("id") or payload.get("provider_id") or ""))
            if not provider_id:
                raise ValueError("provider_id is required")
            if any(record.id == provider_id for record in records):
                raise ValueError(f"provider {provider_id} already exists")
            record = self._coerce_record({**payload, "id": provider_id})
            records.append(record)
            self._persist_records(records)
            self._apply_records(records)
            return self.get_provider_config(provider_id) or record.to_public_dict()

    async def update_provider(self, provider_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        async with self._mutation_lock:
            target_id = self._normalize_provider_name(provider_id)
            records = self._load_records()
            updated_records: list[ProviderConfigRecord] = []
            matched = False
            for record in records:
                if record.id != target_id:
                    updated_records.append(record)
                    continue
                updated_records.append(self._coerce_record({**record.__dict__, **updates, "id": target_id}, existing=record))
                matched = True
            if not matched:
                raise KeyError(target_id)
            self._persist_records(updated_records)
            self._apply_records(updated_records)
            return self.get_provider_config(target_id) or {}

    async def remove_provider(self, provider_id: str) -> bool:
        async with self._mutation_lock:
            target_id = self._normalize_provider_name(provider_id)
            records = self._load_records()
            filtered = [record for record in records if record.id != target_id]
            if len(filtered) == len(records):
                return False
            self._persist_records(filtered)
            self._apply_records(filtered)
            return True

    async def reload_provider(self, provider_id: str) -> bool:
        async with self._mutation_lock:
            target_id = self._normalize_provider_name(provider_id)
            records = self._load_records()
            exists = any(record.id == target_id for record in records)
            self._apply_records(records)
            return exists

    def describe(self) -> dict[str, Any]:
        """Return registry status for diagnostics."""
        self._ensure_initialized()
        available = [n for n, i in self._instances.items() if i.enabled and i.is_available]
        cloud = [n for n, i in self._instances.items() if i.enabled and i.is_available and i.spec.route == "cloud"]
        local = [n for n, i in self._instances.items() if i.enabled and i.is_available and i.spec.route == "local"]
        return {
            "total_providers": len(self._instances),
            "available": available,
            "cloud_providers": cloud,
            "local_providers": local,
            "cloud_order": self._cloud_order,
            "providers": self.list_all(),
        }


# ────────────────────────────────────────────────────────────────────
# Singleton
# ────────────────────────────────────────────────────────────────────

_registry: ProviderRegistry | None = None


def get_provider_registry() -> ProviderRegistry:
    """Get or create the global provider registry singleton."""
    global _registry
    if _registry is None:
        _registry = ProviderRegistry()
        _registry.initialize()
    return _registry


def provider_health_report() -> list[dict[str, Any]]:
    return get_provider_registry().provider_health_report()


async def reload_provider(provider_id: str) -> bool:
    return await get_provider_registry().reload_provider(provider_id)


# ────────────────────────────────────────────────────────────────────
# LLM 调用日志 — 积累训练数据（借鉴 OpenClaw-RL 对话轨迹收集）
# ────────────────────────────────────────────────────────────────────

_LLM_LOG_DB_PATH = os.getenv("LLM_LOG_DB", "data/llm_call_log.sqlite")
_LLM_LOG_BUFFER: deque[dict[str, Any]] = deque(maxlen=500)
_LLM_LOG_LOCK = Lock()
_LLM_LOG_FLUSH_TASK: asyncio.Task | None = None


def _ensure_llm_log_schema() -> None:
    """Create the LLM call log table if not exists."""
    Path(_LLM_LOG_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_LLM_LOG_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS llm_call_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id TEXT NOT NULL UNIQUE,
            timestamp TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            model TEXT NOT NULL,
            lobster_id TEXT,
            task_id TEXT,
            tenant_id TEXT,
            system_prompt_hash TEXT,
            system_prompt_len INTEGER DEFAULT 0,
            user_message_preview TEXT,
            user_message_len INTEGER DEFAULT 0,
            messages_count INTEGER DEFAULT 0,
            total_input_chars INTEGER DEFAULT 0,
            temperature REAL,
            max_tokens INTEGER,
            tools_count INTEGER DEFAULT 0,
            output_preview TEXT,
            output_len INTEGER DEFAULT 0,
            finish_reason TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            latency_ms REAL DEFAULT 0,
            estimated_cost_cny REAL DEFAULT 0,
            call_type TEXT DEFAULT 'main_line',
            outcome_score REAL,
            outcome_label TEXT,
            outcome_detail TEXT,
            status TEXT DEFAULT 'success',
            error_message TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_lobster ON llm_call_log(lobster_id, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_provider ON llm_call_log(provider_name, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_type ON llm_call_log(call_type, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_tenant ON llm_call_log(tenant_id, timestamp)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS smart_routing_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id TEXT NOT NULL UNIQUE,
            timestamp TEXT NOT NULL,
            tenant_id TEXT,
            user_id TEXT,
            task_type TEXT,
            tier TEXT NOT NULL,
            model TEXT NOT NULL,
            provider_name TEXT,
            route TEXT,
            method TEXT NOT NULL,
            score INTEGER DEFAULT -1,
            pattern TEXT,
            input_len INTEGER DEFAULT 0,
            dim_scores_json TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_smart_routing_tenant ON smart_routing_log(tenant_id, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_smart_routing_tier ON smart_routing_log(tier, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_smart_routing_method ON smart_routing_log(method, timestamp)")
    conn.commit()
    conn.close()


def log_llm_call(
    *,
    provider_name: str,
    model: str,
    messages: list[dict[str, Any]] | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    tools: list | None = None,
    output: str | None = None,
    finish_reason: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: float = 0,
    lobster_id: str | None = None,
    task_id: str | None = None,
    tenant_id: str | None = None,
    call_type: str = "main_line",
    status: str = "success",
    error_message: str | None = None,
    input_price_per_mtok: float = 0.0,
    output_price_per_mtok: float = 0.0,
) -> str:
    """
    Record an LLM call to the async buffer. Returns call_id.

    call_type should be one of:
      - main_line
      - side_system
      - side_rag
      - side_tool
      - side_routing
    """
    call_id = str(uuid.uuid4())

    system_prompt_hash = None
    system_prompt_len = 0
    user_message_preview = None
    user_message_len = 0
    messages_count = 0
    total_input_chars = 0

    if messages:
        messages_count = len(messages)
        for msg in messages:
            content = msg.get("content", "")
            if not isinstance(content, str):
                continue
            total_input_chars += len(content)
            if msg.get("role") == "system":
                system_prompt_len = len(content)
                system_prompt_hash = str(hash(content))
            elif msg.get("role") == "user":
                user_message_len = len(content)
                user_message_preview = content[:200]

    total_tokens = input_tokens + output_tokens
    estimated_cost = (
        (input_tokens / 1_000_000) * input_price_per_mtok
        + (output_tokens / 1_000_000) * output_price_per_mtok
    )

    record = {
        "call_id": call_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider_name": provider_name,
        "model": model,
        "lobster_id": lobster_id,
        "task_id": task_id,
        "tenant_id": tenant_id,
        "system_prompt_hash": system_prompt_hash,
        "system_prompt_len": system_prompt_len,
        "user_message_preview": user_message_preview,
        "user_message_len": user_message_len,
        "messages_count": messages_count,
        "total_input_chars": total_input_chars,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "tools_count": len(tools) if tools else 0,
        "output_preview": (output[:300] if output else None),
        "output_len": len(output) if output else 0,
        "finish_reason": finish_reason,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "latency_ms": latency_ms,
        "estimated_cost_cny": round(estimated_cost, 6),
        "call_type": call_type,
        "outcome_score": None,
        "outcome_label": None,
        "outcome_detail": None,
        "status": status,
        "error_message": error_message[:500] if error_message else None,
    }

    with _LLM_LOG_LOCK:
        _LLM_LOG_BUFFER.append(record)

    return call_id


def update_llm_call_outcome(
    call_id: str,
    *,
    outcome_score: float | None = None,
    outcome_label: str | None = None,
    outcome_detail: str | None = None,
) -> None:
    """Update the outcome of a previously logged LLM call."""
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        conn.execute(
            """
            UPDATE llm_call_log
            SET outcome_score = ?, outcome_label = ?, outcome_detail = ?
            WHERE call_id = ?
            """,
            (outcome_score, outcome_label, outcome_detail, call_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to update LLM call outcome %s: %s", call_id, e)


def _flush_llm_log_buffer() -> int:
    """Flush buffered log entries to SQLite. Returns count flushed."""
    with _LLM_LOG_LOCK:
        if not _LLM_LOG_BUFFER:
            return 0
        batch = list(_LLM_LOG_BUFFER)
        _LLM_LOG_BUFFER.clear()

    if not batch:
        return 0

    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        columns = list(batch[0].keys())
        placeholders = ", ".join(["?"] * len(columns))
        col_names = ", ".join(columns)
        conn.executemany(
            f"INSERT OR IGNORE INTO llm_call_log ({col_names}) VALUES ({placeholders})",
            [tuple(record.get(c) for c in columns) for record in batch],
        )
        conn.commit()
        conn.close()
        return len(batch)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to flush LLM log buffer: %s", e)
        return 0


async def _llm_log_flush_loop() -> None:
    """Background loop that flushes the LLM log buffer every 10 seconds."""
    while True:
        await asyncio.sleep(10)
        count = _flush_llm_log_buffer()
        if count > 0:
            logger.debug("Flushed %d LLM call logs to SQLite", count)


def start_llm_log_flusher() -> None:
    """Start the background LLM log flush loop (call once at app startup)."""
    global _LLM_LOG_FLUSH_TASK
    if _LLM_LOG_FLUSH_TASK is None or _LLM_LOG_FLUSH_TASK.done():
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()
        _LLM_LOG_FLUSH_TASK = loop.create_task(_llm_log_flush_loop())


def stop_llm_log_flusher() -> None:
    """Stop the background flush loop."""
    global _LLM_LOG_FLUSH_TASK
    if _LLM_LOG_FLUSH_TASK and not _LLM_LOG_FLUSH_TASK.done():
        _LLM_LOG_FLUSH_TASK.cancel()
        _LLM_LOG_FLUSH_TASK = None
    _flush_llm_log_buffer()


def llm_log_stats() -> dict[str, Any]:
    """Return summary stats from the LLM call log for diagnostics."""
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM llm_call_log")
        total = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE call_type = 'main_line'")
        main_line = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE outcome_score IS NOT NULL")
        with_outcome = cur.fetchone()[0]

        cur.execute("SELECT SUM(total_tokens), SUM(estimated_cost_cny) FROM llm_call_log")
        row = cur.fetchone()
        total_tokens = row[0] or 0
        total_cost = row[1] or 0.0

        cur.execute(
            """
            SELECT lobster_id, COUNT(*), SUM(total_tokens)
            FROM llm_call_log
            WHERE lobster_id IS NOT NULL
            GROUP BY lobster_id
            ORDER BY COUNT(*) DESC
            """
        )
        by_lobster = [
            {"lobster_id": r[0], "call_count": r[1], "total_tokens": r[2] or 0}
            for r in cur.fetchall()
        ]

        conn.close()
        return {
            "total_calls": total,
            "main_line_calls": main_line,
            "side_calls": total - main_line,
            "with_outcome": with_outcome,
            "trainable_ratio": round(with_outcome / total, 3) if total > 0 else 0,
            "total_tokens": total_tokens,
            "total_cost_cny": round(total_cost, 4),
            "by_lobster": by_lobster,
            "buffer_size": len(_LLM_LOG_BUFFER),
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def log_smart_routing_decision(
    *,
    tenant_id: str | None,
    user_id: str | None,
    task_type: str | None,
    tier: str,
    model: str,
    provider_name: str | None,
    route: str | None,
    method: str,
    score: int,
    pattern: str | None = None,
    input_len: int = 0,
    dim_scores: dict[str, Any] | None = None,
) -> str:
    """Persist a smart-routing decision for later cost / quality analysis."""
    route_id = str(uuid.uuid4())
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        conn.execute(
            """
            INSERT INTO smart_routing_log (
                route_id, timestamp, tenant_id, user_id, task_type, tier, model,
                provider_name, route, method, score, pattern, input_len, dim_scores_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                route_id,
                datetime.now(timezone.utc).isoformat(),
                str(tenant_id or "").strip() or None,
                str(user_id or "").strip() or None,
                str(task_type or "").strip() or None,
                str(tier or "").strip(),
                str(model or "").strip(),
                str(provider_name or "").strip() or None,
                str(route or "").strip() or None,
                str(method or "").strip(),
                int(score),
                str(pattern or "").strip() or None,
                max(0, int(input_len)),
                json.dumps(dim_scores or {}, ensure_ascii=False),
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to persist smart routing decision: %s", e)
    return route_id


def smart_routing_stats() -> dict[str, Any]:
    """Return aggregate stats for smart-routing decisions."""
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM smart_routing_log")
        total = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            SELECT tier, COUNT(*)
            FROM smart_routing_log
            GROUP BY tier
            """
        )
        by_tier = {str(row[0]): int(row[1]) for row in cur.fetchall()}

        cur.execute(
            """
            SELECT method, COUNT(*)
            FROM smart_routing_log
            GROUP BY method
            """
        )
        by_method = {str(row[0]): int(row[1]) for row in cur.fetchall()}

        cur.execute(
            """
            SELECT route, COUNT(*)
            FROM smart_routing_log
            GROUP BY route
            """
        )
        by_route = {str(row[0]): int(row[1]) for row in cur.fetchall() if row[0] is not None}

        cur.execute(
            """
            SELECT timestamp, tier, model, provider_name, route, method, score
            FROM smart_routing_log
            ORDER BY id DESC
            LIMIT 1
            """
        )
        last = cur.fetchone()
        conn.close()
        return {
            "total": total,
            "by_tier": by_tier,
            "by_method": by_method,
            "by_route": by_route,
            "last": (
                {
                    "timestamp": last[0],
                    "tier": last[1],
                    "model": last[2],
                    "provider_name": last[3],
                    "route": last[4],
                    "method": last[5],
                    "score": last[6],
                }
                if last
                else None
            ),
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
