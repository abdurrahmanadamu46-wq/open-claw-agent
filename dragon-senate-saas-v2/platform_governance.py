"""
platform_governance.py — 平台治理服务（Policy Limits + Feature Gating）
=========================================================================
灵感来源：cccback-master services/policyLimits/index.ts + main.tsx

核心升级：
  把现有分散的 strategy_intensity / autonomy_policy / approval / tenant_settings
  统一成"平台治理服务"，提供单一的 capability matrix 接口。

  - Feature Gate   : 功能特性开关（按租户/用户/角色）
  - Policy Limits  : 资源使用上限（按操作类型/租户级别）
  - Capability Matrix: 统一能力可见性矩阵（前端直接消费）
  - Remote Managed : 支持云端远程推送配置更新（ETag + background refresh）
  - Analytics Guard: 字段分级，敏感字段绝不进日志

架构：
  cloud control plane → PlatformGovernanceService → dragon-senate 各模块

集成点：
  lobster_runner.py       → _resolve_autonomy_policy 替换为 governance.check
  commander_graph_builder → 路由前查询 capability matrix
  前端 /api/governance    → 返回 capability matrix
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Literal

logger = logging.getLogger("platform_governance")


# ────────────────────────────────────────────────────────────────────
# 类型定义
# ────────────────────────────────────────────────────────────────────

FeatureKey = Literal[
    # 执行能力
    "parallel_lobsters",        # 并行龙虾（最大并发数）
    "background_execution",     # 后台执行
    "autonomous_publishing",    # 自主发布（无需人工确认）
    "bulk_operations",          # 批量操作
    # 分析能力
    "roi_analysis",             # ROI 分析（abacus deep）
    "multi_touch_attribution",  # 多触点归因
    "team_memory_sync",         # 团队记忆同步
    # 高级功能
    "skill_marketplace",        # 技能市场
    "custom_skills",            # 自定义技能
    "api_access",               # API 直连
    "white_label",              # 白标
    # 安全
    "dlp_scan",                 # 数据防泄露扫描
    "audit_export",             # 审计日志导出
]

TenantTier = Literal["basic", "growth", "enterprise", "internal"]


# ────────────────────────────────────────────────────────────────────
# Feature Gate 定义
# ────────────────────────────────────────────────────────────────────

@dataclass
class FeatureGate:
    """
    单个功能特性的开关定义（仿 cccback feature gate）

    fail_open: True = 判断失败时默认放行（非关键功能）
               False = 判断失败时默认拦截（安全相关）
    """
    key: str
    enabled_tiers: list[TenantTier]
    description: str = ""
    fail_open: bool = True
    max_value: int | None = None  # 数值型限制（如最大并发数）

    def is_enabled_for(self, tenant_tier: str) -> bool:
        if not self.enabled_tiers:
            return self.fail_open
        return tenant_tier in self.enabled_tiers

    def get_max_value_for(self, tenant_tier: str) -> int | None:
        """不同租户级别可能有不同的数值上限"""
        if not self.is_enabled_for(tenant_tier):
            return 0
        return self.max_value


# ────────────────────────────────────────────────────────────────────
# Policy Limits — 资源使用上限
# ────────────────────────────────────────────────────────────────────

@dataclass
class PolicyLimits:
    """
    资源使用上限（仿 cccback policyLimits/index.ts）

    所有限制均按 tenant_tier 分层：
    basic < growth < enterprise
    """
    tenant_tier: TenantTier = "basic"

    # 龙虾并发
    max_parallel_lobsters: int = 1
    max_background_tasks: int = 0

    # 每日操作上限
    max_daily_posts: int = 10
    max_daily_dms: int = 0
    max_daily_comments: int = 20
    max_daily_llm_calls: int = 100

    # Token 预算
    max_tokens_per_session: int = 50_000
    max_tokens_per_month: int = 500_000

    # 审批要求
    require_approval_for_publish: bool = True
    require_approval_for_dms: bool = True
    require_approval_for_bulk: bool = True

    # 功能开关
    skill_marketplace_enabled: bool = False
    custom_skills_enabled: bool = False
    api_access_enabled: bool = False
    team_memory_enabled: bool = False

    @classmethod
    def for_tier(cls, tier: str) -> "PolicyLimits":
        """根据租户级别返回对应的 policy limits"""
        tier = tier or "basic"
        if tier == "enterprise" or tier == "internal":
            return cls(
                tenant_tier=tier,  # type: ignore[arg-type]
                max_parallel_lobsters=5,
                max_background_tasks=10,
                max_daily_posts=200,
                max_daily_dms=100,
                max_daily_comments=500,
                max_daily_llm_calls=2000,
                max_tokens_per_session=150_000,
                max_tokens_per_month=5_000_000,
                require_approval_for_publish=False,
                require_approval_for_dms=True,
                require_approval_for_bulk=False,
                skill_marketplace_enabled=True,
                custom_skills_enabled=True,
                api_access_enabled=True,
                team_memory_enabled=True,
            )
        elif tier == "growth":
            return cls(
                tenant_tier="growth",
                max_parallel_lobsters=3,
                max_background_tasks=5,
                max_daily_posts=50,
                max_daily_dms=20,
                max_daily_comments=100,
                max_daily_llm_calls=500,
                max_tokens_per_session=100_000,
                max_tokens_per_month=2_000_000,
                require_approval_for_publish=False,
                require_approval_for_dms=True,
                require_approval_for_bulk=True,
                skill_marketplace_enabled=True,
                custom_skills_enabled=False,
                api_access_enabled=False,
                team_memory_enabled=True,
            )
        else:  # basic
            return cls(
                tenant_tier="basic",
                max_parallel_lobsters=1,
                max_background_tasks=0,
                max_daily_posts=10,
                max_daily_dms=0,
                max_daily_comments=20,
                max_daily_llm_calls=100,
                max_tokens_per_session=50_000,
                max_tokens_per_month=500_000,
                require_approval_for_publish=True,
                require_approval_for_dms=True,
                require_approval_for_bulk=True,
                skill_marketplace_enabled=False,
                custom_skills_enabled=False,
                api_access_enabled=False,
                team_memory_enabled=False,
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_tier": self.tenant_tier,
            "max_parallel_lobsters": self.max_parallel_lobsters,
            "max_background_tasks": self.max_background_tasks,
            "max_daily_posts": self.max_daily_posts,
            "max_daily_dms": self.max_daily_dms,
            "max_daily_comments": self.max_daily_comments,
            "max_daily_llm_calls": self.max_daily_llm_calls,
            "max_tokens_per_session": self.max_tokens_per_session,
            "max_tokens_per_month": self.max_tokens_per_month,
            "require_approval_for_publish": self.require_approval_for_publish,
            "require_approval_for_dms": self.require_approval_for_dms,
            "require_approval_for_bulk": self.require_approval_for_bulk,
            "skill_marketplace_enabled": self.skill_marketplace_enabled,
            "custom_skills_enabled": self.custom_skills_enabled,
            "api_access_enabled": self.api_access_enabled,
            "team_memory_enabled": self.team_memory_enabled,
        }


# ────────────────────────────────────────────────────────────────────
# Capability Matrix — 统一能力可见性矩阵
# ────────────────────────────────────────────────────────────────────

@dataclass
class CapabilityEntry:
    """单个能力的可见性记录"""
    key: str
    enabled: bool
    reason: str = ""
    max_value: int | None = None
    upgrade_required: str | None = None  # 需要升级到哪个 tier


@dataclass
class CapabilityMatrix:
    """
    统一能力可见性矩阵（前端直接消费）

    前端不直接看某个字段，而是看这个矩阵。
    这确保：云端大脑和控制台共享同一治理真相源。
    """
    tenant_id: str
    tenant_tier: TenantTier
    capabilities: dict[str, CapabilityEntry] = field(default_factory=dict)
    generated_at: float = field(default_factory=time.time)
    etag: str = ""

    def is_enabled(self, key: str) -> bool:
        entry = self.capabilities.get(key)
        return entry.enabled if entry else False

    def get_max(self, key: str) -> int | None:
        entry = self.capabilities.get(key)
        return entry.max_value if entry else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "tenant_tier": self.tenant_tier,
            "generated_at": self.generated_at,
            "etag": self.etag,
            "capabilities": {
                k: {
                    "enabled": v.enabled,
                    "reason": v.reason,
                    "max_value": v.max_value,
                    "upgrade_required": v.upgrade_required,
                }
                for k, v in self.capabilities.items()
            },
        }


# ────────────────────────────────────────────────────────────────────
# Analytics Field Guard — 敏感字段保护
# ────────────────────────────────────────────────────────────────────

# 绝不进入 analytics 的字段（仿 cccback analytics marker type）
_NEVER_LOG_FIELDS = frozenset({
    "password", "token", "api_key", "secret", "private_key",
    "cookie", "session_key", "access_token", "refresh_token",
    "phone", "mobile", "id_card", "bank_card",
    "wechat_id", "weibo_uid",
})

_SENSITIVE_FIELDS = frozenset({
    "account_id", "user_id", "tenant_id", "ip_address",
    "email", "name", "nickname",
})


def sanitize_analytics_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """
    清理 analytics 上报字段，移除敏感数据。
    仿 cccback analytics/index.ts 的 marker type 强制检查。
    """
    result: dict[str, Any] = {}
    for key, value in payload.items():
        key_lower = key.lower()
        if any(nf in key_lower for nf in _NEVER_LOG_FIELDS):
            continue  # 完全排除
        if any(sf in key_lower for sf in _SENSITIVE_FIELDS):
            # 敏感字段：哈希处理
            result[key] = hashlib.sha256(str(value).encode()).hexdigest()[:12]
        else:
            result[key] = value
    return result


# ────────────────────────────────────────────────────────────────────
# PlatformGovernanceService — 核心服务
# ────────────────────────────────────────────────────────────────────

class PlatformGovernanceService:
    """
    平台治理服务（仿 cccback policyLimits + feature gate + remote managed settings）

    职责：
    1. 根据 tenant_tier 生成 capability matrix
    2. 支持云端远程配置覆盖（ETag + background refresh）
    3. 提供统一的 check() 接口（替代分散的 if/else）
    4. 保护 analytics 字段（敏感数据不进日志）

    使用方式：
        gov = get_governance_service()

        # 检查某个能力是否可用
        ok, reason = gov.check("autonomous_publishing", tenant_id="t1", tenant_tier="basic")

        # 获取完整矩阵（供前端使用）
        matrix = gov.get_capability_matrix("t1", "growth")

        # 检查操作是否需要审批
        needs = gov.requires_approval("publish", tenant_id="t1", tenant_tier="basic")
    """

    def __init__(self) -> None:
        # 远程覆盖配置（云端推送）
        self._remote_overrides: dict[str, dict[str, Any]] = {}
        self._etag_cache: dict[str, str] = {}
        self._last_refresh: float = 0.0

    # ── 核心检查接口 ─────────────────────────────────────────────────

    def check(
        self,
        feature_key: str,
        *,
        tenant_id: str,
        tenant_tier: str,
        action_count: int = 0,
    ) -> tuple[bool, str]:
        """
        统一能力检查入口。

        Returns:
            (enabled, reason)
        """
        # 优先使用远程覆盖
        override = self._remote_overrides.get(tenant_id, {}).get(feature_key)
        if override is not None:
            enabled = bool(override.get("enabled", True))
            return enabled, f"remote_override: {override.get('reason', '')}"

        # 根据 tier 检查
        limits = PolicyLimits.for_tier(tenant_tier)
        return self._check_by_limits(feature_key, limits, action_count)

    def _check_by_limits(
        self,
        feature_key: str,
        limits: PolicyLimits,
        action_count: int = 0,
    ) -> tuple[bool, str]:
        """基于 PolicyLimits 检查"""
        checks: dict[str, tuple[bool, str]] = {
            "parallel_lobsters": (
                limits.max_parallel_lobsters > 1,
                f"max_parallel={limits.max_parallel_lobsters}",
            ),
            "background_execution": (
                limits.max_background_tasks > 0,
                f"max_background={limits.max_background_tasks}",
            ),
            "autonomous_publishing": (
                not limits.require_approval_for_publish,
                "publish_requires_approval" if limits.require_approval_for_publish else "ok",
            ),
            "bulk_operations": (
                not limits.require_approval_for_bulk,
                "bulk_requires_approval" if limits.require_approval_for_bulk else "ok",
            ),
            "roi_analysis": (
                limits.tenant_tier in ("growth", "enterprise", "internal"),
                f"requires_growth_tier, current={limits.tenant_tier}",
            ),
            "team_memory_sync": (
                limits.team_memory_enabled,
                "team_memory_not_enabled" if not limits.team_memory_enabled else "ok",
            ),
            "skill_marketplace": (
                limits.skill_marketplace_enabled,
                "marketplace_not_enabled" if not limits.skill_marketplace_enabled else "ok",
            ),
            "custom_skills": (
                limits.custom_skills_enabled,
                "custom_skills_not_enabled" if not limits.custom_skills_enabled else "ok",
            ),
            "api_access": (
                limits.api_access_enabled,
                "api_not_enabled" if not limits.api_access_enabled else "ok",
            ),
            "dlp_scan": (True, "always_enabled"),
            "audit_export": (
                limits.tenant_tier in ("enterprise", "internal"),
                f"requires_enterprise, current={limits.tenant_tier}",
            ),
        }
        result = checks.get(feature_key, (True, "unknown_feature_fail_open"))
        return result

    def requires_approval(
        self,
        action_type: str,
        *,
        tenant_id: str,
        tenant_tier: str,
    ) -> bool:
        """检查指定操作类型是否需要人工审批"""
        limits = PolicyLimits.for_tier(tenant_tier)

        # 远程覆盖
        override = self._remote_overrides.get(tenant_id, {}).get(f"require_approval_{action_type}")
        if override is not None:
            return bool(override.get("enabled", True))

        approval_map = {
            "publish": limits.require_approval_for_publish,
            "posts": limits.require_approval_for_publish,
            "dms": limits.require_approval_for_dms,
            "bulk": limits.require_approval_for_bulk,
            "comments": False,  # 评论回复通常不需要审批
            "analytics": False,
            "research": False,
        }
        return approval_map.get(action_type, False)

    # ── Capability Matrix ─────────────────────────────────────────────

    def get_capability_matrix(
        self,
        tenant_id: str,
        tenant_tier: str,
    ) -> CapabilityMatrix:
        """
        生成完整的能力可见性矩阵（前端直接消费）。
        云端大脑和控制台共享同一治理真相源。
        """
        limits = PolicyLimits.for_tier(tenant_tier)
        capabilities: dict[str, CapabilityEntry] = {}

        feature_definitions = [
            ("parallel_lobsters", f"并行龙虾（最大 {limits.max_parallel_lobsters}）",
             limits.max_parallel_lobsters > 1, limits.max_parallel_lobsters, "growth"),
            ("background_execution", "后台执行",
             limits.max_background_tasks > 0, limits.max_background_tasks, "growth"),
            ("autonomous_publishing", "自主发布（无需确认）",
             not limits.require_approval_for_publish, None, "growth"),
            ("bulk_operations", "批量操作",
             not limits.require_approval_for_bulk, None, "growth"),
            ("roi_analysis", "ROI深度分析",
             limits.tenant_tier in ("growth", "enterprise", "internal"), None, "growth"),
            ("multi_touch_attribution", "多触点归因",
             limits.tenant_tier in ("enterprise", "internal"), None, "enterprise"),
            ("team_memory_sync", "团队记忆同步",
             limits.team_memory_enabled, None, "growth"),
            ("skill_marketplace", "技能市场",
             limits.skill_marketplace_enabled, None, "growth"),
            ("custom_skills", "自定义技能",
             limits.custom_skills_enabled, None, "enterprise"),
            ("api_access", "API 直连",
             limits.api_access_enabled, None, "enterprise"),
            ("white_label", "白标部署",
             limits.tenant_tier == "internal", None, "enterprise"),
            ("dlp_scan", "数据防泄露扫描", True, None, None),
            ("audit_export", "审计日志导出",
             limits.tenant_tier in ("enterprise", "internal"), None, "enterprise"),
        ]

        for key, desc, enabled, max_val, upgrade_tier in feature_definitions:
            # 应用远程覆盖
            override = self._remote_overrides.get(tenant_id, {}).get(key)
            if override is not None:
                enabled = bool(override.get("enabled", enabled))

            capabilities[key] = CapabilityEntry(
                key=key,
                enabled=enabled,
                reason=desc,
                max_value=max_val,
                upgrade_required=upgrade_tier if not enabled else None,
            )

        # 计算 ETag（内容哈希，用于客户端缓存）
        content_str = str({k: v.enabled for k, v in capabilities.items()})
        etag = hashlib.md5(content_str.encode()).hexdigest()[:16]

        return CapabilityMatrix(
            tenant_id=tenant_id,
            tenant_tier=tenant_tier,  # type: ignore[arg-type]
            capabilities=capabilities,
            etag=etag,
        )

    # ── 远程配置覆盖（云端推送）─────────────────────────────────────

    def apply_remote_override(
        self,
        tenant_id: str,
        overrides: dict[str, Any],
    ) -> None:
        """
        应用云端推送的配置覆盖（仿 cccback remote managed settings）

        overrides 格式：
        {
            "autonomous_publishing": {"enabled": true, "reason": "special_trial"},
            "bulk_operations": {"enabled": false, "reason": "risk_control"},
        }
        """
        if tenant_id not in self._remote_overrides:
            self._remote_overrides[tenant_id] = {}
        self._remote_overrides[tenant_id].update(overrides)
        logger.info(
            "[Governance] 远程配置更新 tenant=%s keys=%s",
            tenant_id, list(overrides.keys()),
        )

    def clear_remote_overrides(self, tenant_id: str) -> None:
        """清除指定租户的远程覆盖"""
        self._remote_overrides.pop(tenant_id, None)

    # ── Analytics 保护 ────────────────────────────────────────────────

    def sanitize_for_analytics(self, payload: dict[str, Any]) -> dict[str, Any]:
        """清理 analytics 字段，排除敏感数据"""
        return sanitize_analytics_payload(payload)


# ── 全局单例 ─────────────────────────────────────────────────────────

_global_governance: PlatformGovernanceService | None = None


def get_governance_service() -> PlatformGovernanceService:
    """获取平台治理服务单例"""
    global _global_governance
    if _global_governance is None:
        _global_governance = PlatformGovernanceService()
    return _global_governance
