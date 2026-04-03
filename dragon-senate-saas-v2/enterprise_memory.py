"""
企业记忆库核心模块
Dragon Senate — Enterprise Memory Bank

三层知识架构：
  Layer 1: 平台公共知识库（行业+细分+城市级，我们维护，所有同类客户共享）
  Layer 2: 区域知识库（城市级特征，半公开）
  Layer 3: 企业专属记忆库（完全隔离，随时间生长）

执行时三层叠加，下层优先级最高（企业专属 > 区域 > 行业通用）
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

# ─────────────────────────────────────────
# 枚举定义
# ─────────────────────────────────────────

class IndustryL1(str, Enum):
    BEAUTY_HEALTH = "美业健康"
    FOOD_BEVERAGE = "餐饮"
    EDUCATION = "教育培训"
    RETAIL = "零售"
    B2B = "B2B企业服务"
    FITNESS = "健身运动"
    REAL_ESTATE = "房产家居"

class IndustryL2(str, Enum):
    # 美业健康
    BEAUTY_SALON = "美容院"
    MEDICAL_BEAUTY = "医美机构"
    SPA_WELLNESS = "养生馆"
    HAIR_SALON = "美发"
    NAIL_ART = "美甲"
    # 餐饮
    CHINESE_RESTAURANT = "中餐"
    WESTERN_RESTAURANT = "西餐"
    CAFE = "咖啡茶饮"
    FAST_FOOD = "快餐"
    # 教育
    K12 = "K12教育"
    VOCATIONAL = "职业技能培训"
    LANGUAGE = "语言培训"
    # 零售
    CLOTHING = "服装"
    COSMETICS = "化妆品"
    MOTHER_BABY = "母婴"

class CityTier(str, Enum):
    TIER1 = "一线城市"       # 北上广深
    NEW_TIER1 = "新一线城市" # 成都杭州武汉等
    TIER2 = "二线城市"
    TIER3 = "三线城市"
    TIER4_PLUS = "四线及以下"

class PricePosition(str, Enum):
    PREMIUM = "高端"         # 美容院客单>500
    MID = "中端"             # 150-500
    BUDGET = "平价"          # <150

class GrowthStage(str, Enum):
    COLD_START = "冷启动"    # 0→1，账号建立期
    EXPANSION = "扩张期"     # 1→10，获客爆发期
    MATURE = "成熟期"        # 稳定运营+精细化
    REACTIVATION = "唤醒期"  # 停滞后重启

class AccountHealth(str, Enum):
    GREEN = "绿色"
    YELLOW = "黄色"
    ORANGE = "橙色"
    RED = "红色"


# ─────────────────────────────────────────
# Layer 1：平台公共行业知识库
# ─────────────────────────────────────────

INDUSTRY_KNOWLEDGE_TREE: dict[str, Any] = {
    "美业健康": {
        "美容院": {
            "高端": {
                "content_tone": ["精致感", "质感", "专业", "稀缺", "定制"],
                "primary_platforms": ["小红书", "抖音", "视频号"],
                "intent_keywords": ["预约", "体验", "疗程", "改善", "定制", "咨询", "效果"],
                "banned_words": ["便宜", "活动价", "打折", "白菜价", "最好", "第一", "根治", "100%"],
                "conversion_path": "内容种草→私信咨询→到店体验→开卡",
                "decision_days": {"min": 7, "max": 21},
                "peak_content_types": ["before_after对比", "专业知识科普", "顾客真实反馈", "服务环境展示"],
                "repost_channels": ["微信私域", "小红书收藏", "朋友圈"],
                "key_kpis": ["私信量", "到店预约数", "开卡转化率"],
            },
            "中端": {
                "content_tone": ["亲切", "实惠", "效果导向", "真实"],
                "primary_platforms": ["抖音", "小红书", "微信"],
                "intent_keywords": ["多少钱", "效果怎么样", "在哪", "团购", "套餐"],
                "banned_words": ["最好", "第一", "根治"],
                "conversion_path": "内容/活动吸引→私信/电话→到店→复购",
                "decision_days": {"min": 3, "max": 14},
                "peak_content_types": ["活动信息", "真人效果展示", "套餐对比"],
                "key_kpis": ["到店量", "复购率", "团购核销率"],
            },
            "平价": {
                "content_tone": ["实惠", "高性价比", "接地气"],
                "primary_platforms": ["抖音", "美团"],
                "intent_keywords": ["多少钱", "团购", "优惠", "附近"],
                "conversion_path": "平台曝光→团购/优惠券→到店→好评",
                "decision_days": {"min": 1, "max": 7},
                "peak_content_types": ["价格透明展示", "活动公告"],
                "key_kpis": ["团购核销量", "到店量", "好评数"],
            },
        },
        "医美机构": {
            "高端": {
                "content_tone": ["专业医疗级", "权威", "安全", "科学"],
                "primary_platforms": ["小红书", "抖音"],
                "intent_keywords": ["医生", "资质", "安全", "恢复期", "效果维持"],
                "banned_words": ["根治", "永久", "无副作用", "100%安全", "最好的医生"],
                "conversion_path": "科普内容→建立信任→私信咨询→线下面诊→手术",
                "decision_days": {"min": 30, "max": 90},
                "key_kpis": ["面诊量", "手术转化率"],
            },
        },
        "养生馆": {
            "高端": {
                "content_tone": ["东方美学", "健康养生", "身心平衡"],
                "primary_platforms": ["小红书", "视频号"],
                "intent_keywords": ["调理", "放松", "疏通", "体质", "养生"],
                "conversion_path": "内容种草→私信预约→体验→疗程卡",
                "decision_days": {"min": 7, "max": 30},
                "key_kpis": ["预约量", "疗程卡开卡率"],
            },
        },
    },
    "餐饮": {
        "中餐": {
            "本地门店": {
                "content_tone": ["食欲感", "真实场景", "地方特色"],
                "primary_platforms": ["抖音", "小红书", "大众点评"],
                "intent_keywords": ["在哪", "好吃吗", "推荐", "地址", "怎么预约"],
                "conversion_path": "内容/评论区→问地址→到店",
                "decision_days": {"min": 1, "max": 3},
                "best_content": ["排队场景", "食材展示", "制作过程", "顾客反应"],
                "key_kpis": ["到店量", "好评数", "收藏量"],
            },
        },
    },
    "教育培训": {
        "K12教育": {
            "通用": {
                "content_tone": ["专业权威", "成果导向", "家长信任"],
                "primary_platforms": ["视频号", "微信", "抖音"],
                "intent_keywords": ["成绩提升", "师资", "升学率", "试听", "报名"],
                "decision_maker": "家长（非学生本人）",
                "conversion_path": "内容建信任→家长群/私信→试听→报名",
                "decision_days": {"min": 14, "max": 60},
                "key_kpis": ["试听转化率", "报名量", "续费率"],
            },
        },
    },
}


# ─────────────────────────────────────────
# Layer 2：区域知识库
# ─────────────────────────────────────────

REGIONAL_KNOWLEDGE: dict[str, Any] = {
    "三线城市": {
        "economy_type": "熟人经济强",
        "word_of_mouth_multiplier": 2.5,   # 口碑传播效率是一线城市2.5倍
        "decision_delay_days": 7,           # 比一线城市决策周期额外延长7天
        "trust_building_weight": "高",       # 需要更长信任建立期
        "preferred_channels": {
            "wechat_private": "极强",        # 微信私域远强于其他城市
            "douyin": "中",
            "xiaohongshu": "弱",
            "wechat_video": "强",
        },
        "local_content_ctr_boost": 0.4,    # 本地同城内容CTR高40%
        "price_sensitivity": "中高",
        "value_justification_required": True,  # 即使高端定位，也需要说明"值得"
        "best_publishing_hours": {
            "weekday": ["12:00-13:00", "19:00-21:00"],
            "weekend": ["10:00-12:00", "15:00-17:00"],
        },
        "cultural_notes": "熟人经济主导，老板/员工的个人IP比品牌账号更有温度",
    },
    "一线城市": {
        "economy_type": "陌生人经济",
        "word_of_mouth_multiplier": 1.0,
        "decision_delay_days": 0,
        "preferred_channels": {
            "xiaohongshu": "极强",
            "douyin": "强",
            "wechat_private": "中",
        },
        "local_content_ctr_boost": 0.15,
        "price_sensitivity": "低",
        "value_justification_required": False,
    },
    "新一线城市": {
        "economy_type": "混合型",
        "word_of_mouth_multiplier": 1.5,
        "decision_delay_days": 3,
        "preferred_channels": {
            "douyin": "极强",
            "xiaohongshu": "强",
            "wechat_private": "中",
        },
        "local_content_ctr_boost": 0.25,
        "price_sensitivity": "中",
        "value_justification_required": True,
    },
}


# ─────────────────────────────────────────
# Layer 3：企业专属记忆库数据结构
# ─────────────────────────────────────────

@dataclass
class PlatformAccountRecord:
    """单个平台账号记录"""
    platform: str
    account_id: str = ""
    followers: int = 0
    health_status: AccountHealth = AccountHealth.GREEN
    avg_engagement_rate: float = 0.0
    top_content_types: list[str] = field(default_factory=list)
    last_checked: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class GrowthCampaignRecord:
    """一次增长活动的完整记录"""
    period: str                          # 如 "2025-Q4"
    campaign_name: str
    strategies_tried: list[str] = field(default_factory=list)
    new_customers: int = 0
    reactivated_customers: int = 0
    revenue_increment: float = 0.0
    best_performing_content: list[str] = field(default_factory=list)
    lessons_worked: list[str] = field(default_factory=list)
    lessons_failed: list[str] = field(default_factory=list)
    next_time_notes: list[str] = field(default_factory=list)
    recorded_at: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class MemoryEntry:
    """记忆库中的单条记忆条目（带过期机制）"""
    key: str
    value: Any
    category: str        # "platform_rule" | "competitor" | "customer_preference" | "campaign_result"
    expires_days: int    # -1 = 永不过期
    memory_id: str = field(default_factory=lambda: datetime.now().strftime("mem_%Y%m%d%H%M%S%f"))
    metadata: dict[str, Any] = field(default_factory=dict)
    source_lobster: str = ""
    source_task_id: str = ""
    lead_id: str = ""
    session_id: str = ""
    confidence: float = 1.0
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def is_expired(self) -> bool:
        if self.expires_days == -1:
            return False
        created = datetime.fromisoformat(self.created_at)
        return datetime.now() > created + timedelta(days=self.expires_days)

    def is_stale(self) -> bool:
        """超过有效期的75%即标记为'待核实'"""
        if self.expires_days == -1:
            return False
        created = datetime.fromisoformat(self.created_at)
        stale_threshold = timedelta(days=int(self.expires_days * 0.75))
        return datetime.now() > created + stale_threshold


@dataclass
class EnterpriseProfile:
    """
    企业专属档案（Layer 3 核心数据结构）
    
    定位路径示例：美业健康 > 美容院 > 三线城市 > 高端 > 荣荣美院
    """
    tenant_id: str
    enterprise_name: str

    # ── 基本定位 ──
    industry_l1: str = ""              # 美业健康
    industry_l2: str = ""              # 美容院
    price_position: str = ""           # 高端
    city: str = ""                     # 四川省XX市
    city_tier: str = ""                # 三线城市
    founded_year: int = 0
    growth_stage: str = GrowthStage.COLD_START.value

    # ── 品牌基因 ──
    brand_core_value: str = ""         # "让小城女性也能享受大城市的美容体验"
    brand_personality: list[str] = field(default_factory=list)
    brand_taboo_persona: list[str] = field(default_factory=list)
    founder_story: str = ""
    signature_service: str = ""

    # ── 内容资产 ──
    platform_accounts: list[PlatformAccountRecord] = field(default_factory=list)
    brand_vocabulary_positive: list[str] = field(default_factory=list)  # 常用词汇
    brand_vocabulary_customer: list[str] = field(default_factory=list)  # 客户说话方式
    brand_vocabulary_banned: list[str] = field(default_factory=list)    # 禁用词

    # ── 客户画像 ──
    primary_customer_age: str = ""
    primary_customer_gender: str = ""
    primary_customer_occupation: list[str] = field(default_factory=list)
    primary_customer_pain_points: list[str] = field(default_factory=list)
    primary_customer_motivation: list[str] = field(default_factory=list)
    primary_decision_trigger: list[str] = field(default_factory=list)

    # ── 资源条件 ──
    staff_total: int = 0
    content_responsible: str = ""      # 谁负责内容生产
    filming_capability: str = ""       # 拍摄能力描述
    monthly_marketing_budget: float = 0.0
    platform_ads_willing: bool = False
    content_per_week: int = 2          # 每周能生产多少条内容
    peak_busy_periods: list[str] = field(default_factory=list)  # 繁忙时期（不适合做活动）

    # ── 竞争环境 ──
    main_competitors: list[dict] = field(default_factory=list)
    market_position: str = ""

    # ── 历史增长记录 ──
    growth_history: list[GrowthCampaignRecord] = field(default_factory=list)

    # ── 动态记忆条目 ──
    memory_entries: list[MemoryEntry] = field(default_factory=list)

    # ── 元数据 ──
    onboarded_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_updated: str = field(default_factory=lambda: datetime.now().isoformat())

    # ── 增长阶段相关 ──
    @property
    def stage_config(self) -> dict:
        """根据增长阶段返回对应的策略重点"""
        stage_configs = {
            GrowthStage.COLD_START.value: {
                "primary_goal": "建立账号标签，积累第一批精准粉丝",
                "primary_lobsters": ["radar", "strategist", "inkwriter"],
                "content_strategy": "垂直内容为主，搜索流量优先，不追热点",
                "success_metric": "粉丝数突破1000，账号标签稳定",
                "weekly_content_min": 3,
            },
            GrowthStage.EXPANSION.value: {
                "primary_goal": "批量获客，活动拉新，线索高效转化",
                "primary_lobsters": ["dispatcher", "echoer", "catcher", "followup"],
                "content_strategy": "热点+活动内容，扩大曝光，精准捕获意向用户",
                "success_metric": "月新客增长>20%，线索转化率>15%",
                "weekly_content_min": 5,
            },
            GrowthStage.MATURE.value: {
                "primary_goal": "提效、复购、口碑，精细化运营",
                "primary_lobsters": ["followup", "abacus", "strategist"],
                "content_strategy": "深度内容+用户UGC，激活沉默客户，提升客单价",
                "success_metric": "复购率>40%，客单价提升>15%",
                "weekly_content_min": 3,
            },
            GrowthStage.REACTIVATION.value: {
                "primary_goal": "重新激活账号和存量客户",
                "primary_lobsters": ["strategist", "radar", "inkwriter"],
                "content_strategy": "差异化内容重新建立账号标签，私域优先激活",
                "success_metric": "互动率恢复至历史均值，沉睡客户激活率>10%",
                "weekly_content_min": 2,
            },
        }
        return stage_configs.get(self.growth_stage, stage_configs[GrowthStage.COLD_START.value])


# ─────────────────────────────────────────
# 企业记忆库管理器
# ─────────────────────────────────────────

class EnterpriseMemoryBank:
    """
    企业记忆库管理器
    
    职责：
    - 存储/读取企业专属档案（Layer 3）
    - 合并三层知识（行业 + 区域 + 企业专属）
    - 记忆衰减检查
    - 跨客户脱敏学习（企业具体数据永不跨租户）
    """

    MEMORY_DIR = Path("f:/openclaw-agent/dragon-senate-saas-v2/enterprise_memories")

    def __init__(self):
        self.MEMORY_DIR.mkdir(parents=True, exist_ok=True)

    # ── 存储/读取 ──

    def save_profile(self, profile: EnterpriseProfile) -> None:
        """保存企业档案到专属命名空间"""
        profile.last_updated = datetime.now().isoformat()
        path = self.MEMORY_DIR / f"{profile.tenant_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(profile), f, ensure_ascii=False, indent=2)

    def load_profile(self, tenant_id: str) -> EnterpriseProfile | None:
        """读取企业档案"""
        path = self.MEMORY_DIR / f"{tenant_id}.json"
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        # 重建 dataclass（简化版，不递归嵌套）
        profile = EnterpriseProfile(
            tenant_id=data["tenant_id"],
            enterprise_name=data["enterprise_name"],
        )
        for k, v in data.items():
            if hasattr(profile, k):
                setattr(profile, k, v)
        return profile

    def ensure_profile(self, tenant_id: str, enterprise_name: str | None = None) -> EnterpriseProfile:
        profile = self.load_profile(tenant_id)
        if profile is not None:
            return profile
        profile = EnterpriseProfile(
            tenant_id=tenant_id,
            enterprise_name=str(enterprise_name or tenant_id).strip() or tenant_id,
        )
        self.save_profile(profile)
        return profile

    def list_memory_entries(self, tenant_id: str, category: str | None = None) -> list[dict[str, Any]]:
        profile = self.load_profile(tenant_id)
        if not profile:
            return []
        items: list[dict[str, Any]] = []
        for raw in profile.memory_entries:
            normalized = dict(raw)
            normalized.setdefault("memory_id", datetime.now().strftime("mem_%Y%m%d%H%M%S%f"))
            normalized.setdefault("metadata", {})
            normalized.setdefault("source_lobster", "")
            normalized.setdefault("source_task_id", "")
            normalized.setdefault("lead_id", "")
            normalized.setdefault("session_id", "")
            normalized.setdefault("confidence", 1.0)
            entry = MemoryEntry(**normalized)
            if entry.is_expired():
                continue
            if category and entry.category != category:
                continue
            items.append(asdict(entry))
        items.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
        return items

    def upsert_memory_entry(
        self,
        *,
        tenant_id: str,
        key: str,
        value: Any,
        category: str,
        expires_days: int | None = None,
        metadata: dict[str, Any] | None = None,
        memory_id: str | None = None,
    ) -> str:
        profile = self.ensure_profile(tenant_id)
        now = datetime.now().isoformat()
        target_expires = expires_days if expires_days is not None else self._default_expiry_for_category(category)
        target_metadata = dict(metadata or {})
        existing = None
        for item in profile.memory_entries:
            if memory_id and str(item.get("memory_id") or "") == str(memory_id):
                existing = item
                break
            if str(item.get("key") or "") == str(key) and str(item.get("category") or "") == str(category):
                existing = item
                break

        if existing is not None:
            existing["memory_id"] = str(existing.get("memory_id") or memory_id or datetime.now().strftime("mem_%Y%m%d%H%M%S%f"))
            existing["key"] = key
            existing["value"] = value
            existing["category"] = category
            existing["expires_days"] = target_expires
            existing["metadata"] = target_metadata
            existing["source_lobster"] = str(target_metadata.get("source_lobster") or existing.get("source_lobster") or "")
            existing["source_task_id"] = str(target_metadata.get("source_task_id") or existing.get("source_task_id") or "")
            existing["lead_id"] = str(target_metadata.get("lead_id") or existing.get("lead_id") or "")
            existing["session_id"] = str(target_metadata.get("session_id") or existing.get("session_id") or "")
            existing["confidence"] = float(target_metadata.get("confidence") or existing.get("confidence") or 1.0)
            existing["updated_at"] = now
            saved_id = str(existing["memory_id"])
        else:
            entry = MemoryEntry(
                memory_id=str(memory_id or datetime.now().strftime("mem_%Y%m%d%H%M%S%f")),
                key=key,
                value=value,
                category=category,
                expires_days=target_expires,
                metadata=target_metadata,
                source_lobster=str(target_metadata.get("source_lobster") or ""),
                source_task_id=str(target_metadata.get("source_task_id") or ""),
                lead_id=str(target_metadata.get("lead_id") or ""),
                session_id=str(target_metadata.get("session_id") or ""),
                confidence=float(target_metadata.get("confidence") or 1.0),
            )
            profile.memory_entries.append(asdict(entry))
            saved_id = entry.memory_id

        self.save_profile(profile)
        return saved_id

    def _default_expiry_for_category(self, category: str) -> int:
        mapping = {
            "budget": 180,
            "company": -1,
            "title": 180,
            "preference": -1,
            "status": 45,
            "goal": 90,
            "info": 90,
        }
        return int(mapping.get(str(category or "").strip().lower(), 90))

    # ── 三层知识合并 ──

    def get_merged_context(self, tenant_id: str) -> dict:
        """
        合并三层知识，返回龙虾执行时的完整上下文
        
        优先级：企业专属 > 区域 > 行业通用
        """
        profile = self.load_profile(tenant_id)
        if not profile:
            return {"error": f"企业档案不存在: {tenant_id}"}

        # Layer 1：行业知识
        industry_knowledge = (
            INDUSTRY_KNOWLEDGE_TREE
            .get(profile.industry_l1, {})
            .get(profile.industry_l2, {})
            .get(profile.price_position, {})
        )

        # Layer 2：区域知识
        regional_knowledge = REGIONAL_KNOWLEDGE.get(profile.city_tier, {})

        # Layer 3：企业专属
        enterprise_override = {
            "enterprise_name": profile.enterprise_name,
            "brand_core_value": profile.brand_core_value,
            "brand_personality": profile.brand_personality,
            "brand_taboo_persona": profile.brand_taboo_persona,
            "brand_vocabulary_positive": profile.brand_vocabulary_positive,
            "brand_vocabulary_customer": profile.brand_vocabulary_customer,
            "brand_vocabulary_banned": (
                industry_knowledge.get("banned_words", []) +
                profile.brand_vocabulary_banned
            ),
            "platform_accounts": [
                {
                    "platform": acc["platform"],
                    "followers": acc["followers"],
                    "health_status": acc["health_status"],
                    "avg_engagement_rate": acc["avg_engagement_rate"],
                }
                for acc in profile.platform_accounts
            ],
            "growth_stage": profile.growth_stage,
            "stage_focus": profile.stage_config,
            "content_capacity": {
                "weekly_max": profile.content_per_week,
                "filming_capability": profile.filming_capability,
                "platform_ads_willing": profile.platform_ads_willing,
            },
            "customer_profile": {
                "age": profile.primary_customer_age,
                "gender": profile.primary_customer_gender,
                "pain_points": profile.primary_customer_pain_points,
                "motivation": profile.primary_customer_motivation,
                "decision_trigger": profile.primary_decision_trigger,
            },
            "last_campaign_lessons": (
                profile.growth_history[-1].lessons_worked +
                ["注意：" + l for l in profile.growth_history[-1].lessons_failed]
            ) if profile.growth_history else [],
        }

        # 合并（企业专属覆盖行业通用）
        merged = {**industry_knowledge, **regional_knowledge, **enterprise_override}

        # 加入有效记忆条目（过滤过期的）
        valid_memories = [
            {"key": m["key"], "value": m["value"], "stale": False}
            for m in profile.memory_entries
            if not MemoryEntry(**m).is_expired()
        ]
        merged["active_memories"] = valid_memories

        return merged

    # ── 记忆写入 ──

    def write_memory(
        self,
        tenant_id: str,
        key: str,
        value: Any,
        category: str,
        expires_days: int = -1,
    ) -> None:
        """
        写入一条记忆
        
        category 建议值：
          "platform_rule"       → expires_days=90（平台规则90天过期）
          "competitor"          → expires_days=30（竞品动态30天过期）
          "customer_preference" → expires_days=-1（客户偏好永久有效）
          "campaign_result"     → expires_days=-1（活动结果永久有效）
        """
        self.upsert_memory_entry(
            tenant_id=tenant_id,
            key=key,
            value=value,
            category=category,
            expires_days=expires_days,
        )

    def record_campaign(
        self,
        tenant_id: str,
        campaign: GrowthCampaignRecord,
    ) -> None:
        """记录一次增长活动的完整结果（写回历史）"""
        profile = self.load_profile(tenant_id)
        if not profile:
            return
        profile.growth_history.append(asdict(campaign))
        self.save_profile(profile)

    def update_growth_stage(self, tenant_id: str, new_stage: GrowthStage) -> None:
        """更新增长阶段（abacus 或 commander 调用）"""
        profile = self.load_profile(tenant_id)
        if not profile:
            return
        profile.growth_stage = new_stage.value
        self.save_profile(profile)

    # ── 过期检查 ──

    def get_stale_memories(self, tenant_id: str) -> list[dict]:
        """返回需要核实的记忆条目"""
        profile = self.load_profile(tenant_id)
        if not profile:
            return []
        stale = []
        for m in profile.memory_entries:
            entry = MemoryEntry(**m)
            if entry.is_stale() and not entry.is_expired():
                stale.append({"key": m["key"], "category": m["category"], "value": m["value"]})
        return stale

    # ── 平台最优账号选择 ──

    def get_best_platform(self, tenant_id: str) -> str:
        """
        根据账号实际数据选择主投平台
        （企业专属数据 > 行业通用建议）
        """
        profile = self.load_profile(tenant_id)
        if not profile or not profile.platform_accounts:
            # 回退到行业通用建议
            context = self.get_merged_context(tenant_id)
            platforms = context.get("primary_platforms", [])
            return platforms[0] if platforms else "抖音"

        # 选择粉丝最多且健康状态为绿色的账号所在平台
        healthy_accounts = [
            a for a in profile.platform_accounts
            if a["health_status"] in [AccountHealth.GREEN.value, "绿色"]
        ]
        if not healthy_accounts:
            return "抖音"

        best = max(healthy_accounts, key=lambda a: a["followers"])
        return best["platform"]


# ─────────────────────────────────────────
# 便捷工厂方法
# ─────────────────────────────────────────

def create_enterprise_profile_from_onboarding(onboarding_data: dict) -> EnterpriseProfile:
    """
    从入驻问卷数据创建企业档案
    
    onboarding_data 示例：
    {
        "tenant_id": "rongrong_beauty_2026",
        "enterprise_name": "荣荣美院",
        "industry_l1": "美业健康",
        "industry_l2": "美容院",
        "price_position": "高端",
        "city": "四川省XX市",
        "city_tier": "三线城市",
        "brand_core_value": "让小城女性也能享受大城市的美容体验",
        "brand_personality": ["专业温暖", "亲切不距离", "细节控"],
        ...
    }
    """
    profile = EnterpriseProfile(
        tenant_id=onboarding_data["tenant_id"],
        enterprise_name=onboarding_data["enterprise_name"],
    )
    for k, v in onboarding_data.items():
        if hasattr(profile, k):
            setattr(profile, k, v)

    # 自动推断增长阶段（基于账号粉丝数）
    total_followers = sum(
        acc.get("followers", 0)
        for acc in onboarding_data.get("platform_accounts", [])
    )
    if total_followers < 1000:
        profile.growth_stage = GrowthStage.COLD_START.value
    elif total_followers < 20000:
        profile.growth_stage = GrowthStage.EXPANSION.value
    else:
        profile.growth_stage = GrowthStage.MATURE.value

    return profile


# ─────────────────────────────────────────
# 龙虾上下文注入接口
# ─────────────────────────────────────────

def get_lobster_context(tenant_id: str, lobster_id: str) -> dict:
    """
    龙虾执行前调用此接口，获取该客户的完整上下文
    每只龙虾自动获得：
    - 行业知识（Layer 1）
    - 区域知识（Layer 2）
    - 企业专属记忆（Layer 3）
    - 当前增长阶段配置
    
    示例：
    context = get_lobster_context("rongrong_beauty_2026", "inkwriter")
    # context["brand_vocabulary_banned"] → 行业禁词 + 荣荣专属禁词合并
    # context["last_campaign_lessons"]  → 上次活动经验教训
    # context["stage_focus"]            → 当前阶段主力龙虾和策略重点
    """
    bank = EnterpriseMemoryBank()
    merged = bank.get_merged_context(tenant_id)

    # 各龙虾专属过滤（只给需要的字段）
    lobster_field_map = {
        "inkwriter": [
            "brand_vocabulary_positive", "brand_vocabulary_customer",
            "brand_vocabulary_banned", "brand_personality", "brand_taboo_persona",
            "content_tone", "primary_platforms", "peak_content_types",
            "last_campaign_lessons", "customer_profile",
        ],
        "radar": [
            "primary_platforms", "industry_l1", "industry_l2",
            "city_tier", "growth_stage", "intent_keywords",
        ],
        "strategist": [
            # strategist 获得全量上下文（做策略需要完整信息）
        ],
        "dispatcher": [
            "platform_accounts", "best_publishing_hours", "content_capacity",
            "platform_ads_willing", "growth_stage",
        ],
        "echoer": [
            "intent_keywords", "brand_vocabulary_customer",
            "conversion_path", "customer_profile",
        ],
        "catcher": [
            "intent_keywords", "decision_days", "customer_profile",
            "industry_l2", "price_position",
        ],
        "abacus": [
            "key_kpis", "growth_stage", "stage_focus",
            "growth_history", "last_campaign_lessons",
        ],
        "followup": [
            "customer_profile", "decision_days", "conversion_path",
            "brand_vocabulary_positive", "last_campaign_lessons",
        ],
        "commander": [
            # commander 获得全量上下文（编排需要完整信息）
        ],
        "visualizer": [
            "brand_personality", "content_tone", "peak_content_types",
            "primary_platforms", "brand_vocabulary_positive",
        ],
    }

    fields = lobster_field_map.get(lobster_id, [])
    if not fields:
        return merged  # 全量返回

    return {k: merged[k] for k in fields if k in merged}
