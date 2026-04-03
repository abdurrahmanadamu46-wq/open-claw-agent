from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class ClawRouterDecision:
    route: str
    tier: str
    reason: str
    source: str
    selected_model: str | None = None
    raw: dict[str, Any] | None = None


class ClawRouterGateway:
    """
    Optional external routing adapter inspired by ClawRouter style gateways.
    If remote router is unavailable, fall back to deterministic local heuristic.
    """

    def __init__(self) -> None:
        self.enabled = _env_bool("CLAWROUTER_ENABLED", False)
        self.base_url = os.getenv("CLAWROUTER_BASE_URL", "http://127.0.0.1:8402").rstrip("/")
        self.route_path = os.getenv("CLAWROUTER_ROUTE_PATH", "/v1/route")
        self.api_key = os.getenv("CLAWROUTER_API_KEY", "").strip()
        self.timeout_sec = float(os.getenv("CLAWROUTER_TIMEOUT_SEC", "2.5"))
        self.free_local_model = os.getenv("CLAWROUTER_FREE_MODEL", "").strip() or None
        self.eco_local_model = os.getenv("CLAWROUTER_ECO_MODEL", "").strip() or None
        self.premium_cloud_model = os.getenv("CLAWROUTER_PREMIUM_MODEL", "").strip() or None
        self.low_risk_task_types = self._parse_csv(
            os.getenv(
                "CLAWROUTER_LOW_RISK_TASK_TYPES",
                (
                    "echo_reply,engagement_copy,radar_cleaning,strategist_clustering,"
                    "intent_tagging,trend_scan,comment_hint,reply_draft,routine,"
                    "llm_smoke,deepseek_smoke,health_check,status_query,trace_summary,"
                    "metrics_snapshot,memory_hits"
                ),
            )
        )
        self.eco_task_types = self._parse_csv(
            os.getenv(
                "CLAWROUTER_ECO_TASK_TYPES",
                (
                    "strategy_planning,content_generation,competitor_analysis,"
                    "competitor_formula_analyzer,rag_ingest,dispatch_plan,dm_followup,"
                    "general,dispatcher,hotspot_investigation,lead_scoring,"
                    "trace_aggregate,replay_audit_summary,policy_bandit_update,"
                    "persona_mask_apply,edge_skill_discovery,webhook_delivery"
                ),
            )
        )
        self.routine_task_types = self._parse_csv(
            os.getenv(
                "CLAWROUTER_ROUTINE_TASK_TYPES",
                (
                    "radar_cleaning,echo_reply,strategist_clustering,general,routine,"
                    "engagement_copy,llm_smoke,deepseek_smoke,status_query"
                ),
            )
        )
        self.premium_task_types = self._parse_csv(
            os.getenv(
                "CLAWROUTER_PREMIUM_TASK_TYPES",
                (
                    "sales_followup,followup_voice,multimodal_heavy,critical_conversion,"
                    "long_script,human_approval_gate,compliance_review,legal_review,"
                    "voice_call_realtime,cross_tenant_write,financial_settlement,"
                    "risk_override"
                ),
            )
        )
        self.complex_task_types = self._parse_csv(
            os.getenv(
                "CLAWROUTER_COMPLEX_TASK_TYPES",
                (
                    "complex_reasoning,critical_conversion,long_script,multimodal_heavy,"
                    "followup_voice,competitor_formula_analyzer,campaign_strategy_deep"
                ),
            )
        )
        self.force_routine_local = _env_bool("CLAWROUTER_FORCE_ROUTINE_LOCAL", True)
        self.complexity_cloud_threshold = float(os.getenv("CLAWROUTER_COMPLEXITY_THRESHOLD", "0.72"))

    @staticmethod
    def _parse_csv(raw: str) -> set[str]:
        return {part.strip().lower() for part in raw.split(",") if part.strip()}

    def _heuristic(self, payload: dict[str, Any]) -> ClawRouterDecision:
        critical = bool(payload.get("critical", False))
        est_tokens = int(payload.get("est_tokens", 0) or 0)
        tenant_tier = str(payload.get("tenant_tier", "basic")).lower()
        task_type = str(payload.get("task_type", "general")).lower()
        complexity_score = float(payload.get("complexity_score", 0.0) or 0.0)

        if task_type in self.low_risk_task_types and not critical:
            return ClawRouterDecision(
                route="local",
                tier="free",
                reason="low_risk_free_policy",
                source="local_heuristic",
                selected_model=self.free_local_model or self.eco_local_model,
                raw={"payload": payload},
            )

        if (
            self.force_routine_local
            and (task_type in self.eco_task_types or task_type in self.routine_task_types)
            and not critical
        ):
            return ClawRouterDecision(
                route="local",
                tier="eco",
                reason="routine_task_local_policy",
                source="local_heuristic",
                selected_model=self.eco_local_model,
                raw={"payload": payload},
            )

        if task_type in self.premium_task_types and not (task_type in self.low_risk_task_types):
            return ClawRouterDecision(
                route="cloud",
                tier="premium",
                reason="premium_task_policy",
                source="local_heuristic",
                selected_model=self.premium_cloud_model,
                raw={"payload": payload},
            )

        cloud_first = (
            critical
            or est_tokens >= 6500
            or tenant_tier in {"pro", "enterprise", "vip"}
            or task_type in {"complex_reasoning", "critical_conversion"}
            or task_type in self.complex_task_types
            or complexity_score >= self.complexity_cloud_threshold
        )
        if cloud_first:
            return ClawRouterDecision(
                route="cloud",
                tier="premium",
                reason="heuristic_cloud_first",
                source="local_heuristic",
                selected_model=self.premium_cloud_model,
                raw={"payload": payload},
            )
        return ClawRouterDecision(
            route="local",
            tier="eco",
            reason="heuristic_local_first",
            source="local_heuristic",
            selected_model=self.eco_local_model,
            raw={"payload": payload},
        )

    async def decide(self, payload: dict[str, Any]) -> ClawRouterDecision:
        fallback = self._heuristic(payload)
        if not self.enabled:
            return fallback

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        route_url = f"{self.base_url}{self.route_path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
                resp = await client.post(route_url, json=payload, headers=headers)
                resp.raise_for_status()
                body = resp.json()
        except Exception as exc:  # noqa: BLE001
            fallback.reason = f"remote_error:{exc}"
            fallback.source = "fallback_heuristic"
            return fallback

        if not isinstance(body, dict):
            fallback.reason = "remote_invalid_response"
            fallback.source = "fallback_heuristic"
            return fallback

        route = str(body.get("route") or body.get("provider") or fallback.route).lower()
        if route not in {"local", "cloud"}:
            route = fallback.route

        tier = str(body.get("tier") or body.get("mode") or fallback.tier).lower()
        if tier not in {"eco", "premium", "free"}:
            tier = fallback.tier

        model = body.get("model") or body.get("selected_model") or fallback.selected_model
        selected_model = str(model).strip() if model else None
        if selected_model == "":
            selected_model = None

        task_type = str(payload.get("task_type", "general")).lower()
        critical = bool(payload.get("critical", False))
        # Hard guard: low-risk routine tasks always stay local + free tier.
        if task_type in self.low_risk_task_types and not critical:
            route = "local"
            tier = "free"
            selected_model = self.free_local_model or self.eco_local_model or selected_model
            reason = "low_risk_task_forced_free"
        # Safety guard: routine tasks must stay local unless explicitly critical.
        elif (
            self.force_routine_local
            and (task_type in self.eco_task_types or task_type in self.routine_task_types)
            and not critical
        ):
            route = "local"
            tier = "eco"
            selected_model = self.eco_local_model or selected_model
            reason = "routine_task_forced_local"
        elif task_type in self.premium_task_types and not (task_type in self.low_risk_task_types):
            route = "cloud"
            tier = "premium"
            selected_model = self.premium_cloud_model or selected_model
            reason = "premium_task_forced_cloud"
        else:
            reason = str(body.get("reason") or "remote_router")

        return ClawRouterDecision(
            route=route,
            tier=tier,
            reason=reason[:160],
            source="remote_clawrouter",
            selected_model=selected_model,
            raw=body,
        )

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "base_url": self.base_url,
            "route_path": self.route_path,
            "api_key_configured": bool(self.api_key),
            "timeout_sec": self.timeout_sec,
            "free_model": self.free_local_model,
            "eco_model": self.eco_local_model,
            "premium_model": self.premium_cloud_model,
            "low_risk_task_types": sorted(self.low_risk_task_types),
            "eco_task_types": sorted(self.eco_task_types),
            "routine_task_types": sorted(self.routine_task_types),
            "premium_task_types": sorted(self.premium_task_types),
            "complex_task_types": sorted(self.complex_task_types),
            "force_routine_local": self.force_routine_local,
            "complexity_cloud_threshold": self.complexity_cloud_threshold,
        }


clawrouter_gateway = ClawRouterGateway()
