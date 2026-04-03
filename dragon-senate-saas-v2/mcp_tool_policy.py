"""
MCP tool permission policies for lobsters.
"""

from __future__ import annotations

import fnmatch
import time
from collections import defaultdict
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from dynamic_config import get_dynamic_config
from tool_marketplace import get_tool_marketplace


@dataclass(slots=True)
class ToolCallLimit:
    max_calls_per_minute: int = 60
    max_calls_per_session: int = 200
    max_cost_per_call: float = 0.10

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ToolPermissionPolicy:
    lobster_name: str
    allowed_tools: list[str]
    denied_tools: list[str] = field(default_factory=list)
    limits: dict[str, ToolCallLimit] = field(default_factory=dict)
    allow_unknown_tools: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "lobster_name": self.lobster_name,
            "allowed_tools": list(self.allowed_tools),
            "denied_tools": list(self.denied_tools),
            "limits": {key: value.to_dict() for key, value in self.limits.items()},
            "allow_unknown_tools": self.allow_unknown_tools,
        }


LOBSTER_TOOL_POLICIES: dict[str, ToolPermissionPolicy] = {
    "commander": ToolPermissionPolicy("commander", ["*"], denied_tools=["execute_shell"], allow_unknown_tools=True),
    "strategist": ToolPermissionPolicy("strategist", ["web_search", "web_reader", "news_search", "market_data_*"]),
    "inkwriter": ToolPermissionPolicy("inkwriter", ["web_search", "web_reader", "image_search", "grammar_check"], denied_tools=["execute_shell", "file_write", "db_*", "payment_*"]),
    "visualizer": ToolPermissionPolicy("visualizer", ["image_generate", "image_edit", "chart_render", "web_search"]),
    "dispatcher": ToolPermissionPolicy("dispatcher", ["send_message", "send_email", "send_sms", "webhook_call"], limits={"send_message": ToolCallLimit(max_calls_per_minute=30), "send_email": ToolCallLimit(max_calls_per_minute=10), "send_sms": ToolCallLimit(max_calls_per_minute=5)}),
    "echoer": ToolPermissionPolicy("echoer", ["send_message", "voice_synthesize", "translation"], limits={"send_message": ToolCallLimit(max_calls_per_minute=60)}),
    "catcher": ToolPermissionPolicy("catcher", ["web_scraper", "browser_*", "file_read", "api_fetch"], denied_tools=["payment_*", "db_write", "execute_shell"], limits={"web_scraper": ToolCallLimit(max_calls_per_minute=20), "browser_*": ToolCallLimit(max_calls_per_minute=10)}),
    "abacus": ToolPermissionPolicy("abacus", ["calculator", "db_query", "spreadsheet_*", "data_analysis_*"], denied_tools=["db_write", "db_delete", "payment_*"]),
    "radar": ToolPermissionPolicy("radar", ["web_search", "news_search", "social_monitor", "trend_analysis"]),
    "followup": ToolPermissionPolicy("followup", ["send_message", "send_email", "calendar_*", "crm_*"], limits={"send_email": ToolCallLimit(max_calls_per_minute=5, max_calls_per_session=20)}),
}


