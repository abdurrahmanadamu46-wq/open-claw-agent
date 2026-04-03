"""
区域代理体系
Dragon Senate — Regional Agent System

核心战略：
  Dragon Senate 不直接面对所有终端客户。
  通过"区域代理"模式，让本地营销公司/代运营机构/MCN 成为我们的地推网络。
  代理用白标龙虾服务他们的客户（个人博主/KOL/小创业者/中小品牌），
  我们收平台费，代理收差价，双方共赢。

资金模型（快速回笼的核心）：
  代理签约时预付"区域保证金"：
    城市代理：¥19,800（一次性，享受该城市独家权）
    区域代理：¥49,800（一次性，享受3-5个城市）
    省级代理：¥98,000（一次性，享受全省独家）

  保证金 = 预付的平台使用权，不是"押金"，
          对应的是：首年的区域独家权 + 平台训练支持 + 白标配置
  代理每月再按客户坐席付平台费（¥1,200/坐席/月，比直营低20%作为代理优惠）

收入飞轮：
  签10个区域代理 → 立即回笼 ¥198,000~980,000 保证金
  每个代理管理10个客户 → 每月产生 ¥120,000 平台坐席费
  代理自己赚差价（他们向客户收 ¥3,000~8,000/客户/月）

代理的核心武器（平台给的）：
  1. 白标龙虾：龙虾改名换脸，变成代理自己的"AI运营团队"
  2. 代理后台：统一管理所有下游客户，一键查看各客户龙虾工作状态
  3. 行业洞察：代理的客户越多，行业洞察越准，越能打败竞争对手
  4. 品牌素材包：招募下游客户的话术、PPT、演示视频

链路：
  Dragon Senate 总部
    → 区域代理（省/市级，白标+后台+行业洞察）
      → 代理的客户（连锁品牌/个人博主/KOL/小创业者/中小门店）
        → 客户的用户（消费者/粉丝）
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from agent_tier_manager import FLOOR_PRICE, get_agent_tier_manager
from seat_quota_tracker import get_seat_quota_tracker
from sub_agent_manager import get_sub_agent_manager
from white_label_service import get_agent_white_label_service

# ─────────────────────────────────────────
# 代理级别定义
# ─────────────────────────────────────────

class AgentTier(str, Enum):
    CITY = "city"           # 城市代理：单城市独家（地级市）
    REGIONAL = "regional"   # 区域代理：3-5个城市
    PROVINCIAL = "provincial"  # 省级代理：全省独家
    NATIONAL = "national"   # 全国代理（战略级，极少数）


@dataclass
class AgentTierConfig:
    """代理级别配置"""
    tier: str
    name: str
    tagline: str
    
    # 准入门槛
    deposit_fee: int            # 保证金（元，一次性，非退款）
    min_managed_clients: int    # 最低维护客户数（达不到次年不续约）
    
    # 区域权益
    exclusive_territory: str    # 独家区域描述
    territory_scope: int        # 覆盖城市数量（-1=全省）
    
    # 平台优惠
    platform_seat_fee: int      # 每客户坐席月费（元/坐席/月）
    commission_rate: float      # 介绍直营客户的佣金率（%）
    
    # 权限
    white_label: bool           # 是否支持白标（龙虾改名换脸）
    agent_dashboard: bool       # 是否有代理管理后台
    industry_insights: bool     # 是否可获取行业洞察报告
    priority_support: bool      # 是否优先技术支持
    
    # 培训支持
    onboarding_sessions: int    # 平台为代理提供的远程培训次数
    marketing_kit: bool         # 是否提供招募素材包（PPT/话术/演示视频）
    co_sell_support: bool       # 是否可申请平台团队协助大客户拜访


# ─────────────────────────────────────────
# 代理级别注册表
# ─────────────────────────────────────────

AGENT_TIER_CONFIGS: dict[str, AgentTierConfig] = {

    AgentTier.CITY.value: AgentTierConfig(
        tier=AgentTier.CITY.value,
        name="城市代理",
        tagline="一个城市的AI运营赛道，属于你",
        
        deposit_fee=19_800,              # 签约即付，获得该城市独家权
        min_managed_clients=5,           # 每年至少维持5个活跃客户
        
        exclusive_territory="单个地级市",
        territory_scope=1,
        
        platform_seat_fee=1_200,         # 比直营低20%（直营¥1,500/坐席）
        commission_rate=10.0,            # 介绍直营集团客户，佣金10%首年收入
        
        white_label=True,
        agent_dashboard=True,
        industry_insights=True,
        priority_support=False,
        
        onboarding_sessions=3,           # 3次1小时远程培训
        marketing_kit=True,
        co_sell_support=False,
    ),

    AgentTier.REGIONAL.value: AgentTierConfig(
        tier=AgentTier.REGIONAL.value,
        name="区域代理",
        tagline="覆盖3-5个城市，做区域AI运营头部玩家",
        
        deposit_fee=49_800,
        min_managed_clients=15,
        
        exclusive_territory="3-5个地级市（签约时确认城市名单）",
        territory_scope=5,
        
        platform_seat_fee=1_100,         # 比城市代理再低约8%
        commission_rate=12.0,
        
        white_label=True,
        agent_dashboard=True,
        industry_insights=True,
        priority_support=True,
        
        onboarding_sessions=5,
        marketing_kit=True,
        co_sell_support=True,            # 可申请平台协助大客户
    ),

    AgentTier.PROVINCIAL.value: AgentTierConfig(
        tier=AgentTier.PROVINCIAL.value,
        name="省级代理",
        tagline="全省独家，打造省内AI运营生态",
        
        deposit_fee=98_000,
        min_managed_clients=30,
        
        exclusive_territory="全省独家（含省内所有城市）",
        territory_scope=-1,              # -1 = 全省
        
        platform_seat_fee=1_000,
        commission_rate=15.0,
        
        white_label=True,
        agent_dashboard=True,
        industry_insights=True,
        priority_support=True,
        
        onboarding_sessions=8,
        marketing_kit=True,
        co_sell_support=True,
    ),

    AgentTier.NATIONAL.value: AgentTierConfig(
        tier=AgentTier.NATIONAL.value,
        name="全国战略代理",
        tagline="战略级合作，共同定义行业标准",
        
        deposit_fee=0,                   # 战略谈判，不固定
        min_managed_clients=100,
        
        exclusive_territory="全国（特定行业或渠道垂直）",
        territory_scope=-2,             # -2 = 全国
        
        platform_seat_fee=900,
        commission_rate=20.0,
        
        white_label=True,
        agent_dashboard=True,
        industry_insights=True,
        priority_support=True,
        
        onboarding_sessions=99,
        marketing_kit=True,
        co_sell_support=True,
    ),
}


# ─────────────────────────────────────────
# 代理账户
# ─────────────────────────────────────────

@dataclass
class RegionalAgent:
    """
    区域代理账户
    
    一个代理 = 一个白标运营服务商，
    他们用"自己品牌的AI团队"服务下游客户（连锁品牌/个人博主/小创业者）
    """
    agent_id: str
    company_name: str           # 代理公司名称
    contact_name: str           # 对接人姓名
    contact_phone: str          # 联系方式
    city: str                   # 主要城市
    province: str               # 所在省份
    tier: str                   # AgentTier
    
    # 区域权益
    exclusive_cities: list[str] = field(default_factory=list)  # 独家城市列表
    
    # 合同
    signed_at: str = field(default_factory=lambda: datetime.now().isoformat())
    contract_expires_at: str = ""       # 合同到期日（通常1年）
    deposit_paid: int = 0               # 已付保证金（元）
    deposit_paid_at: str = ""
    status: str = "active"              # "pending_deposit" | "active" | "suspended" | "expired"
    
    # 白标配置
    white_label_brand_name: str = ""    # 代理给龙虾起的品牌名（如"天择智能运营团队"）
    white_label_logo_url: str = ""      # 代理的 logo URL
    white_label_primary_color: str = "" # 主题色（十六进制）
    
    # 业绩追踪
    managed_tenant_ids: list[str] = field(default_factory=list)  # 代理名下的客户 tenant_id 列表
    active_client_count: int = 0        # 当前活跃客户数
    total_clients_ever: int = 0         # 历史累计客户数
    
    # 财务
    monthly_platform_fee: int = 0       # 本月平台费（按坐席计算）
    total_platform_fee_paid: int = 0    # 历史累计平台费
    commission_earned: int = 0          # 已获得的介绍佣金（元）
    purchased_seat_count: int = 0       # 已采购席位数（V7：1席=1个社交账号）
    unit_purchase_price: int = 0        # 当前单席采购价
    
    # 绩效
    nps_score: float = 0.0             # 代理下游客户的平均 NPS
    renewal_rate: float = 0.0          # 代理客户续费率（%）
    
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def get_config(self) -> AgentTierConfig:
        return AGENT_TIER_CONFIGS.get(self.tier, AGENT_TIER_CONFIGS[AgentTier.CITY.value])
    
    def is_meeting_min_clients(self) -> bool:
        config = self.get_config()
        return self.active_client_count >= config.min_managed_clients
    
    def calculate_monthly_fee(self) -> int:
        """计算本月应付平台费"""
        config = self.get_config()
        return self.active_client_count * config.platform_seat_fee

    def seat_capacity_remaining(self) -> int:
        return max(0, int(self.purchased_seat_count or 0) - int(self.active_client_count or 0))
    
    def get_renewal_warning(self) -> str | None:
        """
        检查是否需要续约预警
        - 合同即将到期（30天内）
        - 客户数不达标（未达到最低维护量）
        """
        if not self.contract_expires_at:
            return None
        expires = datetime.fromisoformat(self.contract_expires_at)
        days_left = (expires - datetime.now()).days
        
        config = self.get_config()
        warnings = []
        
        if days_left <= 30:
            warnings.append(f"合同将在 {days_left} 天后到期")
        
        if not self.is_meeting_min_clients():
            gap = config.min_managed_clients - self.active_client_count
            warnings.append(f"当前客户数不足（还差 {gap} 个客户达到续约标准）")
        
        return "；".join(warnings) if warnings else None


# ─────────────────────────────────────────
# 代理管理器
# ─────────────────────────────────────────

class RegionalAgentManager:
    """
    区域代理管理器
    
    职责：
    1. 代理签约与保证金记录
    2. 代理下游客户管理（tenant 归属代理）
    3. 每月平台费计算与结算
    4. 代理绩效追踪（NPS/续费率/客户增长）
    5. 白标配置下发（让代理的龙虾有自己的品牌）
    6. 区域独家冲突检测（不允许同一城市两个代理）
    
    使用示例：
      manager = RegionalAgentManager()
      
      # 新代理签约
      agent = manager.sign_agent(
          company_name="深圳星火运营公司",
          contact_name="张总",
          contact_phone="13800138000",
          city="深圳",
          province="广东",
          tier="city",
          exclusive_cities=["深圳"],
      )
      
      # 记录保证金到账
      manager.record_deposit(agent.agent_id, amount=19800)
      
      # 代理新增下游客户
      manager.add_client_to_agent(agent.agent_id, tenant_id="tenant_xxx")
      
      # 月度结算
      fee_report = manager.calculate_monthly_billing(agent.agent_id)
    """

    def __init__(self, data_dir: str = "data/agents") -> None:
        self._data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self._agents_path = os.path.join(data_dir, "agents.json")
        self._agents: dict[str, RegionalAgent] = self._load_agents()
        
        # 区域占用表（city → agent_id，防止区域冲突）
        self._city_exclusivity: dict[str, str] = self._build_exclusivity_map()

    # ── 签约 ────────────────────────────────

    def sign_agent(
        self,
        company_name: str,
        contact_name: str,
        contact_phone: str,
        city: str,
        province: str,
        tier: str,
        exclusive_cities: list[str],
        white_label_brand_name: str = "",
        white_label_primary_color: str = "#1a56db",
    ) -> tuple[RegionalAgent | None, str]:
        """
        新代理签约。
        
        返回：(agent, error_message)
          - 成功：(RegionalAgent, "")
          - 失败：(None, 错误原因)
        
        自动处理：
          - 检查城市是否已有代理（独家冲突检测）
          - 生成代理 ID
          - 设置合同有效期（1年）
          - 设置状态为 pending_deposit（等待保证金到账后激活）
        """
        # 检查区域独家冲突
        conflict = self._check_exclusivity_conflict(exclusive_cities)
        if conflict:
            return None, f"区域冲突：{conflict}"
        
        # 检查级别配置
        tier_config = AGENT_TIER_CONFIGS.get(tier)
        if not tier_config:
            return None, f"无效的代理级别：{tier}"
        
        # 生成代理 ID
        agent_id = f"agent_{datetime.now().strftime('%Y%m%d%H%M%S')}_{company_name[:4]}"
        
        # 合同有效期：1年
        expires_at = (datetime.now() + timedelta(days=365)).isoformat()
        
        agent = RegionalAgent(
            agent_id=agent_id,
            company_name=company_name,
            contact_name=contact_name,
            contact_phone=contact_phone,
            city=city,
            province=province,
            tier=tier,
            exclusive_cities=exclusive_cities,
            contract_expires_at=expires_at,
            deposit_paid=0,
            status="pending_deposit",  # 等待保证金
            white_label_brand_name=white_label_brand_name or f"{company_name}AI团队",
            white_label_primary_color=white_label_primary_color,
        )
        
        self._agents[agent_id] = agent
        self._save()
        
        return agent, ""

    def record_deposit(
        self,
        agent_id: str,
        amount: int,
        payment_ref: str = "",
    ) -> dict:
        """
        记录保证金到账，激活代理资格。
        
        保证金到账后：
          - 代理状态从 pending_deposit → active
          - 城市独家权正式生效（写入独家占用表）
          - 下发白标配置（龙虾改名换脸）
        """
        agent = self._agents.get(agent_id)
        if not agent:
            return {"success": False, "error": "代理不存在"}
        
        tier_config = agent.get_config()
        required = tier_config.deposit_fee
        
        if amount < required:
            return {
                "success": False,
                "error": f"保证金不足：应付 ¥{required:,}，实付 ¥{amount:,}",
            }
        
        # 激活代理
        agent.deposit_paid = amount
        agent.deposit_paid_at = datetime.now().isoformat()
        agent.status = "active"
        agent.updated_at = datetime.now().isoformat()
        
        # 锁定独家区域
        for city in agent.exclusive_cities:
            self._city_exclusivity[city] = agent_id
        
        self._save()
        
        return {
            "success": True,
            "agent_id": agent_id,
            "company": agent.company_name,
            "tier": tier_config.name,
            "exclusive_cities": agent.exclusive_cities,
            "contract_expires": agent.contract_expires_at,
            "activation_message": (
                f"🎉 {agent.company_name} 已正式成为 Dragon Senate {tier_config.name}！\n"
                f"独家区域：{', '.join(agent.exclusive_cities)}\n"
                f"合同有效至：{agent.contract_expires_at[:10]}\n"
                f"白标品牌名：{agent.white_label_brand_name}\n"
                f"下一步：安排3次产品培训，配置白标龙虾，开始招募下游客户。"
            ),
        }

    # ── 客户管理 ─────────────────────────────

    def add_client_to_agent(
        self,
        agent_id: str,
        tenant_id: str,
        client_name: str = "",
    ) -> dict:
        """
        将一个下游客户(tenant)归入代理名下。
        
        效果：
          - tenant 的龙虾自动使用代理的白标配置
          - 代理的客户数+1，影响月度平台费
          - 代理仪表盘可以看到这个客户的龙虾工作状态
        """
        agent = self._agents.get(agent_id)
        if not agent:
            return {"success": False, "error": "代理不存在"}
        if agent.status != "active":
            return {"success": False, "error": f"代理状态异常：{agent.status}"}
        if tenant_id in agent.managed_tenant_ids:
            return {"success": False, "error": "该客户已在此代理名下"}
        
        agent.managed_tenant_ids.append(tenant_id)
        agent.active_client_count += 1
        agent.total_clients_ever += 1
        agent.monthly_platform_fee = agent.calculate_monthly_fee()
        agent.updated_at = datetime.now().isoformat()
        self._save()
        
        return {
            "success": True,
            "agent_id": agent_id,
            "tenant_id": tenant_id,
            "active_clients": agent.active_client_count,
            "new_monthly_fee": agent.monthly_platform_fee,
        }

    def remove_client_from_agent(
        self,
        agent_id: str,
        tenant_id: str,
        reason: str = "",
    ) -> dict:
        """移除下游客户（客户流失/转移）"""
        agent = self._agents.get(agent_id)
        if not agent:
            return {"success": False, "error": "代理不存在"}
        if tenant_id not in agent.managed_tenant_ids:
            return {"success": False, "error": "该客户不在此代理名下"}
        
        agent.managed_tenant_ids.remove(tenant_id)
        agent.active_client_count = max(0, agent.active_client_count - 1)
        agent.monthly_platform_fee = agent.calculate_monthly_fee()
        agent.updated_at = datetime.now().isoformat()
        self._save()
        
        return {
            "success": True,
            "removed_tenant_id": tenant_id,
            "reason": reason,
            "remaining_clients": agent.active_client_count,
            "new_monthly_fee": agent.monthly_platform_fee,
        }

    # ── 月度结算 ─────────────────────────────

    def calculate_monthly_billing(self, agent_id: str) -> dict:
        """
        计算代理的月度平台费账单。
        
        返回：
        {
            "agent_id": "...",
            "company": "...",
            "billing_month": "2026-04",
            "active_clients": 15,
            "seat_fee": 1200,
            "total_fee": 18000,
            "vs_direct_price": 22500,  # 如果这些客户直接买直营版要付的
            "agent_savings": 4500,     # 代理方案省的
            "payment_due_date": "...",
        }
        """
        agent = self._agents.get(agent_id)
        if not agent:
            return {"error": "代理不存在"}
        
        config = agent.get_config()
        total_fee = agent.active_client_count * config.platform_seat_fee
        direct_price = agent.active_client_count * 1_500  # 直营价
        
        return {
            "agent_id": agent_id,
            "company": agent.company_name,
            "tier": config.name,
            "billing_month": datetime.now().strftime("%Y-%m"),
            "active_clients": agent.active_client_count,
            "seat_fee_per_client": config.platform_seat_fee,
            "total_monthly_fee": total_fee,
            "vs_direct_price_total": direct_price,
            "agent_discount_savings": direct_price - total_fee,
            "is_meeting_min_clients": agent.is_meeting_min_clients(),
            "min_clients_required": config.min_managed_clients,
            "renewal_warning": agent.get_renewal_warning(),
            "payment_due_date": (
                datetime.now().replace(day=1) + timedelta(days=32)
            ).replace(day=10).strftime("%Y-%m-%d"),  # 次月10日
        }

    def generate_monthly_report(self) -> dict:
        """
        生成平台级代理月报（运营控制台用）
        """
        total_deposit = 0
        total_monthly_fee = 0
        total_clients = 0
        agents_by_tier: dict[str, int] = {}
        agents_at_risk: list[dict] = []
        
        for agent in self._agents.values():
            if agent.status != "active":
                continue
            
            config = agent.get_config()
            total_deposit += agent.deposit_paid
            monthly_fee = agent.calculate_monthly_fee()
            total_monthly_fee += monthly_fee
            total_clients += agent.active_client_count
            
            tier_name = config.name
            agents_by_tier[tier_name] = agents_by_tier.get(tier_name, 0) + 1
            
            # 检查风险代理（客户数不达标 or 合同快到期）
            warning = agent.get_renewal_warning()
            if warning:
                agents_at_risk.append({
                    "agent_id": agent.agent_id,
                    "company": agent.company_name,
                    "warning": warning,
                })
        
        return {
            "report_month": datetime.now().strftime("%Y-%m"),
            "total_agents": len([a for a in self._agents.values() if a.status == "active"]),
            "agents_by_tier": agents_by_tier,
            "total_deposit_collected": total_deposit,   # 累计保证金回笼
            "monthly_platform_fee": total_monthly_fee,  # 本月平台费收入
            "total_managed_clients": total_clients,     # 代理管理的总客户数
            "agents_at_risk": agents_at_risk,
            "coverage_cities": list(self._city_exclusivity.keys()),
            "coverage_city_count": len(self._city_exclusivity),
        }

    # ── 白标配置下发 ─────────────────────────

    def get_white_label_config(self, agent_id: str) -> dict:
        """
        获取代理的白标配置。
        
        LobsterRunner 在给代理下游客户执行任务时，
        会调用此接口，把龙虾的名字/品牌替换为代理设定的白标品牌。
        
        示例输出：
        {
            "brand_name": "天择智能运营团队",
            "lobster_aliases": {
                "commander": "战略总监-Alex",
                "strategist": "策略专家-苏苏",
                "inkwriter": "内容创意-小雅",
                ...
            },
            "primary_color": "#e67e22",
            "logo_url": "https://...",
        }
        """
        agent = self._agents.get(agent_id)
        if not agent or not agent.get_config().white_label:
            return {}
        
        brand = agent.white_label_brand_name or "AI运营团队"
        
        # 默认的白标龙虾别名（代理可以自定义，这里是默认值）
        default_aliases = {
            "commander": f"总指挥-{brand[:2]}",
            "strategist": "策略专家",
            "radar": "市场雷达",
            "inkwriter": "内容创意",
            "visualizer": "视觉设计",
            "dispatcher": "执行协调",
            "echoer": "社群运营",
            "catcher": "商机挖掘",
            "followup": "跟进专员",
            "abacus": "数据分析",
        }
        
        return {
            "agent_id": agent_id,
            "brand_name": brand,
            "lobster_aliases": default_aliases,
            "primary_color": agent.white_label_primary_color,
            "logo_url": agent.white_label_logo_url,
            "is_white_label_active": True,
        }

    # ── 独家区域冲突检测 ─────────────────────

    def _check_exclusivity_conflict(self, cities: list[str]) -> str:
        """检查城市是否已被其他代理独占，返回冲突描述或空字符串"""
        conflicts = []
        for city in cities:
            existing_agent_id = self._city_exclusivity.get(city)
            if existing_agent_id:
                existing = self._agents.get(existing_agent_id)
                if existing and existing.status == "active":
                    conflicts.append(f"{city}（已被 {existing.company_name} 独占）")
        return "、".join(conflicts) if conflicts else ""

    def _build_exclusivity_map(self) -> dict[str, str]:
        """从已有代理数据重建城市独家占用表"""
        city_map = {}
        for agent in self._agents.values():
            if agent.status == "active":
                for city in agent.exclusive_cities:
                    city_map[city] = agent.agent_id
        return city_map

    # ── 代理招募计算器（对外展示用）────────────

    @staticmethod
    def calculate_agent_roi(
        tier: str,
        managed_clients: int,
        avg_client_monthly_fee: int = 5_000,  # 代理向下游收的平均月费
    ) -> dict:
        """
        计算代理的 ROI（用于招募代理时展示）
        
        参数：
          tier: 代理级别
          managed_clients: 代理打算管理的客户数
          avg_client_monthly_fee: 代理向下游客户收的月费（元，代理自定）
        
        示例：
          calculate_agent_roi("city", 20, 6000)
          → 保证金¥19,800，月收入¥120,000，月平台费¥24,000，月净利¥96,000
        """
        config = AGENT_TIER_CONFIGS.get(tier)
        if not config:
            return {}
        
        deposit = config.deposit_fee
        monthly_platform_fee = managed_clients * config.platform_seat_fee
        monthly_revenue = managed_clients * avg_client_monthly_fee
        monthly_gross_profit = monthly_revenue - monthly_platform_fee
        
        # 代理自身运营成本估算（人力/办公室等）
        agent_ops_cost = max(5_000, managed_clients * 300)  # 约300元/客户/月的人力摊销
        monthly_net_profit = monthly_gross_profit - agent_ops_cost
        
        deposit_payback_months = (
            int(deposit / monthly_net_profit) + 1 if monthly_net_profit > 0 else 999
        )
        
        return {
            "tier": config.name,
            "territory": config.exclusive_territory,
            "deposit": deposit,
            "managed_clients": managed_clients,
            "monthly_revenue": monthly_revenue,
            "monthly_platform_fee": monthly_platform_fee,
            "monthly_gross_profit": monthly_gross_profit,
            "estimated_ops_cost": agent_ops_cost,
            "monthly_net_profit": monthly_net_profit,
            "gross_margin_pct": round(monthly_gross_profit / monthly_revenue * 100, 1),
            "deposit_payback_months": deposit_payback_months,
            "annual_net_profit": monthly_net_profit * 12,
            "summary": (
                f"{config.name}（{config.exclusive_territory}）\n"
                f"保证金：¥{deposit:,}（一次性）\n"
                f"管理 {managed_clients} 个客户，每客户收 ¥{avg_client_monthly_fee:,}/月\n"
                f"月收入：¥{monthly_revenue:,}\n"
                f"月平台费：¥{monthly_platform_fee:,}\n"
                f"月净利润：¥{monthly_net_profit:,}\n"
                f"保证金回本：{deposit_payback_months} 个月\n"
                f"年净利润：¥{monthly_net_profit * 12:,}"
            ),
        }

    # ── 持久化 ────────────────────────────────

    def _load_agents(self) -> dict[str, RegionalAgent]:
        if not os.path.exists(self._agents_path):
            return {}
        try:
            with open(self._agents_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return {k: RegionalAgent(**v) for k, v in raw.items()}
        except Exception:
            return {}

    def _save(self) -> None:
        import dataclasses
        with open(self._agents_path, "w", encoding="utf-8") as f:
            json.dump(
                {k: dataclasses.asdict(v) for k, v in self._agents.items()},
                f, ensure_ascii=False, indent=2,
            )

    # ── V7 代理门户扩展 ────────────────────────────────

    def register_reseller_agent(
        self,
        *,
        company_name: str,
        contact_name: str,
        contact_phone: str,
        city: str,
        province: str,
        seat_count: int,
        contact_wechat: str = "",
        white_label_brand_name: str = "",
    ) -> dict[str, Any]:
        normalized_seats = max(0, int(seat_count or 0))
        if normalized_seats < 20:
            raise ValueError(f"代理商最低需管理20席，当前申请{normalized_seats}席")
        tier_info = get_agent_tier_manager().get_agent_tier(normalized_seats)
        tier_code = {
            "起步代理": AgentTier.CITY.value,
            "区域代理": AgentTier.REGIONAL.value,
            "省级代理": AgentTier.PROVINCIAL.value,
            "总代理": AgentTier.NATIONAL.value,
        }.get(str(tier_info["name"]), AgentTier.CITY.value)
        default_exclusive = [city] if city else [province]
        agent, error = self.sign_agent(
            company_name=company_name,
            contact_name=contact_name,
            contact_phone=contact_phone,
            city=city,
            province=province,
            tier=tier_code,
            exclusive_cities=default_exclusive,
            white_label_brand_name=white_label_brand_name or f"{company_name}AI团队",
        )
        if agent is None:
            raise ValueError(error or "register_agent_failed")
        agent.purchased_seat_count = normalized_seats
        agent.unit_purchase_price = int(tier_info["unit_purchase_price"] or 0)
        agent.updated_at = datetime.now().isoformat()
        self._agents[agent.agent_id] = agent
        self._save()
        return {
            "agent_id": agent.agent_id,
            "company_name": agent.company_name,
            "contact_name": agent.contact_name,
            "contact_phone": agent.contact_phone,
            "contact_wechat": contact_wechat,
            "region": f"{province}/{city}".strip("/"),
            "tier": tier_info["name"],
            "tier_code": tier_info["code"],
            "total_seats_managed": normalized_seats,
            "unit_purchase_price": tier_info["unit_purchase_price"],
            "floor_price": FLOOR_PRICE,
            "portal_access_enabled": True,
            "white_label_enabled": normalized_seats >= 20,
            "joined_at": agent.created_at,
            "is_active": agent.status in {"active", "pending_deposit"},
        }

    def set_purchased_seats(self, agent_id: str, seat_count: int) -> dict[str, Any]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        old = int(agent.purchased_seat_count or 0)
        next_count = max(0, int(seat_count or 0))
        tier_change = get_agent_tier_manager().check_tier_upgrade(agent_id, old_seats=old, new_seats=next_count)
        tier_info = get_agent_tier_manager().get_agent_tier(next_count)
        agent.purchased_seat_count = next_count
        agent.unit_purchase_price = int(tier_info["unit_purchase_price"] or 0)
        agent.updated_at = datetime.now().isoformat()
        self._save()
        return {
            "agent_id": agent_id,
            "old_seats": old,
            "new_seats": next_count,
            "tier_change": tier_change,
            "unit_purchase_price": agent.unit_purchase_price,
        }

    async def assign_seat_to_agent(
        self,
        *,
        agent_id: str,
        seat_id: str,
        tenant_id: str,
        seat_name: str,
        platform: str,
        account_username: str,
        client_name: str,
    ) -> dict[str, Any]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        current_seats = await get_seat_quota_tracker().list_seats_for_agent(agent_id)
        if len(current_seats) >= max(0, int(agent.purchased_seat_count or 0)):
            raise ValueError("已达到购买席位上限，请先升级席位数")
        seat = await get_seat_quota_tracker().assign_seat(
            seat_id=seat_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            seat_name=seat_name,
            platform=platform,
            account_username=account_username,
            client_name=client_name,
        )
        if tenant_id not in agent.managed_tenant_ids:
            agent.managed_tenant_ids.append(tenant_id)
        agent.active_client_count = len({item["client_name"] or item["seat_id"] for item in await get_seat_quota_tracker().list_seats_for_agent(agent_id)})
        agent.total_clients_ever = max(agent.total_clients_ever, agent.active_client_count)
        agent.monthly_platform_fee = agent.calculate_monthly_fee()
        agent.updated_at = datetime.now().isoformat()
        self._save()
        return seat

    async def list_agent_seats_detailed(self, agent_id: str) -> list[dict[str, Any]]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        return await get_seat_quota_tracker().list_seats_for_agent(agent_id)

    async def build_dashboard(self, agent_id: str) -> dict[str, Any]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        seats = await get_seat_quota_tracker().list_seats_for_agent(agent_id)
        quota_totals: dict[str, dict[str, Any]] = {}
        for seat in seats:
            for resource, quota in seat["quotas"].items():
                entry = quota_totals.setdefault(resource, {"limit": 0, "used": 0, "usage_pct": 0.0})
                entry["limit"] += int(quota["limit"])
                entry["used"] += int(quota["used"])
        for resource, entry in quota_totals.items():
            entry["usage_pct"] = round((int(entry["used"]) / max(1, int(entry["limit"]))) * 100, 1) if int(entry["limit"]) else 0.0
        quota_summary = {
            "seat_count": len(seats),
            "quotas": quota_totals,
            "overall_health": get_seat_quota_tracker()._calc_overall_health(quota_totals) if quota_totals else "green",
            "seats": seats,
        }
        purchase_price = int(agent.unit_purchase_price or get_agent_tier_manager().get_agent_tier(agent.purchased_seat_count or 20)["unit_purchase_price"])
        tier_info = get_agent_tier_manager().get_agent_tier(agent.purchased_seat_count or 20)
        resell_price = int(tier_info.get("suggested_resell_unit_price") or purchase_price)
        total_seats = len(seats)
        platform_cost = purchase_price * total_seats
        monthly_revenue = resell_price * total_seats
        ops_cost = max(20_000, total_seats * 600)
        estimated_net_profit = monthly_revenue - platform_cost - ops_cost
        content_published = {
            "video": sum(int(item["quotas"]["video"]["used"]) for item in seats),
            "image": sum(int(item["quotas"]["image"]["used"]) for item in seats),
            "customer_interactions": sum(int(item["quotas"]["customer_interactions"]["used"]) for item in seats),
        }
        top_seats = sorted(
            (
                {
                    "seat_id": seat["seat_id"],
                    "seat_name": seat["seat_name"],
                    "score": round(
                        sum(float(quota["usage_pct"]) for quota in seat["quotas"].values()) / max(1, len(seat["quotas"])),
                        1,
                    ),
                }
                for seat in seats
            ),
            key=lambda item: item["score"],
            reverse=True,
        )[:5]
        return {
            "agent_id": agent_id,
            "tier": tier_info["name"],
            "total_seats": int(agent.purchased_seat_count or 0),
            "active_seats": total_seats,
            "monthly_revenue": monthly_revenue,
            "platform_cost": platform_cost,
            "estimated_net_profit": estimated_net_profit,
            "seat_quota_summary": quota_summary,
            "content_published_this_month": content_published,
            "top_performing_seats": top_seats,
            "white_label": get_agent_white_label_service().get_brand_config(
                agent_id,
                seat_count=int(agent.purchased_seat_count or 0),
                fallback_brand=agent.white_label_brand_name or agent.company_name,
            ),
        }

    def save_white_label_config(
        self,
        agent_id: str,
        *,
        brand_name: str,
        logo_url: str = "",
        primary_color: str = "#0ea5e9",
        lobster_names: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        config = get_agent_white_label_service().save_brand_config(
            agent_id,
            seat_count=int(agent.purchased_seat_count or 0),
            brand_name=brand_name,
            logo_url=logo_url,
            primary_color=primary_color,
            lobster_names=lobster_names,
        )
        agent.white_label_brand_name = str(config.get("brand_name") or agent.white_label_brand_name)
        agent.white_label_logo_url = str(config.get("logo_url") or agent.white_label_logo_url)
        agent.white_label_primary_color = str(config.get("primary_color") or agent.white_label_primary_color)
        agent.updated_at = datetime.now().isoformat()
        self._save()
        return config

    def create_sub_agent(
        self,
        *,
        parent_agent_id: str,
        company_name: str,
        contact_name: str,
        region: str,
        allocated_seats: int,
    ) -> dict[str, Any]:
        agent = self._agents.get(parent_agent_id)
        if not agent:
            raise KeyError(parent_agent_id)
        if int(allocated_seats or 0) <= 0:
            raise ValueError("allocated_seats must be > 0")
        if int(allocated_seats or 0) > max(0, int(agent.purchased_seat_count or 0)):
            raise ValueError("allocated_seats exceeds purchased seat count")
        return get_sub_agent_manager().create_sub_agent(
            parent_agent_id=parent_agent_id,
            company_name=company_name,
            contact_name=contact_name,
            region=region,
            allocated_seats=allocated_seats,
        )

    def get_sub_agent_tree(self, agent_id: str) -> dict[str, Any]:
        agent = self._agents.get(agent_id)
        if not agent:
            raise KeyError(agent_id)
        return {
            "agent": {
                "agent_id": agent.agent_id,
                "company_name": agent.company_name,
                "tier": agent.get_config().name,
                "purchased_seat_count": agent.purchased_seat_count,
            },
            "children": get_sub_agent_manager().list_children(agent_id),
        }


_regional_agent_manager: RegionalAgentManager | None = None


def get_regional_agent_manager() -> RegionalAgentManager:
    global _regional_agent_manager
    if _regional_agent_manager is None:
        _regional_agent_manager = RegionalAgentManager()
    return _regional_agent_manager
