"""
BaseLobster — 龙虾基类

所有 9 只龙虾的统一基础设施：
1. 从 packages/lobsters/lobster-{role}/role-card.json 加载身份定义
2. 统一的日志与 agent_log 格式
3. 统一的 DragonState 输入/输出契约
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from lobsters.lobster_security import get_security_prompt_for_lobster

logger = logging.getLogger("lobster_pool")

# ── Role card cache ──
_ROLE_CARDS: dict[str, dict[str, Any]] = {}
_SOULS: dict[str, str] = {}
_AGENTS_RULES: dict[str, str] = {}
_BOOTSTRAPS: dict[str, str] = {}
_HEARTBEATS: dict[str, dict[str, Any]] = {}
_WORKING: dict[str, dict[str, Any]] = {}
_PROMPT_ASSETS: dict[str, list[dict[str, Any]]] = {}

# Path to the TS design-time packages (source of truth for role definitions)
_PACKAGES_ROOT = Path(__file__).resolve().parent.parent.parent / "packages" / "lobsters"

# Path to baseline-agent-manifest.json
_BASELINE_MANIFEST_PATH = _PACKAGES_ROOT / "baseline-agent-manifest.json"
_BASELINE_MANIFEST: dict[str, Any] | None = None


def _load_baseline_manifest() -> dict[str, Any]:
    """Load the baseline agent manifest (cached)."""
    global _BASELINE_MANIFEST
    if _BASELINE_MANIFEST is None:
        if _BASELINE_MANIFEST_PATH.exists():
            _BASELINE_MANIFEST = json.loads(
                _BASELINE_MANIFEST_PATH.read_text(encoding="utf-8-sig")
            )
        else:
            _BASELINE_MANIFEST = {"roles": []}
    return _BASELINE_MANIFEST


def load_role_card(role_id: str) -> dict[str, Any]:
    """
    Load a lobster's role card from the TS design-time package.

    Reads from: packages/lobsters/lobster-{role_id}/role-card.json
    Falls back to a minimal default if file is missing.
    Merges baseline-agent-manifest fields (starterSkills, bridgeTarget, etc.)
    """
    if role_id in _ROLE_CARDS:
        return _ROLE_CARDS[role_id]

    card_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "role-card.json"
    if card_path.exists():
        card = json.loads(card_path.read_text(encoding="utf-8-sig"))
    else:
        logger.warning("Role card not found for %s at %s, using defaults", role_id, card_path)
        card = {
            "roleId": role_id,
            "displayName": role_id.capitalize(),
            "zhName": role_id,
            "mission": f"Default mission for {role_id}",
        }

    # Merge baseline manifest fields
    manifest = _load_baseline_manifest()
    for role_entry in manifest.get("roles", []):
        if role_entry.get("roleId") == role_id:
            card.setdefault("baselineAgentId", role_entry.get("baselineAgentId"))
            card.setdefault("starterSkills", role_entry.get("starterSkills", []))
            card.setdefault("defaultBridgeTarget", role_entry.get("defaultBridgeTarget"))
            card.setdefault("defaultMissionTypes", role_entry.get("defaultMissionTypes", []))
            card.setdefault("agentMode", role_entry.get("agentMode"))
            card.setdefault("primaryArtifact", role_entry.get("primaryArtifact"))
            break

    _ROLE_CARDS[role_id] = card
    return card


def load_prompt_kit(role_id: str) -> dict[str, str]:
    """
    Load the prompt-kit (system prompt + user template) for a lobster.

    Reads from: packages/lobsters/lobster-{role_id}/prompt-kit/
    """
    kit_dir = _PACKAGES_ROOT / f"lobster-{role_id}" / "prompt-kit"
    result: dict[str, str] = {}

    system_path = kit_dir / "system.prompt.md"
    if system_path.exists():
        result["system_prompt"] = system_path.read_text(encoding="utf-8")

    user_path = kit_dir / "user-template.md"
    if user_path.exists():
        result["user_template"] = user_path.read_text(encoding="utf-8")

    return result


def load_memory_policy(role_id: str) -> dict[str, Any]:
    """
    Load the memory policy for a lobster.

    Reads from: packages/lobsters/lobster-{role_id}/memory-policy/policy.json
    """
    policy_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "memory-policy" / "policy.json"
    if policy_path.exists():
        return json.loads(policy_path.read_text(encoding="utf-8-sig"))
    return {}


def load_soul(role_id: str) -> str:
    """Load SOUL.md as string for system prompt injection."""
    if role_id in _SOULS:
        return _SOULS[role_id]
    soul_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "SOUL.md"
    value = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
    _SOULS[role_id] = value
    return value


def load_agents_rules(role_id: str) -> str:
    """Load AGENTS.md as string."""
    if role_id in _AGENTS_RULES:
        return _AGENTS_RULES[role_id]
    agents_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "AGENTS.md"
    value = agents_path.read_text(encoding="utf-8") if agents_path.exists() else ""
    _AGENTS_RULES[role_id] = value
    return value


def load_bootstrap(role_id: str) -> str:
    """Load BOOTSTRAP.md as string for first-run activation."""
    if role_id in _BOOTSTRAPS:
        return _BOOTSTRAPS[role_id]
    bootstrap_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "BOOTSTRAP.md"
    value = bootstrap_path.read_text(encoding="utf-8") if bootstrap_path.exists() else ""
    _BOOTSTRAPS[role_id] = value
    return value


def load_heartbeat(role_id: str) -> dict[str, Any]:
    """Load heartbeat.json."""
    if role_id in _HEARTBEATS:
        return dict(_HEARTBEATS[role_id])
    hb_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "heartbeat.json"
    if hb_path.exists():
        value = json.loads(hb_path.read_text(encoding="utf-8-sig"))
    else:
        value = {"on_wake": [], "periodic": [], "stand_down": {}}
    _HEARTBEATS[role_id] = value
    return dict(value)


def load_working(role_id: str) -> dict[str, Any]:
    """Load working.json (runtime state)."""
    working_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "working.json"
    if working_path.exists():
        value = json.loads(working_path.read_text(encoding="utf-8-sig"))
    else:
        value = {
            "agent_id": role_id,
            "version": "1.0.0",
            "current_task": None,
            "last_completed": None,
            "context": {},
            "next_steps": [],
            "blocked_by": [],
            "updated_at": None,
        }
    _WORKING[role_id] = value
    return json.loads(json.dumps(value))


def load_prompt_assets(role_id: str) -> list[dict[str, Any]]:
    """Load prompt asset metadata for this lobster from the TS design-time packages."""
    if role_id in _PROMPT_ASSETS:
        return json.loads(json.dumps(_PROMPT_ASSETS[role_id]))

    try:
        from prompt_asset_loader import get_prompt_loader

        assets = [tpl.to_api_ref() for tpl in get_prompt_loader().load_lobster_prompts(role_id)]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load prompt assets for %s: %s", role_id, exc)
        assets = []

    _PROMPT_ASSETS[role_id] = assets
    return json.loads(json.dumps(assets))


def save_working(role_id: str, state: dict[str, Any]) -> None:
    """Persist working.json (called by LobsterRunner)."""
    working_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "working.json"
    working_path.parent.mkdir(parents=True, exist_ok=True)
    working_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _WORKING[role_id] = json.loads(json.dumps(state))


class BaseLobster:
    """
    Base class for all 9 lobsters.

    Provides:
    - role_card: loaded from TS design-time package
    - prompt_kit: system prompt + user template
    - memory_policy: per-role memory configuration
    - agent_log(): standardized log entry format
    """

    role_id: str = "unknown"
    DEFAULT_TIER: Any = None
    SECURITY_ENABLED: bool = True

    def __init__(self) -> None:
        from lobsters.lobster_memory import LobsterMemory

        self.tenant_id = os.getenv("LOBSTER_DEFAULT_TENANT_ID", "tenant_main")
        self.role_card = load_role_card(self.role_id)
        self.prompt_kit = load_prompt_kit(self.role_id)
        self.prompt_assets = load_prompt_assets(self.role_id)
        self.memory_policy = load_memory_policy(self.role_id)
        self.soul = load_soul(self.role_id)
        self.agents_rules = load_agents_rules(self.role_id)
        self.bootstrap_prompt = load_bootstrap(self.role_id)
        self.heartbeat = load_heartbeat(self.role_id)
        self.working = load_working(self.role_id)
        self.memory = LobsterMemory(self.role_id, self.tenant_id)

    @property
    def display_name(self) -> str:
        return str(self.role_card.get("displayName", self.role_id))

    @property
    def zh_name(self) -> str:
        return str(self.role_card.get("zhName", self.role_id))

    @property
    def mission(self) -> str:
        return str(self.role_card.get("mission", ""))

    @property
    def primary_artifact(self) -> str:
        return str(self.role_card.get("primaryArtifact", ""))

    @property
    def starter_skills(self) -> list[str]:
        return list(self.role_card.get("starterSkills", []))

    @property
    def upstream_roles(self) -> list[str]:
        return list(self.role_card.get("upstreamRoles", []))

    @property
    def downstream_roles(self) -> list[str]:
        return list(self.role_card.get("downstreamRoles", []))

    @property
    def input_contract(self) -> list[str]:
        return list(self.role_card.get("inputContract", []))

    @property
    def output_contract(self) -> list[str]:
        return list(self.role_card.get("outputContract", []))

    @property
    def forbidden_actions(self) -> list[str]:
        return list(self.role_card.get("forbiddenActions", []))

    @property
    def personality(self) -> str:
        return str(self.role_card.get("personality", ""))

    @property
    def communication_style(self) -> str:
        return str(self.role_card.get("communicationStyle", ""))

    @property
    def behavioral_do(self) -> list[str]:
        bg = self.role_card.get("behavioralGuidelines", {})
        return list(bg.get("do", [])) if isinstance(bg, dict) else []

    @property
    def behavioral_dont(self) -> list[str]:
        bg = self.role_card.get("behavioralGuidelines", {})
        return list(bg.get("dont", [])) if isinstance(bg, dict) else []

    @property
    def output_formats(self) -> dict[str, str]:
        return dict(self.role_card.get("outputFormats", {}))

    @property
    def max_concurrency(self) -> int:
        return int(self.role_card.get("maxConcurrency", 3))

    @property
    def token_budget(self) -> dict[str, int]:
        return dict(self.role_card.get("tokenBudget", {}))

    @property
    def tool_whitelist(self) -> list[str]:
        return list(self.role_card.get("toolWhitelist", []))

    @property
    def tool_blacklist(self) -> list[str]:
        return list(self.role_card.get("toolBlacklist", []))

    @property
    def system_prompt_full(self) -> str:
        """Compose the full system prompt: SOUL.md + prompt-kit system prompt."""
        parts = []
        if self.soul:
            parts.append(self.soul)
        if self.prompt_kit.get("system_prompt"):
            parts.append(self.prompt_kit["system_prompt"])
        security_prompt = self._get_security_prompt()
        if security_prompt:
            parts.append(security_prompt)
        return "\n\n---\n\n".join(parts)

    def _get_security_prompt(self) -> str:
        """Append security cognition to the effective system prompt."""
        if not self.SECURITY_ENABLED:
            return ""
        return get_security_prompt_for_lobster(self.role_id)

    async def _log_security_event(self, event_type: str, data: dict[str, Any]) -> None:
        """Best-effort audit record for security events."""
        try:
            from audit_logger import record_audit_log

            await record_audit_log(
                tenant_id=self.tenant_id,
                user_id=self.role_id,
                operator=self.role_id,
                action=event_type,
                category="security",
                resource_type="lobster",
                resource_id=str(data.get("task_id") or ""),
                summary=f"{self.role_id}:{event_type}",
                detail=data,
                result="blocked" if event_type == "redline_triggered" else "warning",
                source="lobster_security",
                trace_id=str(data.get("trace_id") or data.get("task_id") or ""),
            )
        except Exception:
            pass

    def heartbeat_ping(self) -> None:
        """Record a runtime heartbeat."""
        self.working["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save_working(self.role_id, self.working)

    def bind_runtime_context(self, tenant_id: str) -> None:
        """Rebind tenant-scoped resources such as file memory."""
        from lobsters.lobster_memory import LobsterMemory

        normalized = str(tenant_id or self.tenant_id).strip() or self.tenant_id
        if normalized == self.tenant_id and getattr(self, "memory", None) is not None:
            return
        self.tenant_id = normalized
        self.memory = LobsterMemory(self.role_id, self.tenant_id)

    async def mcp_call(self, server_id: str, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Invoke an MCP tool through the shared MCP gateway."""
        from mcp_gateway import get_mcp_gateway

        gateway = get_mcp_gateway()
        return await gateway.call_tool(
            server_id,
            tool_name,
            args,
            lobster_id=self.role_id,
            tenant_id=self.tenant_id,
        )

    async def invoke_structured(self, user_input: str, *, output_model: Any | None = None) -> dict[str, Any]:
        from llm_router import llm_router
        from lobster_output_schemas import get_output_schema_for_lobster
        from lobster_runner import LobsterRunSpec, LobsterRunner

        runner = LobsterRunner(llm_router)
        spec = LobsterRunSpec(
            role_id=self.role_id,
            system_prompt=self.system_prompt_full,
            user_prompt=str(user_input or ""),
            lobster=self,
            model_override=None,
            tools=None,
            meta={"tenant_id": self.tenant_id},
        )
        model = output_model or get_output_schema_for_lobster(self.role_id)
        if model is None:
            result = await runner.run(spec)
            return {"final_content": result.final_content, "stop_reason": result.stop_reason, "error": result.error}
        parsed = await runner.run_structured_output(spec, output_model=model)
        return parsed.model_dump()

    async def invoke(self, user_input: str) -> dict[str, Any]:
        try:
            return await self.invoke_structured(user_input)
        except Exception as exc:  # noqa: BLE001
            return {"_error": str(exc), "_fallback": True, "lobster_id": self.role_id}

    def agent_log(self, summary: str, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Create a standardized log entry for this lobster."""
        entry: dict[str, Any] = {
            "agent": self.role_id,
            "display_name": self.display_name,
            "zh_name": self.zh_name,
            "summary": summary,
        }
        if payload:
            entry["detail"] = payload
        return [entry]

    def __repr__(self) -> str:
        return f"<Lobster:{self.role_id} ({self.zh_name})>"
