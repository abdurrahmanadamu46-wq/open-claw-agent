# CODEX TASK: MANIFEST P1 任务包
> 来源借鉴：https://github.com/mnfst/manifest
> 优先级：P1（商业化关键）
> 生成日期：2026-04-02

---

## M-P1-1：LLM 请求智能质量评分路由器

### 背景
借鉴 Manifest 的 Quality Score 机制。当前所有龙虾调用 LLM 时都走同一个 ProviderRegistry profile，
无法按任务复杂度自动选择最优性价比模型。

### 目标文件
`dragon-senate-saas-v2/smart_router.py`

### 完整代码

```python
"""
smart_router.py — 龙虾智能 LLM 路由器
借鉴 Manifest Quality Score 机制：按请求复杂度动态路由到性价比最优模型
预估节省：30-50% LLM 成本
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum
import re


class RouteTier(str, Enum):
    ECONOMY = "economy"      # 快速廉价：GPT-4o-mini / gemini-flash
    STANDARD = "standard"    # 均衡：GPT-4o / claude-3-haiku
    PREMIUM = "premium"      # 强力：claude-3-5-sonnet / GPT-4o-latest


@dataclass
class RouteDecision:
    tier: RouteTier
    provider_profile: str
    complexity_score: float
    reason: str
    estimated_cost_multiplier: float  # 1.0 = economy 基准

    def to_dict(self) -> dict:
        return {
            "tier": self.tier.value,
            "provider_profile": self.provider_profile,
            "complexity_score": round(self.complexity_score, 3),
            "reason": self.reason,
            "estimated_cost_multiplier": self.estimated_cost_multiplier,
        }


# 10只龙虾的默认 Tier 配置（可被 DB 动态覆盖）
LOBSTER_DEFAULT_TIER: dict[str, RouteTier] = {
    "commander":  RouteTier.PREMIUM,   # 编排决策，需要最强推理
    "radar":      RouteTier.STANDARD,  # 信号搜索，中等复杂
    "strategist": RouteTier.PREMIUM,   # 4视角分析，复杂
    "inkwriter":  RouteTier.STANDARD,  # 文案生成，中等
    "visualizer": RouteTier.STANDARD,  # 分镜设计，中等
    "dispatcher": RouteTier.ECONOMY,   # 执行调度，规则化任务
    "echoer":     RouteTier.ECONOMY,   # 回复话术，简单重复
    "catcher":    RouteTier.STANDARD,  # 线索评分，中等
    "abacus":     RouteTier.STANDARD,  # ROI 计算，中等
    "followup":   RouteTier.ECONOMY,   # 跟进话术，简单模板
}

TIER_TO_PROFILE = {
    RouteTier.ECONOMY:  "fast",
    RouteTier.STANDARD: "default",
    RouteTier.PREMIUM:  "strong",
}

TIER_COST_MULTIPLIER = {
    RouteTier.ECONOMY:  1.0,
    RouteTier.STANDARD: 8.0,
    RouteTier.PREMIUM:  60.0,
}

# 复杂度信号权重（基于 Manifest Quality Score 思路扩展）
COMPLEXITY_SIGNALS = [
    # (正则/关键词, 权重, 描述)
    (r"分析|analysis|analyze|research|研究", 0.25, "分析类任务"),
    (r"策略|strategy|plan|规划|方案", 0.25, "策略制定"),
    (r"对比|compare|versus|竞品|竞争", 0.20, "对比分析"),
    (r"多步|step.by.step|分阶段|逐步", 0.15, "多步推理"),
    (r"为什么|why|原因|reason|逻辑", 0.15, "推理解释"),
    (r"优化|optimize|improve|提升效果", 0.10, "优化建议"),
    (r"模板|template|格式化|format", -0.15, "模板化任务（简单）"),
    (r"简单|quick|简短|brief|一句话", -0.20, "明确简单任务"),
    (r"是否|yes.no|确认|confirm|check", -0.15, "判断类（简单）"),
]


def compute_complexity_score(
    prompt: str,
    lobster_id: str,
    context_length: int = 0,
    tool_count: int = 0,
) -> float:
    """
    计算请求复杂度分数 [0.0, 1.0]

    因子：
    1. Prompt 关键词信号（±权重）
    2. Prompt 长度（越长越复杂）
    3. Context 长度（越长越复杂）
    4. 工具调用数量（越多越复杂）
    5. 龙虾角色基准分
    """
    # 1. 龙虾角色基准分
    base_tier = LOBSTER_DEFAULT_TIER.get(lobster_id, RouteTier.STANDARD)
    base_score = {
        RouteTier.ECONOMY: 0.15,
        RouteTier.STANDARD: 0.45,
        RouteTier.PREMIUM: 0.75,
    }[base_tier]

    # 2. Prompt 关键词信号
    keyword_score = 0.0
    prompt_lower = prompt.lower()
    for pattern, weight, _ in COMPLEXITY_SIGNALS:
        if re.search(pattern, prompt_lower, re.IGNORECASE):
            keyword_score += weight

    # 3. Prompt 长度归一化（500字以内低分，2000字以上高分）
    prompt_len = len(prompt)
    length_score = min(prompt_len / 2000, 1.0) * 0.2

    # 4. Context 长度
    context_score = min(context_length / 8000, 1.0) * 0.15

    # 5. 工具调用数量
    tool_score = min(tool_count / 5, 1.0) * 0.1

    raw_score = base_score + keyword_score + length_score + context_score + tool_score
    return max(0.0, min(1.0, raw_score))


def route(
    prompt: str,
    lobster_id: str,
    context_length: int = 0,
    tool_count: int = 0,
    force_tier: Optional[str] = None,
    per_lobster_override: Optional[dict] = None,
) -> RouteDecision:
    """
    主路由入口：返回路由决策

    Args:
        prompt: 当前请求的 Prompt 文本
        lobster_id: 龙虾 canonical_id（如 'strategist'）
        context_length: 上下文 token 数
        tool_count: 本次调用工具数量
        force_tier: 强制覆盖 tier（'economy'/'standard'/'premium'）
        per_lobster_override: 运营动态配置覆盖 {lobster_id: tier}

    Returns:
        RouteDecision
    """
    # 运营动态覆盖优先
    if per_lobster_override and lobster_id in per_lobster_override:
        tier = RouteTier(per_lobster_override[lobster_id])
        score = {RouteTier.ECONOMY: 0.15, RouteTier.STANDARD: 0.45, RouteTier.PREMIUM: 0.75}[tier]
        return RouteDecision(
            tier=tier,
            provider_profile=TIER_TO_PROFILE[tier],
            complexity_score=score,
            reason=f"运营覆盖配置：{lobster_id} → {tier.value}",
            estimated_cost_multiplier=TIER_COST_MULTIPLIER[tier],
        )

    # 强制 Tier 覆盖
    if force_tier:
        tier = RouteTier(force_tier)
        score = {RouteTier.ECONOMY: 0.15, RouteTier.STANDARD: 0.45, RouteTier.PREMIUM: 0.75}[tier]
        return RouteDecision(
            tier=tier,
            provider_profile=TIER_TO_PROFILE[tier],
            complexity_score=score,
            reason=f"强制 Tier 覆盖：{force_tier}",
            estimated_cost_multiplier=TIER_COST_MULTIPLIER[tier],
        )

    # 正常评分路由
    score = compute_complexity_score(prompt, lobster_id, context_length, tool_count)

    if score < 0.35:
        tier = RouteTier.ECONOMY
        reason = f"低复杂度（score={score:.2f}），使用经济模型"
    elif score < 0.65:
        tier = RouteTier.STANDARD
        reason = f"中等复杂度（score={score:.2f}），使用标准模型"
    else:
        tier = RouteTier.PREMIUM
        reason = f"高复杂度（score={score:.2f}），使用高性能模型"

    return RouteDecision(
        tier=tier,
        provider_profile=TIER_TO_PROFILE[tier],
        complexity_score=score,
        reason=reason,
        estimated_cost_multiplier=TIER_COST_MULTIPLIER[tier],
    )


# ─── 集成到 lobster_runner.py 的示例 ────────────────────────────────────────
#
# from smart_router import route
#
# def run_lobster(lobster_id, prompt, context_msgs, tools):
#     decision = route(
#         prompt=prompt,
#         lobster_id=lobster_id,
#         context_length=sum(len(m.get("content","")) for m in context_msgs),
#         tool_count=len(tools),
#     )
#     # 把 decision.provider_profile 传给 ProviderRegistry
#     llm = provider_registry.get(profile=decision.provider_profile)
#     # 记录路由决策到 LLM 调用日志
#     llm_call_logger.log_route_decision(lobster_id, decision.to_dict())
#     return llm.invoke(prompt)
```

