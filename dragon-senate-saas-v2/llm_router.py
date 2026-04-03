from __future__ import annotations

import os
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from typing import Callable
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from clawrouter_gateway import clawrouter_gateway
from clawwork_economy import can_use_cloud
from clawwork_economy import ensure_schema as ensure_clawwork_schema
from clawwork_economy import settle_usage
from clawwork_economy import status as clawwork_status
from failover_provider import FailoverProvider
from langfuse_tracer import LangfuseTracer
from llm_factory import llm_factory
from provider_registry import get_provider_registry
from provider_registry import log_smart_routing_decision, smart_routing_stats
from smart_routing import choose_model_for_provider, normalize_tier, route_model


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass
class RouteMeta:
    critical: bool = False
    est_tokens: int = 0
    tenant_tier: str = "basic"
    user_id: str = "anonymous"
    tenant_id: str = "tenant_main"
    task_type: str = "general"
    force_tier: str | None = None
    trace_id: str = ""
    span_id: str = ""


@dataclass
class LLMTarget:
    name: str
    route: str  # local | cloud
    model: str
    base_url: str
    api_key: str


class LLMRouter:
    """
    Local-first LLM router.
    - Primary local route: local OpenAI-compatible endpoint (Ollama/vLLM or compatible gateway)
    - Cloud route supports multiple OpenAI-compatible vendors:
      dashscope / deepseek / volcengine
    - Construction fallback chain is handled by llm_factory:
      ChatOpenAI -> ChatOllama
    """

    def __init__(self) -> None:
        self.local_target = LLMTarget(
            name="local",
            route="local",
            model=os.getenv("LOCAL_LLM_MODEL", "qwen3:59b").strip(),
            base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434/v1").strip(),
            api_key=(os.getenv("LOCAL_LLM_API_KEY", "ollama").strip() or "ollama"),
        )

        self.cloud_targets: dict[str, LLMTarget] = {
            "openai": LLMTarget(
                name="openai",
                route="cloud",
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
                base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip(),
                api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            ),
            "dashscope": LLMTarget(
                name="dashscope",
                route="cloud",
                model=os.getenv("CLOUD_LLM_MODEL", "qwen-flash").strip(),
                base_url=os.getenv(
                    "CLOUD_LLM_BASE_URL",
                    "https://dashscope.aliyuncs.com/compatible-mode/v1",
                ).strip(),
                api_key=os.getenv("DASHSCOPE_API_KEY", "").strip(),
            ),
            "deepseek": LLMTarget(
                name="deepseek",
                route="cloud",
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip(),
                base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip(),
                api_key=os.getenv("DEEPSEEK_API_KEY", "").strip(),
            ),
            "volcengine": LLMTarget(
                name="volcengine",
                route="cloud",
                model=os.getenv("VOLCENGINE_MODEL", "").strip(),
                base_url=os.getenv("VOLCENGINE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").strip(),
                api_key=os.getenv("VOLCENGINE_API_KEY", "").strip(),
            ),
        }
        self.cloud_vendor = os.getenv("CLOUD_LLM_VENDOR", "openai").strip().lower()
        self.cloud_provider_order = self._parse_provider_order(
            os.getenv("LLM_CLOUD_PROVIDER_ORDER", "openai,deepseek,dashscope,volcengine")
        )

        self.temperature = float(os.getenv("LLM_TEMPERATURE", "0.3"))
        self.max_retries = int(os.getenv("LLM_MAX_RETRIES", "1"))
        self.request_timeout = float(os.getenv("LLM_REQUEST_TIMEOUT_SEC", "25"))
        self.force_local = _env_bool("LLM_FORCE_LOCAL", False)
        self.enable_cloud_fallback = _env_bool("LLM_ENABLE_CLOUD_FALLBACK", True)
        self.cloud_input_price_per_mtok = float(os.getenv("CLOUD_INPUT_PRICE_PER_MTOK", "0"))
        self.cloud_output_price_per_mtok = float(os.getenv("CLOUD_OUTPUT_PRICE_PER_MTOK", "0"))
        self.economy_enabled = _env_bool("CLAWWORK_ECONOMY_ENABLED", False)
        if self.economy_enabled:
            try:
                ensure_clawwork_schema()
            except Exception:  # noqa: BLE001
                self.economy_enabled = False

        self._metrics_lock = threading.Lock()
        self._metrics: dict[str, Any] = self._new_metrics()
        self._binding_resolver: Callable[[str, str], dict[str, Any] | None] | None = None

    def set_model_binding_resolver(
        self,
        resolver: Callable[[str, str], dict[str, Any] | None] | None,
    ) -> None:
        self._binding_resolver = resolver

    @staticmethod
    def _parse_provider_order(raw: str) -> list[str]:
        items = [x.strip().lower() for x in raw.split(",") if x.strip()]
        dedup: list[str] = []
        seen: set[str] = set()
        for item in items:
            if item in seen:
                continue
            seen.add(item)
            dedup.append(item)
        return dedup or ["openai", "deepseek", "dashscope", "volcengine"]

    @staticmethod
    def _new_metrics() -> dict[str, Any]:
        return {
            "calls_total": 0,
            "calls_primary_local": 0,
            "calls_primary_cloud": 0,
            "calls_success_local": 0,
            "calls_success_cloud": 0,
            "fallback_invoked": 0,
            "fallback_local_to_cloud": 0,
            "fallback_cloud_to_local": 0,
            "calls_failed_total": 0,
            "prompt_tokens_local": 0,
            "completion_tokens_local": 0,
            "prompt_tokens_cloud": 0,
            "completion_tokens_cloud": 0,
            "route_decision_local": 0,
            "route_decision_cloud": 0,
            "route_decision_remote": 0,
            "route_decision_fallback": 0,
            "budget_forced_local": 0,
            "economy_settled": 0,
            "smart_routing_total": 0,
            "smart_routing_forced": 0,
            "smart_routing_pattern_override": 0,
            "smart_routing_complexity_score": 0,
            "smart_routing_tier_flash": 0,
            "smart_routing_tier_standard": 0,
            "smart_routing_tier_pro": 0,
            "smart_routing_tier_frontier": 0,
            "last_smart_routing": None,
            "backend_usage": {},
            "last_error": None,
        }

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text) / 4))

    def _extract_usage_tokens(self, response: Any, prompt_text: str, completion_text: str) -> tuple[int, int]:
        usage = getattr(response, "usage_metadata", None)
        if not isinstance(usage, dict):
            usage = {}
        response_meta = getattr(response, "response_metadata", None)
        if isinstance(response_meta, dict) and isinstance(response_meta.get("token_usage"), dict):
            usage = {**response_meta.get("token_usage", {}), **usage}
        prompt_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or self._estimate_tokens(prompt_text))
        completion_tokens = int(
            usage.get("output_tokens") or usage.get("completion_tokens") or self._estimate_tokens(completion_text)
        )
        return max(1, prompt_tokens), max(1, completion_tokens)

    def _record_success(self, route: str, backend: str, prompt_tokens: int, completion_tokens: int) -> None:
        route_norm = route if route in {"local", "cloud"} else "local"
        with self._metrics_lock:
            key_calls = f"calls_success_{route_norm}"
            key_prompt = f"prompt_tokens_{route_norm}"
            key_completion = f"completion_tokens_{route_norm}"
            self._metrics[key_calls] = int(self._metrics.get(key_calls, 0)) + 1
            self._metrics[key_prompt] = int(self._metrics.get(key_prompt, 0)) + int(prompt_tokens)
            self._metrics[key_completion] = int(self._metrics.get(key_completion, 0)) + int(completion_tokens)
            usage = self._metrics.get("backend_usage", {})
            usage[str(backend)] = int(usage.get(str(backend), 0)) + 1
            self._metrics["backend_usage"] = usage

    def _record_error(self, error: Exception) -> None:
        with self._metrics_lock:
            self._metrics["last_error"] = str(error)[:300]

    def snapshot_metrics(self, *, reset: bool = False) -> dict[str, Any]:
        with self._metrics_lock:
            base = deepcopy(self._metrics)
            if reset:
                self._metrics = self._new_metrics()

        cloud_input_tokens = int(base.get("prompt_tokens_cloud", 0) or 0)
        cloud_output_tokens = int(base.get("completion_tokens_cloud", 0) or 0)
        estimated_cloud_cost_cny = (
            (cloud_input_tokens / 1_000_000) * self.cloud_input_price_per_mtok
            + (cloud_output_tokens / 1_000_000) * self.cloud_output_price_per_mtok
        )
        base["pricing"] = {
            "cloud_input_price_per_mtok": self.cloud_input_price_per_mtok,
            "cloud_output_price_per_mtok": self.cloud_output_price_per_mtok,
            "estimated_cloud_cost_cny": round(estimated_cloud_cost_cny, 6),
        }
        return base

    def _refresh_targets_from_registry(self) -> None:
        try:
            snapshot = get_provider_registry().router_snapshot()
        except Exception as exc:  # noqa: BLE001
            self._record_error(exc)
            return

        local_data = snapshot.get("local", {}) if isinstance(snapshot, dict) else {}
        if isinstance(local_data, dict):
            self.local_target = LLMTarget(
                name=str(local_data.get("name") or "local").strip() or "local",
                route=str(local_data.get("route") or "local").strip() or "local",
                model=str(local_data.get("model") or self.local_target.model).strip() or self.local_target.model,
                base_url=str(local_data.get("base_url") or self.local_target.base_url).strip() or self.local_target.base_url,
                api_key=str(local_data.get("api_key") or self.local_target.api_key).strip() or self.local_target.api_key,
            )

        cloud_targets_raw = snapshot.get("cloud_targets", {}) if isinstance(snapshot, dict) else {}
        if isinstance(cloud_targets_raw, dict):
            self.cloud_targets = {
                str(provider_id).strip(): LLMTarget(
                    name=str(target.get("name") or provider_id).strip() or str(provider_id).strip(),
                    route=str(target.get("route") or "cloud").strip() or "cloud",
                    model=str(target.get("model") or "").strip(),
                    base_url=str(target.get("base_url") or "").strip(),
                    api_key=str(target.get("api_key") or "").strip(),
                )
                for provider_id, target in cloud_targets_raw.items()
                if isinstance(target, dict)
            }

        order = snapshot.get("cloud_order", []) if isinstance(snapshot, dict) else []
        if isinstance(order, list):
            parsed_order = self._parse_provider_order(",".join(str(item) for item in order))
            if parsed_order:
                self.cloud_provider_order = parsed_order
                if self.cloud_vendor not in self.cloud_targets and parsed_order:
                    self.cloud_vendor = parsed_order[0]

    def _ordered_cloud_targets(self) -> list[LLMTarget]:
        self._refresh_targets_from_registry()
        ordered: list[str] = []
        if self.cloud_vendor:
            ordered.append(self.cloud_vendor)
        for provider in self.cloud_provider_order:
            if provider not in ordered:
                ordered.append(provider)
        out: list[LLMTarget] = []
        for provider in ordered:
            target = self.cloud_targets.get(provider)
            if target is not None:
                out.append(target)
        return out

    def _pick_cloud_target(self) -> LLMTarget:
        ordered = self._ordered_cloud_targets()
        if not ordered:
            return self.local_target
        # Prefer configured key first.
        for target in ordered:
            if target.api_key:
                return target
        return ordered[0]

    @staticmethod
    def _registry_name_for_target(target: LLMTarget) -> str:
        if target.name in {"local", "ollama"}:
            return "local_ollama"
        return target.name

    def _ordered_failover_cloud_targets(self, primary_target: LLMTarget) -> list[LLMTarget]:
        ordered: list[LLMTarget] = []
        seen: set[str] = set()
        for target in [primary_target, *self._ordered_cloud_targets()]:
            if target.name in seen:
                continue
            seen.add(target.name)
            ordered.append(target)
        return ordered

    def _resolve_target_model_override(
        self,
        *,
        target: LLMTarget,
        explicit_model_override: str | None,
        smart_decision: Any,
        default_override: str | None = None,
    ) -> str | None:
        if explicit_model_override:
            return explicit_model_override
        if default_override:
            return default_override
        if smart_decision is None:
            return None
        return choose_model_for_provider(
            target.name,
            smart_decision.tier,
            target.model,
        )

    async def _invoke_target(
        self,
        *,
        target: LLMTarget,
        messages: list[Any],
        prompt_text: str,
        temperature: float | None,
        model_override: str | None,
    ) -> dict[str, Any]:
        registry = get_provider_registry()
        started_at = time.perf_counter()
        try:
            build = llm_factory.build(
                target_name=target.name,
                model=target.model,
                base_url=target.base_url,
                api_key=target.api_key,
                temperature=self.temperature if temperature is None else temperature,
                timeout=self.request_timeout,
                max_retries=self.max_retries,
                route_if_success=target.route,
                model_override=model_override,
            )
            response = await build.model.ainvoke(messages)
            content = str(response.content)
            prompt_tokens, completion_tokens = self._extract_usage_tokens(response, prompt_text, content)
            latency_ms = (time.perf_counter() - started_at) * 1000.0
            registry.record_provider_success(self._registry_name_for_target(target), latency_ms=latency_ms)
            return {
                "content": content,
                "build": build,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "provider_name": target.name,
                "latency_ms": int(latency_ms),
                "model_used": str(model_override or target.model),
            }
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - started_at) * 1000.0
            registry.record_provider_error(self._registry_name_for_target(target), str(exc), latency_ms=latency_ms)
            raise

    def should_use_cloud_first(self, meta: RouteMeta | None) -> bool:
        if self.force_local:
            return False
        if meta is None:
            return False
        if meta.critical:
            return True
        if meta.est_tokens > 6000:
            return True
        if (meta.tenant_tier or "").lower() in {"pro", "enterprise", "vip"}:
            return True
        return False

    async def routed_ainvoke_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        meta: RouteMeta | None = None,
        temperature: float | None = None,
        model_override: str | None = None,
        force_tier: Any | None = None,
    ) -> str:
        self._refresh_targets_from_registry()
        task_type = str(meta.task_type) if meta else "general"
        tenant_id = str(meta.tenant_id) if meta else "tenant_main"
        user_id = str(meta.user_id) if meta else "anonymous"
        explicit_model_override = str(model_override or "").strip() or None
        requested_tier = normalize_tier(force_tier or (meta.force_tier if meta else None))
        binding_override: dict[str, Any] | None = None
        hybrid_target_payload: dict[str, Any] | None = None
        try:
            from vllm_provider import get_hybrid_llm_router

            hybrid_target_payload = await get_hybrid_llm_router().pick_target(
                lobster_name=task_type,
                task_type=task_type,
                quality_required="premium" if (meta.critical if meta else False) else "standard",
            )
        except Exception:
            hybrid_target_payload = None
        if self._binding_resolver is not None:
            try:
                binding_override = self._binding_resolver(tenant_id, task_type)
            except Exception as resolver_error:  # noqa: BLE001
                self._record_error(resolver_error)

        local_model_override: str | None = None
        cloud_model_override: str | None = None
        bound_target: LLMTarget | None = None
        smart_decision = None

        if explicit_model_override is None:
            smart_decision = route_model(
                user_prompt,
                force_tier=requested_tier,
            )

        if binding_override:
            route = str(binding_override.get("route") or "cloud").strip().lower()
            if route not in {"local", "cloud"}:
                route = "cloud"
            bound_target = LLMTarget(
                name=str(binding_override.get("provider_id") or "binding").strip() or "binding",
                route=route,
                model=str(binding_override.get("model_name") or "").strip(),
                base_url=str(binding_override.get("base_url") or "").strip(),
                api_key=str(binding_override.get("api_key") or "").strip(),
            )
            prefer_cloud = bound_target.route == "cloud"
            if explicit_model_override:
                if prefer_cloud:
                    cloud_model_override = explicit_model_override
                else:
                    local_model_override = explicit_model_override
            with self._metrics_lock:
                if prefer_cloud:
                    self._metrics["route_decision_cloud"] += 1
                else:
                    self._metrics["route_decision_local"] += 1
        elif hybrid_target_payload:
            bound_target = LLMTarget(
                name=str(hybrid_target_payload.get("provider_name") or "vllm_self_hosted"),
                route=str(hybrid_target_payload.get("route") or "local"),
                model=str(hybrid_target_payload.get("model") or "Qwen/Qwen3-72B-Instruct"),
                base_url=str(hybrid_target_payload.get("base_url") or "http://127.0.0.1:8000/v1"),
                api_key=str(hybrid_target_payload.get("api_key") or "EMPTY"),
            )
            prefer_cloud = False
            local_model_override = str(hybrid_target_payload.get("model") or bound_target.model)
            with self._metrics_lock:
                self._metrics["route_decision_local"] += 1
        else:
            route_payload = {
                "critical": bool(meta.critical) if meta else False,
                "est_tokens": int(meta.est_tokens) if meta else 0,
                "tenant_tier": str(meta.tenant_tier) if meta else "basic",
                "user_id": str(meta.user_id) if meta else "anonymous",
                "task_type": task_type,
            }
            decision = await clawrouter_gateway.decide(route_payload)
            prefer_cloud = decision.route == "cloud"
            local_model_override = explicit_model_override if explicit_model_override and decision.route == "local" else (
                decision.selected_model if decision.route == "local" else None
            )
            cloud_model_override = explicit_model_override if explicit_model_override and decision.route == "cloud" else (
                decision.selected_model if decision.route == "cloud" else None
            )
            with self._metrics_lock:
                if prefer_cloud:
                    self._metrics["route_decision_cloud"] += 1
                else:
                    self._metrics["route_decision_local"] += 1
                if decision.source == "remote_clawrouter":
                    self._metrics["route_decision_remote"] += 1
                if decision.source.startswith("fallback"):
                    self._metrics["route_decision_fallback"] += 1

        if prefer_cloud and self.economy_enabled and user_id:
            est = int(meta.est_tokens if meta else 0)
            est_cost = (
                (max(1, est) / 1_000_000)
                * (self.cloud_input_price_per_mtok + self.cloud_output_price_per_mtok * 0.6)
            )
            allowed, _wallet = can_use_cloud(user_id, est_cost)
            if not allowed:
                prefer_cloud = False
                local_model_override = local_model_override or self.local_target.model
                with self._metrics_lock:
                    self._metrics["budget_forced_local"] += 1

        cloud_target = self._pick_cloud_target()
        local_target = self.local_target
        if bound_target is not None:
            if prefer_cloud:
                cloud_target = bound_target
            else:
                local_target = bound_target
        if prefer_cloud:
            primary_target = cloud_target if bound_target is None else bound_target
            fallback_target = local_target
            primary_override = cloud_model_override
            fallback_override = local_model_override
            primary_name = "cloud"
            fallback_name = "local"
        else:
            primary_target = local_target if bound_target is None else bound_target
            fallback_target = cloud_target
            primary_override = local_model_override
            fallback_override = cloud_model_override
            primary_name = "local"
            fallback_name = "cloud"

        if explicit_model_override:
            primary_override = explicit_model_override
            fallback_override = explicit_model_override
        elif smart_decision is not None:
            primary_override = choose_model_for_provider(
                primary_target.name,
                smart_decision.tier,
                primary_override or primary_target.model,
            )
            fallback_override = choose_model_for_provider(
                fallback_target.name,
                smart_decision.tier,
                fallback_override or fallback_target.model,
            )
            smart_decision = type(smart_decision)(
                tier=smart_decision.tier,
                model=primary_override,
                method=smart_decision.method,
                score=smart_decision.score,
                pattern=smart_decision.pattern,
                dim_scores=smart_decision.dim_scores,
                provider_name=primary_target.name,
            )
            self._record_smart_routing(
                decision=smart_decision,
                tenant_id=tenant_id,
                user_id=user_id,
                task_type=task_type,
                route=primary_target.route,
                input_len=len(user_prompt),
            )

        prompt_text = f"{system_prompt}\n{user_prompt}"
        with self._metrics_lock:
            self._metrics["calls_total"] += 1
            if primary_name == "local":
                self._metrics["calls_primary_local"] += 1
            else:
                self._metrics["calls_primary_cloud"] += 1

        messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]

        try:
            if primary_target.route == "cloud":
                cloud_targets = self._ordered_failover_cloud_targets(primary_target)

                async def _cloud_invoke(target: LLMTarget, _messages: list[Any], **_kwargs: Any) -> dict[str, Any]:
                    resolved_override = self._resolve_target_model_override(
                        target=target,
                        explicit_model_override=explicit_model_override,
                        smart_decision=smart_decision,
                        default_override=primary_override if target.name == primary_target.name else None,
                    )
                    return await self._invoke_target(
                        target=target,
                        messages=_messages,
                        prompt_text=prompt_text,
                        temperature=temperature,
                        model_override=resolved_override,
                    )

                primary_payload = await FailoverProvider(
                    cloud_targets,
                    name_resolver=lambda target: target.name,
                    invoke_func=_cloud_invoke,
                    max_retries_per_provider=self.max_retries,
                ).ainvoke(messages)
            else:
                primary_payload = await self._invoke_target(
                    target=primary_target,
                    messages=messages,
                    prompt_text=prompt_text,
                    temperature=temperature,
                    model_override=primary_override,
                )

            primary_build = primary_payload["build"]
            content = str(primary_payload["content"])
            prompt_tokens = int(primary_payload["prompt_tokens"])
            completion_tokens = int(primary_payload["completion_tokens"])
            latency_ms = int(primary_payload.get("latency_ms") or 0)
            model_used = str(primary_payload.get("model_used") or primary_override or primary_target.model or "")
            if primary_target.route == "cloud" and str(primary_payload.get("provider_name")) != primary_target.name:
                with self._metrics_lock:
                    self._metrics["fallback_invoked"] += 1
            self._record_success(primary_build.route, primary_build.backend, prompt_tokens, completion_tokens)
            if meta and str(meta.trace_id or "").strip():
                try:
                    LangfuseTracer.record_llm_generation(
                        trace_id=str(meta.trace_id),
                        span_id=str(meta.span_id or "").strip() or None,
                        tenant_id=tenant_id,
                        model=model_used or primary_build.backend,
                        provider=str(primary_payload.get("provider_name") or primary_build.backend),
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        duration_ms=latency_ms,
                        input_prompt=user_prompt,
                        output_text=content,
                        metadata={
                            "route": primary_build.route,
                            "backend": primary_build.backend,
                            "task_type": task_type,
                        },
                    )
                except Exception:
                    pass
            if self.economy_enabled and user_id and primary_build.route in {"local", "cloud"}:
                try:
                    settle_usage(
                        user_id=user_id,
                        route=primary_build.route,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        success=True,
                        cloud_input_price_per_mtok=self.cloud_input_price_per_mtok,
                        cloud_output_price_per_mtok=self.cloud_output_price_per_mtok,
                    )
                    with self._metrics_lock:
                        self._metrics["economy_settled"] += 1
                except Exception:  # noqa: BLE001
                    pass
            return content
        except Exception as primary_error:  # noqa: BLE001
            self._record_error(primary_error)
            if not self.enable_cloud_fallback:
                with self._metrics_lock:
                    self._metrics["calls_failed_total"] += 1
                raise RuntimeError(f"{primary_name} llm failed: {primary_error}") from primary_error

            try:
                with self._metrics_lock:
                    self._metrics["fallback_invoked"] += 1
                    if primary_name == "local":
                        self._metrics["fallback_local_to_cloud"] += 1
                    else:
                        self._metrics["fallback_cloud_to_local"] += 1
                if fallback_target.route == "cloud":
                    cloud_targets = self._ordered_failover_cloud_targets(fallback_target)

                    async def _fallback_cloud_invoke(target: LLMTarget, _messages: list[Any], **_kwargs: Any) -> dict[str, Any]:
                        resolved_override = self._resolve_target_model_override(
                            target=target,
                            explicit_model_override=explicit_model_override,
                            smart_decision=smart_decision,
                            default_override=fallback_override if target.name == fallback_target.name else None,
                        )
                    return await self._invoke_target(
                        target=target,
                        messages=_messages,
                        prompt_text=prompt_text,
                        temperature=temperature,
                        model_override=resolved_override,
                    )

                    fallback_payload = await FailoverProvider(
                        cloud_targets,
                        name_resolver=lambda target: target.name,
                        invoke_func=_fallback_cloud_invoke,
                        max_retries_per_provider=self.max_retries,
                    ).ainvoke(messages)
                else:
                    fallback_payload = await self._invoke_target(
                        target=fallback_target,
                        messages=messages,
                        prompt_text=prompt_text,
                        temperature=temperature,
                        model_override=fallback_override,
                    )

                fallback_build = fallback_payload["build"]
                content = str(fallback_payload["content"])
                prompt_tokens = int(fallback_payload["prompt_tokens"])
                completion_tokens = int(fallback_payload["completion_tokens"])
                latency_ms = int(fallback_payload.get("latency_ms") or 0)
                model_used = str(fallback_payload.get("model_used") or fallback_override or fallback_target.model or "")
                self._record_success(fallback_build.route, fallback_build.backend, prompt_tokens, completion_tokens)
                if meta and str(meta.trace_id or "").strip():
                    try:
                        LangfuseTracer.record_llm_generation(
                            trace_id=str(meta.trace_id),
                            span_id=str(meta.span_id or "").strip() or None,
                            tenant_id=tenant_id,
                            model=model_used or fallback_build.backend,
                            provider=str(fallback_payload.get("provider_name") or fallback_build.backend),
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            duration_ms=latency_ms,
                            input_prompt=user_prompt,
                            output_text=content,
                            metadata={
                                "route": fallback_build.route,
                                "backend": fallback_build.backend,
                                "task_type": task_type,
                                "fallback": True,
                            },
                        )
                    except Exception:
                        pass
                if self.economy_enabled and user_id and fallback_build.route in {"local", "cloud"}:
                    try:
                        settle_usage(
                            user_id=user_id,
                            route=fallback_build.route,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            success=True,
                            cloud_input_price_per_mtok=self.cloud_input_price_per_mtok,
                            cloud_output_price_per_mtok=self.cloud_output_price_per_mtok,
                        )
                        with self._metrics_lock:
                            self._metrics["economy_settled"] += 1
                    except Exception:  # noqa: BLE001
                        pass
                return content
            except Exception as fallback_error:  # noqa: BLE001
                self._record_error(fallback_error)
                with self._metrics_lock:
                    self._metrics["calls_failed_total"] += 1
                raise RuntimeError(
                    f"llm route failed: {primary_name} error={primary_error}; "
                    f"{fallback_name} error={fallback_error}"
                ) from fallback_error

    def _record_smart_routing(
        self,
        *,
        decision: Any,
        tenant_id: str,
        user_id: str,
        task_type: str,
        route: str,
        input_len: int,
    ) -> None:
        with self._metrics_lock:
            self._metrics["smart_routing_total"] += 1
            if decision.method == "forced":
                self._metrics["smart_routing_forced"] += 1
            elif decision.method == "pattern_override":
                self._metrics["smart_routing_pattern_override"] += 1
            else:
                self._metrics["smart_routing_complexity_score"] += 1
            self._metrics[f"smart_routing_tier_{decision.tier.value}"] += 1
            self._metrics["last_smart_routing"] = decision.to_dict()

        try:
            log_smart_routing_decision(
                tenant_id=tenant_id,
                user_id=user_id,
                task_type=task_type,
                tier=decision.tier.value,
                model=decision.model,
                provider_name=decision.provider_name,
                route=route,
                method=decision.method,
                score=decision.score,
                pattern=decision.pattern,
                input_len=input_len,
                dim_scores=decision.dim_scores,
            )
        except Exception as error:  # noqa: BLE001
            self._record_error(error)

    def describe(self) -> dict[str, Any]:
        self._refresh_targets_from_registry()
        picked_cloud = self._pick_cloud_target()
        return {
            "local_base_url": self.local_target.base_url,
            "local_model": self.local_target.model,
            "cloud_vendor": self.cloud_vendor,
            "cloud_provider_order": self.cloud_provider_order,
            "picked_cloud_vendor": picked_cloud.name,
            "cloud_base_url": picked_cloud.base_url,
            "cloud_model": picked_cloud.model,
            "cloud_key_configured": bool(picked_cloud.api_key),
            "deepseek_configured": bool(self.cloud_targets.get("deepseek", LLMTarget("", "", "", "", "")).api_key),
            "volcengine_configured": bool(self.cloud_targets.get("volcengine", LLMTarget("", "", "", "", "")).api_key),
            "force_local": self.force_local,
            "enable_cloud_fallback": self.enable_cloud_fallback,
            "cloud_input_price_per_mtok": self.cloud_input_price_per_mtok,
            "cloud_output_price_per_mtok": self.cloud_output_price_per_mtok,
            "clawrouter": clawrouter_gateway.describe(),
            "clawwork": clawwork_status(),
            "economy_enabled": self.economy_enabled,
            "binding_resolver_enabled": self._binding_resolver is not None,
            "smart_routing": smart_routing_stats(),
        }


llm_router = LLMRouter()