class ToolPolicyEnforcer:
    def __init__(self) -> None:
        self._call_counts: dict[str, list[float]] = defaultdict(list)
        self._session_counts: dict[str, int] = defaultdict(int)

    def list_policies(self) -> list[dict[str, Any]]:
        return [self._resolve_policy(name).to_dict() for name in sorted(LOBSTER_TOOL_POLICIES)]

    def get_policy(self, lobster_name: str) -> dict[str, Any]:
        policy = self._resolve_policy(lobster_name)
        return policy.to_dict() if policy else {}

    def update_policy_override(self, lobster_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = get_dynamic_config()
        overrides = cfg.get_json("mcp_tool_policy_overrides", {}) or {}
        if not isinstance(overrides, dict):
            overrides = {}
        overrides[str(lobster_name)] = payload
        cfg.set("mcp_tool_policy_overrides", overrides, description="MCP tool policy overrides")
        return self.get_policy(lobster_name)

    def check(
        self,
        *,
        lobster_name: str,
        tool_name: str,
        tenant_id: str = "tenant_main",
        session_id: str = "",
        estimated_cost: float = 0.0,
    ) -> tuple[bool, str]:
        if lobster_name in {"admin", "system", "manual_test"}:
            return True, ""
        policy = self._resolve_policy(lobster_name)
        if policy is None:
            return False, f"未注册的龙虾角色: {lobster_name}"

        for denied in policy.denied_tools:
            if fnmatch.fnmatch(tool_name, denied):
                return False, f"工具 {tool_name} 在 {lobster_name} 的禁用列表中"

        allowed_by_policy = any(
            allowed == "*" or fnmatch.fnmatch(tool_name, allowed)
            for allowed in policy.allowed_tools
        )
        if not allowed_by_policy and not policy.allow_unknown_tools:
            return False, f"工具 {tool_name} 不在 {lobster_name} 的允许列表中"

        if not get_tool_marketplace().is_tool_available_for_tenant(tenant_id, tool_name):
            return False, f"租户 {tenant_id} 未订阅工具 {tool_name}"

        limit = self._find_limit(policy, tool_name)
        if limit is not None:
            now = time.time()
            minute_key = f"{lobster_name}:{tool_name}:minute"
            self._call_counts[minute_key] = [ts for ts in self._call_counts[minute_key] if now - ts < 60]
            if len(self._call_counts[minute_key]) >= limit.max_calls_per_minute:
                return False, f"工具 {tool_name} 调用频率超限 ({limit.max_calls_per_minute}/分钟)"
            self._call_counts[minute_key].append(now)

            if session_id:
                session_key = f"{lobster_name}:{tool_name}:{session_id}"
                if self._session_counts[session_key] >= limit.max_calls_per_session:
                    return False, f"工具 {tool_name} 在当前会话中的调用次数已达上限"
                self._session_counts[session_key] += 1

            if estimated_cost > limit.max_cost_per_call:
                return False, f"工具 {tool_name} 预估成本超限 ({estimated_cost:.3f} > {limit.max_cost_per_call:.3f})"

        return True, ""

    def _find_limit(self, policy: ToolPermissionPolicy, tool_name: str) -> ToolCallLimit | None:
        for pattern, limit in policy.limits.items():
            if fnmatch.fnmatch(tool_name, pattern):
                return limit
        return None

    def _resolve_policy(self, lobster_name: str) -> ToolPermissionPolicy | None:
        base = LOBSTER_TOOL_POLICIES.get(lobster_name)
        if base is None:
            return None
        overrides = get_dynamic_config().get_json("mcp_tool_policy_overrides", {}) or {}
        if not isinstance(overrides, dict):
            overrides = {}
        override = overrides.get(lobster_name)
        if not isinstance(override, dict):
            return base
        limits: dict[str, ToolCallLimit] = dict(base.limits)
        raw_limits = override.get("limits")
        if isinstance(raw_limits, dict):
            for pattern, raw_limit in raw_limits.items():
                if isinstance(raw_limit, dict):
                    limits[str(pattern)] = ToolCallLimit(
                        max_calls_per_minute=int(raw_limit.get("max_calls_per_minute", 60) or 60),
                        max_calls_per_session=int(raw_limit.get("max_calls_per_session", 200) or 200),
                        max_cost_per_call=float(raw_limit.get("max_cost_per_call", 0.1) or 0.1),
                    )
        return ToolPermissionPolicy(
            lobster_name=lobster_name,
            allowed_tools=[str(item) for item in override.get("allowed_tools", base.allowed_tools)],
            denied_tools=[str(item) for item in override.get("denied_tools", base.denied_tools)],
            limits=limits,
            allow_unknown_tools=bool(override.get("allow_unknown_tools", base.allow_unknown_tools)),
        )


tool_policy_enforcer = ToolPolicyEnforcer()