---

## M-P1-2：龙虾预算通知系统

### 背景
借鉴 Manifest 的 `NotificationCronService` + `LimitCheckService`。
当前无任何 LLM 成本预警，商业化后客户意外超支是致命风险。

### 目标文件
`dragon-senate-saas-v2/lobster_budget_alert.py`

### 完整代码

```python
"""
lobster_budget_alert.py — 龙虾预算告警系统
借鉴 Manifest NotificationCronService + LimitCheckService
功能：
  1. 每只龙虾设置月度预算上限（USD）
  2. 后台定时检查消耗（每小时）
  3. 超 80% 发告警，超 100% 阻断并通知
"""

from __future__ import annotations
import time
import threading
import logging
from dataclasses import dataclass, field
from typing import Optional, Callable
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)


class AlertLevel(str, Enum):
    WARNING = "warning"    # 超过 80%
    CRITICAL = "critical"  # 超过 95%
    BLOCKED = "blocked"    # 超过 100%，请求被阻断


@dataclass
class LobsterBudget:
    lobster_id: str
    tenant_id: str
    monthly_limit_usd: float          # 月度预算上限
    current_month_cost_usd: float = 0.0  # 当月已消耗
    alert_threshold_pct: float = 0.80    # 预警阈值（默认 80%）
    block_threshold_pct: float = 1.00    # 阻断阈值（默认 100%）
    last_alert_level: Optional[AlertLevel] = None
    last_alert_time: Optional[datetime] = None

    @property
    def usage_pct(self) -> float:
        if self.monthly_limit_usd <= 0:
            return 0.0
        return self.current_month_cost_usd / self.monthly_limit_usd

    @property
    def is_blocked(self) -> bool:
        return self.usage_pct >= self.block_threshold_pct

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.monthly_limit_usd - self.current_month_cost_usd)


@dataclass
class BudgetAlert:
    lobster_id: str
    tenant_id: str
    level: AlertLevel
    usage_pct: float
    current_cost_usd: float
    monthly_limit_usd: float
    remaining_usd: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_message(self) -> str:
        emoji = {"warning": "⚠️", "critical": "🔴", "blocked": "🚫"}[self.level.value]
        return (
            f"{emoji} [{self.tenant_id}] {self.lobster_id} 预算告警\n"
            f"  级别: {self.level.value.upper()}\n"
            f"  已消耗: ${self.current_cost_usd:.4f} / ${self.monthly_limit_usd:.2f} "
            f"({self.usage_pct*100:.1f}%)\n"
            f"  剩余: ${self.remaining_usd:.4f}\n"
            f"  时间: {self.timestamp.strftime('%Y-%m-%d %H:%M UTC')}"
        )


class LobsterBudgetAlert:
    """
    龙虾预算告警管理器

    使用方式：
        alert_mgr = LobsterBudgetAlert(cost_fetcher=my_cost_fn, notifier=my_notify_fn)
        alert_mgr.set_budget("strategist", "tenant_001", monthly_limit_usd=100.0)
        alert_mgr.start_cron(interval_seconds=3600)  # 每小时检查
    """

    def __init__(
        self,
        cost_fetcher: Callable[[str, str, str, str], float],
        notifier: Callable[[BudgetAlert], None],
        check_interval_seconds: int = 3600,
    ):
        """
        Args:
            cost_fetcher: fn(tenant_id, lobster_id, year_month) -> current_cost_usd
            notifier: fn(BudgetAlert) -> None（发邮件/IM/日志）
            check_interval_seconds: 检查周期（默认每小时）
        """
        self._budgets: dict[str, LobsterBudget] = {}  # key: f"{tenant_id}:{lobster_id}"
        self._cost_fetcher = cost_fetcher
        self._notifier = notifier
        self._interval = check_interval_seconds
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

    def _budget_key(self, tenant_id: str, lobster_id: str) -> str:
        return f"{tenant_id}:{lobster_id}"

    def set_budget(
        self,
        lobster_id: str,
        tenant_id: str,
        monthly_limit_usd: float,
        alert_threshold_pct: float = 0.80,
        block_threshold_pct: float = 1.00,
    ) -> None:
        key = self._budget_key(tenant_id, lobster_id)
        with self._lock:
            self._budgets[key] = LobsterBudget(
                lobster_id=lobster_id,
                tenant_id=tenant_id,
                monthly_limit_usd=monthly_limit_usd,
                alert_threshold_pct=alert_threshold_pct,
                block_threshold_pct=block_threshold_pct,
            )

    def check_before_call(self, tenant_id: str, lobster_id: str) -> tuple[bool, str]:
        """
        龙虾调用 LLM 前的限额检查（同步守门员）
        Returns: (allowed: bool, reason: str)
        """
        key = self._budget_key(tenant_id, lobster_id)
        budget = self._budgets.get(key)
        if budget is None:
            return True, "无预算限制"
        if budget.is_blocked:
            return False, (
                f"{lobster_id} 月度预算已耗尽 "
                f"(${budget.current_month_cost_usd:.4f}/${budget.monthly_limit_usd:.2f})"
            )
        return True, "预算充足"

    def record_cost(self, tenant_id: str, lobster_id: str, cost_usd: float) -> None:
        """每次 LLM 调用完成后记录成本"""
        key = self._budget_key(tenant_id, lobster_id)
        with self._lock:
            budget = self._budgets.get(key)
            if budget:
                budget.current_month_cost_usd += cost_usd
                self._check_thresholds(budget)

    def _check_thresholds(self, budget: LobsterBudget) -> None:
        """检查阈值并触发告警"""
        pct = budget.usage_pct
        now = datetime.now(timezone.utc)

        if pct >= budget.block_threshold_pct:
            level = AlertLevel.BLOCKED
        elif pct >= 0.95:
            level = AlertLevel.CRITICAL
        elif pct >= budget.alert_threshold_pct:
            level = AlertLevel.WARNING
        else:
            return  # 正常范围

        # 避免重复告警（同级别 1 小时内不重复发）
        if (
            budget.last_alert_level == level
            and budget.last_alert_time
            and (now - budget.last_alert_time).total_seconds() < 3600
        ):
            return

        alert = BudgetAlert(
            lobster_id=budget.lobster_id,
            tenant_id=budget.tenant_id,
            level=level,
            usage_pct=pct,
            current_cost_usd=budget.current_month_cost_usd,
            monthly_limit_usd=budget.monthly_limit_usd,
            remaining_usd=budget.remaining_usd,
        )
        budget.last_alert_level = level
        budget.last_alert_time = now
        logger.warning(alert.to_message())

        try:
            self._notifier(alert)
        except Exception as e:
            logger.error(f"告警发送失败: {e}")

    def run_cron_check(self) -> None:
        """定时检查：从数据库重新拉取当月消耗并更新"""
        year_month = datetime.now(timezone.utc).strftime("%Y-%m")
        with self._lock:
            budgets = list(self._budgets.values())

        for budget in budgets:
            try:
                cost = self._cost_fetcher(budget.tenant_id, budget.lobster_id, year_month)
                with self._lock:
                    budget.current_month_cost_usd = cost
                    self._check_thresholds(budget)
            except Exception as e:
                logger.error(f"拉取消耗失败 {budget.tenant_id}/{budget.lobster_id}: {e}")

    def start_cron(self, interval_seconds: Optional[int] = None) -> None:
        """启动后台定时检查"""
        interval = interval_seconds or self._interval

        def _tick():
            self.run_cron_check()
            self._timer = threading.Timer(interval, _tick)
            self._timer.daemon = True
            self._timer.start()

        self._timer = threading.Timer(interval, _tick)
        self._timer.daemon = True
        self._timer.start()
        logger.info(f"龙虾预算告警 Cron 已启动，检查周期: {interval}s")

    def stop_cron(self) -> None:
        if self._timer:
            self._timer.cancel()


# ─── FastAPI 路由集成示例 ────────────────────────────────────────────────────
#
# from fastapi import APIRouter, HTTPException
# from lobster_budget_alert import LobsterBudgetAlert, BudgetAlert
#
# router = APIRouter(prefix="/api/budget", tags=["budget"])
#
# @router.post("/set")
# def set_budget(tenant_id: str, lobster_id: str, monthly_limit_usd: float):
#     alert_mgr.set_budget(lobster_id, tenant_id, monthly_limit_usd)
#     return {"ok": True}
#
# @router.get("/status/{tenant_id}/{lobster_id}")
# def get_status(tenant_id: str, lobster_id: str):
#     budget = alert_mgr._budgets.get(f"{tenant_id}:{lobster_id}")
#     if not budget:
#         raise HTTPException(404, "未设置预算")
#     return {
#         "usage_pct": budget.usage_pct,
#         "current_cost_usd": budget.current_month_cost_usd,
#         "monthly_limit_usd": budget.monthly_limit_usd,
#         "is_blocked": budget.is_blocked,
#     }
```

