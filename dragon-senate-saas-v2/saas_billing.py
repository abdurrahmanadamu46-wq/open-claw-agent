"""
saas_billing.py — SaaS 订阅计费集成层
========================================
灵感来源：
  open-saas template/app/src/payment/operations.ts + plans.ts
  boxyhq/saas-starter-kit models/subscription.ts + components/billing/

核心设计：
  抽象的"计费处理器"接口，支持多种支付后端：
  - Stripe   : 信用卡订阅（国际市场）
  - 微信支付  : 中国市场（WeChat Pay）
  - 支付宝   : 中国市场（Alipay）
  - 手动录入 : 企业合同、线下付款

  统一的 Plan 定义 + Subscription 状态管理，
  不管用哪个支付后端，上层逻辑完全一致。

计划定义（仿 open-saas plans.ts）：
  basic_monthly / basic_yearly
  growth_monthly / growth_yearly
  enterprise（线下合同）

集成点：
  platform_governance.py → PolicyLimits.for_tier() 从 subscription.tier 读取
  rbac_permission.py     → owner 有 billing read 权限
  app.py                 → /api/billing/* 端点
  前端 Billing 页        → 显示当前 plan、用量、升级按钮
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger("saas_billing")

# ────────────────────────────────────────────────────────────────────
# Plan 定义（仿 open-saas plans.ts）
# ────────────────────────────────────────────────────────────────────

PlanId = Literal[
    "free",
    "basic_monthly",
    "basic_yearly",
    "growth_monthly",
    "growth_yearly",
    "enterprise",
]

SubscriptionStatus = Literal[
    "active",
    "past_due",
    "cancelled",
    "trialing",
    "paused",
    "manual",   # 企业合同，手动管理
]


@dataclass
class Plan:
    plan_id: PlanId
    name: str
    tenant_tier: str           # basic / growth / enterprise
    price_cny: float           # 元/月（0=免费）
    price_usd: float           # 美元/月
    billing_period: str        # monthly / yearly / lifetime / manual
    features: list[str] = field(default_factory=list)
    max_accounts: int = 3
    max_lobsters: int = 1
    max_monthly_tokens: int = 500_000
    stripe_price_id: str = ""      # Stripe Price ID（国际）
    wechat_product_id: str = ""    # 微信支付产品 ID
    alipay_product_id: str = ""    # 支付宝产品 ID

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "name": self.name,
            "tenant_tier": self.tenant_tier,
            "price_cny": self.price_cny,
            "price_usd": self.price_usd,
            "billing_period": self.billing_period,
            "features": self.features,
            "max_accounts": self.max_accounts,
            "max_lobsters": self.max_lobsters,
            "max_monthly_tokens": self.max_monthly_tokens,
        }


# ── 计划目录（仿 open-saas paymentProcessorPlans.ts）────────────────

PLANS: dict[str, Plan] = {
    "free": Plan(
        plan_id="free",
        name="免费版",
        tenant_tier="basic",
        price_cny=0, price_usd=0,
        billing_period="lifetime",
        features=["1个账号", "1只龙虾", "50万Token/月", "基础分析"],
        max_accounts=1, max_lobsters=1, max_monthly_tokens=500_000,
    ),
    "basic_monthly": Plan(
        plan_id="basic_monthly",
        name="基础版（月付）",
        tenant_tier="basic",
        price_cny=299, price_usd=39,
        billing_period="monthly",
        features=["3个账号", "1只龙虾", "100万Token/月", "基础分析", "定时发布"],
        max_accounts=3, max_lobsters=1, max_monthly_tokens=1_000_000,
    ),
    "basic_yearly": Plan(
        plan_id="basic_yearly",
        name="基础版（年付）",
        tenant_tier="basic",
        price_cny=2390, price_usd=319,
        billing_period="yearly",
        features=["3个账号", "1只龙虾", "100万Token/月", "基础分析", "定时发布", "年付8折"],
        max_accounts=3, max_lobsters=1, max_monthly_tokens=1_000_000,
    ),
    "growth_monthly": Plan(
        plan_id="growth_monthly",
        name="成长版（月付）",
        tenant_tier="growth",
        price_cny=899, price_usd=119,
        billing_period="monthly",
        features=["10个账号", "3只并行龙虾", "500万Token/月", "ROI分析",
                  "团队记忆同步", "技能市场", "后台执行", "Webhook"],
        max_accounts=10, max_lobsters=3, max_monthly_tokens=5_000_000,
    ),
    "growth_yearly": Plan(
        plan_id="growth_yearly",
        name="成长版（年付）",
        tenant_tier="growth",
        price_cny=7190, price_usd=959,
        billing_period="yearly",
        features=["10个账号", "3只并行龙虾", "500万Token/月", "ROI分析",
                  "团队记忆同步", "技能市场", "后台执行", "Webhook", "年付8折"],
        max_accounts=10, max_lobsters=3, max_monthly_tokens=5_000_000,
    ),
    "enterprise": Plan(
        plan_id="enterprise",
        name="企业版",
        tenant_tier="enterprise",
        price_cny=0, price_usd=0,  # 线下合同定价
        billing_period="manual",
        features=["无限账号", "5只并行龙虾", "无限Token", "全部功能",
                  "自定义技能", "API直连", "白标", "专属支持", "审计日志"],
        max_accounts=9999, max_lobsters=5, max_monthly_tokens=999_999_999,
    ),
}


def get_plan(plan_id: str) -> Plan | None:
    return PLANS.get(plan_id)


def list_plans(billing_period: str | None = None) -> list[dict[str, Any]]:
    """列出所有计划（供前端 Pricing 页使用）"""
    result = []
    for plan in PLANS.values():
        if billing_period and plan.billing_period not in (billing_period, "lifetime", "manual"):
            continue
        result.append(plan.to_dict())
    return result


# ────────────────────────────────────────────────────────────────────
# Subscription — 订阅状态
# ────────────────────────────────────────────────────────────────────

@dataclass
class Subscription:
    """租户订阅状态（仿 boxyhq models/subscription.ts）"""
    subscription_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    tenant_id: str = ""
    plan_id: str = "free"
    status: SubscriptionStatus = "active"
    current_period_start: float = field(default_factory=time.time)
    current_period_end: float = field(default_factory=lambda: time.time() + 30 * 86400)
    cancel_at_period_end: bool = False

    # 外部支付系统的 ID
    stripe_subscription_id: str = ""
    stripe_customer_id: str = ""
    wechat_order_id: str = ""
    alipay_trade_id: str = ""

    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def is_active(self) -> bool:
        if self.status not in ("active", "trialing", "manual"):
            return False
        if self.status == "manual":
            return True  # 企业合同手动管理
        return time.time() <= self.current_period_end

    @property
    def tenant_tier(self) -> str:
        plan = get_plan(self.plan_id)
        return plan.tenant_tier if plan else "basic"

    def to_dict(self) -> dict[str, Any]:
        plan = get_plan(self.plan_id)
        return {
            "subscription_id": self.subscription_id,
            "tenant_id": self.tenant_id,
            "plan_id": self.plan_id,
            "plan_name": plan.name if plan else "未知",
            "tenant_tier": self.tenant_tier,
            "status": self.status,
            "is_active": self.is_active,
            "current_period_start": self.current_period_start,
            "current_period_end": self.current_period_end,
            "cancel_at_period_end": self.cancel_at_period_end,
            "created_at": self.created_at,
        }


# ────────────────────────────────────────────────────────────────────
# 用量追踪（Token、账号、操作次数）
# ────────────────────────────────────────────────────────────────────

_BILLING_DB_PATH = "data/billing.sqlite"


class BillingStore:
    """计费数据存储（SQLite）"""

    def __init__(self) -> None:
        self._ensure_schema()

    def _get_db(self) -> sqlite3.Connection:
        p = Path(_BILLING_DB_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(p))
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._get_db()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS subscriptions (
                    subscription_id       TEXT PRIMARY KEY,
                    tenant_id             TEXT NOT NULL UNIQUE,
                    plan_id               TEXT NOT NULL DEFAULT 'free',
                    status                TEXT NOT NULL DEFAULT 'active',
                    current_period_start  REAL,
                    current_period_end    REAL,
                    cancel_at_period_end  INTEGER DEFAULT 0,
                    stripe_subscription_id TEXT DEFAULT '',
                    stripe_customer_id    TEXT DEFAULT '',
                    created_at            REAL NOT NULL,
                    updated_at            REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sub_tenant ON subscriptions(tenant_id);

                CREATE TABLE IF NOT EXISTS usage_records (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id   TEXT NOT NULL,
                    metric      TEXT NOT NULL,
                    amount      REAL NOT NULL,
                    period_key  TEXT NOT NULL,
                    recorded_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_usage_tenant_period
                    ON usage_records(tenant_id, metric, period_key);
            """)
            conn.commit()
        finally:
            conn.close()

    def upsert_subscription(self, sub: Subscription) -> None:
        conn = self._get_db()
        now = time.time()
        try:
            conn.execute(
                "INSERT INTO subscriptions "
                "(subscription_id, tenant_id, plan_id, status, "
                "current_period_start, current_period_end, cancel_at_period_end, "
                "stripe_subscription_id, stripe_customer_id, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id) DO UPDATE SET "
                "plan_id=excluded.plan_id, status=excluded.status, "
                "current_period_start=excluded.current_period_start, "
                "current_period_end=excluded.current_period_end, "
                "cancel_at_period_end=excluded.cancel_at_period_end, "
                "stripe_subscription_id=excluded.stripe_subscription_id, "
                "updated_at=?",
                (sub.subscription_id, sub.tenant_id, sub.plan_id, sub.status,
                 sub.current_period_start, sub.current_period_end,
                 int(sub.cancel_at_period_end),
                 sub.stripe_subscription_id, sub.stripe_customer_id,
                 sub.created_at, now, now),
            )
            conn.commit()
        finally:
            conn.close()

    def get_subscription(self, tenant_id: str) -> Subscription | None:
        conn = self._get_db()
        try:
            row = conn.execute(
                "SELECT * FROM subscriptions WHERE tenant_id=?", (tenant_id,)
            ).fetchone()
            if not row:
                return None
            return Subscription(
                subscription_id=row[0], tenant_id=row[1], plan_id=row[2],
                status=row[3], current_period_start=row[4] or 0,
                current_period_end=row[5] or 0,
                cancel_at_period_end=bool(row[6]),
                stripe_subscription_id=row[7] or "",
                stripe_customer_id=row[8] or "",
                created_at=row[9] or 0, updated_at=row[10] or 0,
            )
        finally:
            conn.close()

    def record_usage(
        self,
        tenant_id: str,
        metric: str,  # "tokens" / "posts" / "dms" / "llm_calls"
        amount: float,
    ) -> None:
        """记录用量（按月统计）"""
        from datetime import datetime
        period_key = datetime.utcnow().strftime("%Y-%m")
        conn = self._get_db()
        try:
            conn.execute(
                "INSERT INTO usage_records (tenant_id, metric, amount, period_key, recorded_at) "
                "VALUES (?,?,?,?,?)",
                (tenant_id, metric, amount, period_key, time.time()),
            )
            conn.commit()
        finally:
            conn.close()

    def get_monthly_usage(self, tenant_id: str) -> dict[str, float]:
        """获取当月用量汇总"""
        from datetime import datetime
        period_key = datetime.utcnow().strftime("%Y-%m")
        conn = self._get_db()
        try:
            rows = conn.execute(
                "SELECT metric, SUM(amount) FROM usage_records "
                "WHERE tenant_id=? AND period_key=? GROUP BY metric",
                (tenant_id, period_key),
            ).fetchall()
            return {row[0]: row[1] for row in rows}
        finally:
            conn.close()