---

## M-P1-3：API Key AES 加密金库

### 背景
借鉴 Manifest 的两阶段 API Key 安全升级（哈希 + AES 加密）。
商业化后客户的 LLM API Key 明文存储是法律风险。

### 目标文件
`dragon-senate-saas-v2/api_key_vault.py`

### 完整代码

```python
"""
api_key_vault.py — API Key 安全金库
借鉴 Manifest 两阶段安全升级：
  Phase 1: bcrypt 哈希校验（无法逆向，用于认证）
  Phase 2: AES-256-GCM 加密存储（可解密，用于代理转发）
"""

from __future__ import annotations
import os
import base64
import hashlib
import secrets
import hmac
from typing import Optional


# AES 加密（使用 cryptography 库）
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False


class ApiKeyVault:
    """
    API Key 安全管理器

    用途1：存储客户的 LLM Provider API Key（需要解密后代理转发）
           → 使用 AES-256-GCM 可逆加密
    用途2：存储我们自己平台的 API Key（只需校验）
           → 使用 HMAC-SHA256 哈希（不可逆）

    主密钥从环境变量 VAULT_MASTER_KEY 读取（32字节 hex）
    """

    def __init__(self, master_key: Optional[str] = None):
        raw = master_key or os.environ.get("VAULT_MASTER_KEY", "")
        if len(raw) == 64:  # hex
            self._master_key = bytes.fromhex(raw)
        elif len(raw) == 32:  # raw bytes
            self._master_key = raw.encode()
        else:
            # 开发模式：生成随机密钥（生产环境必须设置环境变量）
            self._master_key = secrets.token_bytes(32)
            if not master_key:
                import warnings
                warnings.warn(
                    "VAULT_MASTER_KEY 未设置，使用随机密钥（重启后失效，生产环境禁止此行为）",
                    RuntimeWarning, stacklevel=2,
                )

    # ── AES-256-GCM 可逆加密（存储 LLM Provider Key）────────────────────────

    def encrypt_provider_key(self, plaintext: str) -> str:
        """
        AES-256-GCM 加密，返回 base64 编码的 nonce+ciphertext
        格式：base64(nonce[12] + tag[16] + ciphertext)
        """
        if not HAS_CRYPTOGRAPHY:
            raise RuntimeError("需要安装 cryptography 库：pip install cryptography")

        nonce = secrets.token_bytes(12)  # GCM 标准 nonce 长度
        aesgcm = AESGCM(self._master_key)
        ct_with_tag = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
        blob = nonce + ct_with_tag
        return base64.b64encode(blob).decode("ascii")

    def decrypt_provider_key(self, encrypted: str) -> str:
        """解密 LLM Provider API Key"""
        if not HAS_CRYPTOGRAPHY:
            raise RuntimeError("需要安装 cryptography 库：pip install cryptography")

        blob = base64.b64decode(encrypted.encode("ascii"))
        nonce = blob[:12]
        ct_with_tag = blob[12:]
        aesgcm = AESGCM(self._master_key)
        plaintext = aesgcm.decrypt(nonce, ct_with_tag, None)
        return plaintext.decode("utf-8")

    def mask_key(self, plaintext: str, visible_chars: int = 4) -> str:
        """
        返回脱敏展示字符串（前几位可见 + *** + 后几位可见）
        如：sk-abc***xyz
        """
        if len(plaintext) <= visible_chars * 2:
            return "***"
        prefix = plaintext[:visible_chars]
        suffix = plaintext[-visible_chars:]
        return f"{prefix}***{suffix}"

    # ── HMAC-SHA256 不可逆哈希（存储平台自身 API Key）──────────────────────

    def hash_platform_key(self, plaintext: str) -> str:
        """
        HMAC-SHA256 哈希，用于平台 API Key 校验
        返回格式：hmac-sha256:{hex_digest}
        """
        h = hmac.new(self._master_key, plaintext.encode("utf-8"), hashlib.sha256)
        return f"hmac-sha256:{h.hexdigest()}"

    def verify_platform_key(self, plaintext: str, stored_hash: str) -> bool:
        """校验平台 API Key"""
        if not stored_hash.startswith("hmac-sha256:"):
            return False
        expected = self.hash_platform_key(plaintext)
        return hmac.compare_digest(expected, stored_hash)

    # ── 辅助方法 ─────────────────────────────────────────────────────────────

    @staticmethod
    def generate_platform_key(prefix: str = "oc") -> str:
        """生成新的平台 API Key，格式：oc-{32字节hex}"""
        return f"{prefix}-{secrets.token_hex(32)}"


# ─── 使用示例 ────────────────────────────────────────────────────────────────
#
# vault = ApiKeyVault()
#
# # 存储客户的 OpenAI Key（可逆）
# encrypted = vault.encrypt_provider_key("sk-real-openai-key-here")
# # 写入 DB: provider_configs.api_key_encrypted = encrypted
#
# # 代理转发时解密
# real_key = vault.decrypt_provider_key(encrypted)
# # 展示给用户（脱敏）
# masked = vault.mask_key(real_key)  # → "sk-re***ere"
#
# # 生成并存储平台 API Key（不可逆）
# raw_key = ApiKeyVault.generate_platform_key()
# hashed = vault.hash_platform_key(raw_key)
# # 写入 DB: api_keys.key_hash = hashed
# # 下次校验：vault.verify_platform_key(user_input, hashed)
```

---

## M-P1-4：龙虾维度成本分析 API

### 背景
借鉴 Manifest 的 `agent-analytics` 模块，按 Agent（龙虾）维度提供 Token 消耗、成本、趋势数据。
运营可以看到每只龙虾每天/每周花了多少钱，哪次调用最贵。

### 目标文件
`dragon-senate-saas-v2/lobster_cost_api.py`

### 完整代码

```python
"""
lobster_cost_api.py — 龙虾维度成本分析 API
借鉴 Manifest analytics 模块：按 Agent 维度聚合 token/cost 数据
提供：
  - 每只龙虾的成本汇总（带环比趋势）
  - 时序消耗数据（支持 1d/7d/30d）
  - 最贵的单次调用 Top10
  - 租户级别成本预算使用率
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone, timedelta
from enum import Enum
import statistics


class TimeRange(str, Enum):
    DAY_1 = "1d"
    DAY_7 = "7d"
    DAY_30 = "30d"


@dataclass
class LobsterCostSummary:
    lobster_id: str
    tenant_id: str
    range: str
    total_cost_usd: float
    total_input_tokens: int
    total_output_tokens: int
    call_count: int
    avg_cost_per_call: float
    max_cost_call_id: Optional[str]
    max_cost_usd: float
    trend_pct: float      # 环比变化百分比（正=上涨，负=下降）
    trend_direction: str  # "up" / "down" / "flat"

    def to_dict(self) -> dict:
        return {
            "lobster_id": self.lobster_id,
            "tenant_id": self.tenant_id,
            "range": self.range,
            "total_cost_usd": round(self.total_cost_usd, 6),
            "total_tokens": self.total_input_tokens + self.total_output_tokens,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "call_count": self.call_count,
            "avg_cost_per_call": round(self.avg_cost_per_call, 6),
            "max_cost_usd": round(self.max_cost_usd, 6),
            "trend_pct": round(self.trend_pct, 1),
            "trend_direction": self.trend_direction,
        }


@dataclass
class CostTimeseriesPoint:
    timestamp: str   # ISO 8601
    cost_usd: float
    input_tokens: int
    output_tokens: int
    call_count: int


@dataclass
class LlmCallRecord:
    """单次 LLM 调用记录（来自 llm_call_logger）"""
    call_id: str
    lobster_id: str
    tenant_id: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cost_usd: Optional[float]
    route_tier: Optional[str]   # economy/standard/premium（来自 smart_router）
    latency_ms: int
    created_at: datetime
    status: str  # "success" / "error"


class LobsterCostAnalyzer:
    """
    龙虾成本分析器（对接 llm_call_logger 数据库）

    使用方式（与 FastAPI 集成）：
        analyzer = LobsterCostAnalyzer(db_session)
        router = analyzer.build_router()
        app.include_router(router, prefix="/api/cost")
    """

    def __init__(self, db_fetcher=None):
        """
        Args:
            db_fetcher: 数据库查询函数接口（具体实现对接 llm_call_logger 表）
        """
        self._db = db_fetcher

    def _range_to_days(self, range_str: str) -> int:
        return {"1d": 1, "7d": 7, "30d": 30}.get(range_str, 7)

    def _compute_trend(self, current: float, previous: float) -> tuple[float, str]:
        if previous == 0:
            return 0.0, "flat" if current == 0 else "up"
        pct = ((current - previous) / previous) * 100
        direction = "up" if pct > 2 else ("down" if pct < -2 else "flat")
        return pct, direction

    def get_lobster_summary(
        self,
        tenant_id: str,
        lobster_id: str,
        range_str: str = "7d",
        records: Optional[list[LlmCallRecord]] = None,
    ) -> LobsterCostSummary:
        """
        获取单只龙虾的成本汇总

        Args:
            records: 可选的测试数据注入（生产环境从 DB 查询）
        """
        days = self._range_to_days(range_str)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)
        prev_cutoff = cutoff - timedelta(days=days)

        # 过滤当期和上期数据
        if records is None:
            records = self._fetch_records(tenant_id, lobster_id, prev_cutoff)

        current = [r for r in records if r.created_at >= cutoff]
        previous = [r for r in records if prev_cutoff <= r.created_at < cutoff]

        def agg(recs: list[LlmCallRecord]) -> dict:
            if not recs:
                return {"cost": 0.0, "in_tok": 0, "out_tok": 0, "count": 0, "max_cost": 0.0, "max_id": None}
            costs = [r.cost_usd or 0.0 for r in recs]
            max_idx = costs.index(max(costs))
            return {
                "cost": sum(costs),
                "in_tok": sum(r.input_tokens for r in recs),
                "out_tok": sum(r.output_tokens for r in recs),
                "count": len(recs),
                "max_cost": max(costs),
                "max_id": recs[max_idx].call_id,
            }

        cur = agg(current)
        prev = agg(previous)
        trend_pct, trend_dir = self._compute_trend(cur["cost"], prev["cost"])

        return LobsterCostSummary(
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            range=range_str,
            total_cost_usd=cur["cost"],
            total_input_tokens=cur["in_tok"],
            total_output_tokens=cur["out_tok"],
            call_count=cur["count"],
            avg_cost_per_call=cur["cost"] / cur["count"] if cur["count"] > 0 else 0.0,
            max_cost_call_id=cur["max_id"],
            max_cost_usd=cur["max_cost"],
            trend_pct=trend_pct,
            trend_direction=trend_dir,
        )

    def get_all_lobsters_summary(
        self,
        tenant_id: str,
        range_str: str = "7d",
    ) -> list[dict]:
        """获取所有10只龙虾的成本汇总，按总消耗降序"""
        lobster_ids = [
            "commander", "radar", "strategist", "inkwriter", "visualizer",
            "dispatcher", "echoer", "catcher", "abacus", "followup"
        ]
        results = []
        for lid in lobster_ids:
            summary = self.get_lobster_summary(tenant_id, lid, range_str)
            results.append(summary.to_dict())

        results.sort(key=lambda x: x["total_cost_usd"], reverse=True)
        return results

    def get_timeseries(
        self,
        tenant_id: str,
        lobster_id: str,
        range_str: str = "7d",
        records: Optional[list[LlmCallRecord]] = None,
    ) -> list[dict]:
        """
        获取时序数据（按天聚合）
        """
        days = self._range_to_days(range_str)
        now = datetime.now(timezone.utc)

        if records is None:
            cutoff = now - timedelta(days=days)
            records = self._fetch_records(tenant_id, lobster_id, cutoff)

        # 按天分桶
        buckets: dict[str, list[LlmCallRecord]] = {}
        for i in range(days):
            day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            buckets[day] = []

        for r in records:
            day = r.created_at.strftime("%Y-%m-%d")
            if day in buckets:
                buckets[day].append(r)

        result = []
        for day in sorted(buckets.keys()):
            recs = buckets[day]
            result.append({
                "date": day,
                "cost_usd": round(sum(r.cost_usd or 0 for r in recs), 6),
                "input_tokens": sum(r.input_tokens for r in recs),
                "output_tokens": sum(r.output_tokens for r in recs),
                "call_count": len(recs),
            })

        return result

    def _fetch_records(
        self,
        tenant_id: str,
        lobster_id: str,
        since: datetime,
    ) -> list[LlmCallRecord]:
        """从数据库查询（生产环境对接 llm_call_logger 表）"""
        if self._db:
            return self._db.query_llm_calls(tenant_id, lobster_id, since)
        return []  # 测试时注入 records 参数

    def build_router(self):
        """构建 FastAPI Router"""
        try:
            from fastapi import APIRouter, Query
            router = APIRouter()

            @router.get("/lobsters/{lobster_id}")
            def get_lobster_cost(
                lobster_id: str,
                tenant_id: str = Query(...),
                range: str = Query("7d"),
            ):
                summary = self.get_lobster_summary(tenant_id, lobster_id, range)
                return summary.to_dict()

            @router.get("/lobsters")
            def get_all_costs(
                tenant_id: str = Query(...),
                range: str = Query("7d"),
            ):
                return {"data": self.get_all_lobsters_summary(tenant_id, range)}

            @router.get("/lobsters/{lobster_id}/timeseries")
            def get_timeseries(
                lobster_id: str,
                tenant_id: str = Query(...),
                range: str = Query("7d"),
            ):
                return {"data": self.get_timeseries(tenant_id, lobster_id, range)}

            return router
        except ImportError:
            return None
```

---

## 集成检查清单

- [ ] `smart_router.py` 集成到 `lobster_runner.py`（每次 LLM 调用前调用 `route()`）
- [ ] `lobster_budget_alert.py` 在 `app.py` 启动时调用 `start_cron()`
- [ ] `api_key_vault.py` 替换 `provider_registry.py` 中的明文 key 存储
- [ ] `lobster_cost_api.py` router 注册到 FastAPI app（`/api/cost/lobsters`）
- [ ] 前端 `/operations/cost` 页面对接 cost API（按龙虾展示成本 + 趋势图）
- [ ] `VAULT_MASTER_KEY` 写入生产环境变量（32字节随机 hex）

---

*生成时间：2026-04-02 | 来源：Manifest 借鉴分析 | 优先级：P1*