# ────────────────────────────────────────────────────────────────────
# BillingService — 核心计费服务
# ────────────────────────────────────────────────────────────────────

class BillingService:
    """
    SaaS 计费服务（仿 open-saas payment/operations.ts + boxyhq billing）

    职责：
    1. 订阅状态管理（创建/升级/降级/取消）
    2. 用量追踪（Token、发帖次数等）
    3. 配额检查（结合 platform_governance.py）
    4. 计划切换通知（触发 webhook_event_bus）

    支付后端接入说明：
      - Stripe: 实现 create_stripe_checkout_session()
      - 微信支付: 实现 create_wechat_order()
      - 支付宝: 实现 create_alipay_order()
      - 都通过 webhook 回调更新 subscription 状态
    """

    def __init__(self) -> None:
        self._store = BillingStore()

    def get_or_create_subscription(self, tenant_id: str) -> Subscription:
        """获取订阅，不存在则创建免费版"""
        sub = self._store.get_subscription(tenant_id)
        if sub:
            return sub
        # 新租户：免费版
        sub = Subscription(
            tenant_id=tenant_id,
            plan_id="free",
            status="active",
            current_period_start=time.time(),
            current_period_end=time.time() + 365 * 86400,  # 永久免费
        )
        self._store.upsert_subscription(sub)
        return sub

    def get_tenant_tier(self, tenant_id: str) -> str:
        """快速获取租户级别（供 platform_governance 使用）"""
        sub = self._store.get_subscription(tenant_id)
        if not sub or not sub.is_active:
            return "basic"
        return sub.tenant_tier

    def upgrade_plan(self, tenant_id: str, new_plan_id: str) -> Subscription:
        """升级/降级计划（内部调用，实际支付由前端发起）"""
        sub = self.get_or_create_subscription(tenant_id)
        sub.plan_id = new_plan_id
        sub.status = "active"
        sub.updated_at = time.time()
        self._store.upsert_subscription(sub)
        logger.info("[Billing] 计划变更 tenant=%s plan=%s", tenant_id, new_plan_id)
        return sub

    def handle_webhook(self, event_type: str, data: dict[str, Any]) -> bool:
        """
        处理支付平台 Webhook（Stripe/微信/支付宝回调）
        仿 open-saas payment/webhook.ts
        """
        tenant_id = data.get("tenant_id", "")
        if not tenant_id:
            return False

        if event_type in ("checkout.session.completed", "payment.success"):
            plan_id = data.get("plan_id", "basic_monthly")
            sub = self.get_or_create_subscription(tenant_id)
            sub.plan_id = plan_id
            sub.status = "active"
            sub.stripe_subscription_id = data.get("subscription_id", "")
            sub.stripe_customer_id = data.get("customer_id", "")
            self._store.upsert_subscription(sub)

        elif event_type in ("customer.subscription.deleted", "subscription.cancelled"):
            sub = self.get_or_create_subscription(tenant_id)
            sub.status = "cancelled"
            sub.plan_id = "free"
            self._store.upsert_subscription(sub)

        elif event_type in ("invoice.payment_failed", "payment.failed"):
            sub = self.get_or_create_subscription(tenant_id)
            sub.status = "past_due"
            self._store.upsert_subscription(sub)

        return True

    def record_usage(self, tenant_id: str, metric: str, amount: float = 1.0) -> None:
        """记录用量（供 lobster_runner 调用）"""
        self._store.record_usage(tenant_id, metric, amount)

    def check_quota(self, tenant_id: str, metric: str) -> tuple[bool, str]:
        """
        检查用量是否超出配额。
        Returns: (within_limit, message)
        """
        from platform_governance import PolicyLimits
        tier = self.get_tenant_tier(tenant_id)
        limits = PolicyLimits.for_tier(tier)
        usage = self._store.get_monthly_usage(tenant_id)

        quota_map = {
            "tokens": limits.max_tokens_per_month,
            "posts": limits.max_daily_posts * 30,
            "dms": limits.max_daily_dms * 30,
            "llm_calls": limits.max_daily_llm_calls * 30,
        }
        limit = quota_map.get(metric, 0)
        if limit == 0:
            return True, "no_limit"
        used = usage.get(metric, 0)
        if used >= limit:
            return False, f"配额超限：{metric} 已用 {used:.0f}/{limit:.0f}"
        return True, f"ok（{used:.0f}/{limit:.0f}）"

    def get_billing_summary(self, tenant_id: str) -> dict[str, Any]:
        """账单摘要（供前端 Billing 页使用）"""
        sub = self.get_or_create_subscription(tenant_id)
        plan = get_plan(sub.plan_id)
        usage = self._store.get_monthly_usage(tenant_id)

        return {
            "subscription": sub.to_dict(),
            "plan": plan.to_dict() if plan else {},
            "monthly_usage": usage,
            "available_plans": list_plans(),
        }


# ── 全局单例 ─────────────────────────────────────────────────────────

_global_billing: BillingService | None = None


def get_billing_service() -> BillingService:
    global _global_billing
    if _global_billing is None:
        _global_billing = BillingService()
    return _global_billing
