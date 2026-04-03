"""
增长策略引擎
Dragon Senate — Growth Strategy Engine

苏思（脑虫虾）升级后的核心输出模块：
- 读取企业记忆库三层上下文
- 生成 3-5 个增长策略备选（含利弊分析）
- 方案拆解为任务树（DAG），分配给各业务虾
- 识别智能体化（自动化）机会

协作流程：
  Commander → 读取企业档案 → strategist 生成 StrategyRouteV2
  → Commander 拆解 MissionDAG → 各业务虾并行执行
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


# ─────────────────────────────────────────
# 增长策略 v2 数据结构
# ─────────────────────────────────────────

class StrategyType(str, Enum):
    CONTENT_GROWTH = "内容增长"        # 通过内容积累粉丝/曝光
    EVENT_ACTIVATION = "活动引流"      # 节点活动拉动到店/转化
    REFERRAL_VIRAL = "口碑裂变"        # 老带新/UGC传播
    REACTIVATION = "沉睡唤醒"         # 激活沉默客户/粉丝
    UPSELL_UPGRADE = "客单升级"        # 提升现有客户消费层级
    PRIVATE_TRAFFIC = "私域深耕"       # 微信/社群精细化运营
    SEASONAL_CAMPAIGN = "季节节点"     # 节假日/季节性营销

class TaskNodeStatus(str, Enum):
    PENDING = "待执行"
    IN_PROGRESS = "执行中"
    COMPLETED = "已完成"
    BLOCKED = "被阻塞"
    FAILED = "失败"


@dataclass
class StrategyOption:
    """单个增长策略备选方案"""
    strategy_id: str                       # 如 "s1_content_growth"
    strategy_type: str                     # StrategyType 枚举值
    title: str                             # 简短标题
    one_liner: str                         # 一句话描述
    rationale: str                         # 为什么选这个策略（基于企业档案的定制理由）
    target_segment: str                    # 目标用户群（精确到行为特征）
    expected_outcome: str                  # 预期产出（具体数字）
    timeline_weeks: int                    # 预计执行周期（周）
    resource_requirement: dict             # 资源需求 {"content_per_week": 3, "budget": 1000}
    risk_factors: list[str]               # 风险因素
    pros: list[str]                        # 优势
    cons: list[str]                        # 劣势
    prerequisite: list[str]               # 前提条件（缺少则不推荐）
    automation_opportunities: list[str]   # 可自动化的环节（苏思新能力）
    recommended: bool = False             # 是否为推荐策略


@dataclass
class TaskNode:
    """任务树中的单个节点"""
    node_id: str
    title: str
    assigned_lobster: str                 # 执行龙虾 canonical_id
    input_artifact: str                   # 需要什么输入工件
    output_artifact: str                  # 产出什么工件
    depends_on: list[str] = field(default_factory=list)  # 依赖的 node_id 列表
    estimated_hours: float = 1.0
    status: str = TaskNodeStatus.PENDING.value
    automation_level: str = "manual"      # "manual" | "semi-auto" | "full-auto"
    notes: str = ""


@dataclass
class MissionDAG:
    """
    任务有向无环图（从策略到执行的完整任务树）
    Commander 负责维护和调度
    """
    mission_id: str
    tenant_id: str
    strategy_id: str                      # 关联的策略
    campaign_name: str
    nodes: list[TaskNode] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    status: str = "active"

    def get_ready_nodes(self) -> list[TaskNode]:
        """返回当前可以开始执行的节点（所有依赖已完成）"""
        completed_ids = {n.node_id for n in self.nodes if n.status == TaskNodeStatus.COMPLETED.value}
        ready = []
        for node in self.nodes:
            if node.status == TaskNodeStatus.PENDING.value:
                if all(dep in completed_ids for dep in node.depends_on):
                    ready.append(node)
        return ready

    def get_critical_path(self) -> list[str]:
        """返回关键路径（最长依赖链）"""
        # 简单实现：找最长的依赖链
        def depth(node_id: str, memo: dict) -> int:
            if node_id in memo:
                return memo[node_id]
            node = next((n for n in self.nodes if n.node_id == node_id), None)
            if not node or not node.depends_on:
                return 0
            d = 1 + max(depth(dep, memo) for dep in node.depends_on)
            memo[node_id] = d
            return d

        memo = {}
        terminal_nodes = [n for n in self.nodes if not any(n.node_id in m.depends_on for m in self.nodes)]
        if not terminal_nodes:
            return []
        deepest = max(terminal_nodes, key=lambda n: depth(n.node_id, memo))

        # 回溯路径
        path = [deepest.node_id]
        current = deepest
        while current.depends_on:
            dep_id = current.depends_on[0]
            path.insert(0, dep_id)
            current = next((n for n in self.nodes if n.node_id == dep_id), None)
            if not current:
                break
        return path


@dataclass
class StrategyRouteV2:
    """
    苏思升级后的核心输出工件（StrategyRoute V2）
    
    相比 V1 新增：
    - 3-5个策略备选（不是单一策略）
    - 每个策略有利弊和风险分析
    - 自动化机会识别（苏思新技能）
    - 任务 DAG 拆解
    - 客户确认机制
    """
    route_id: str
    tenant_id: str
    campaign_context: str                 # 本次活动背景（如："618大促 + 暑期季节节点"）
    business_goal: str                    # 明确的商业目标（只有1个主目标）
    time_window: str                      # 执行时间窗（如："2026-06-01 至 2026-06-30"）

    strategy_options: list[StrategyOption] = field(default_factory=list)
    selected_strategy_ids: list[str] = field(default_factory=list)  # 客户/operator 选定后填入

    # 选定策略后生成
    mission_dag: MissionDAG | None = None

    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    confirmed_at: str = ""                # 客户确认时间
    status: str = "draft"                # "draft" | "confirmed" | "executing" | "completed"

    def get_recommended_strategy(self) -> StrategyOption | None:
        return next((s for s in self.strategy_options if s.recommended), None)

    def confirm_strategy(self, selected_ids: list[str]) -> None:
        """客户/operator 确认策略后调用"""
        self.selected_strategy_ids = selected_ids
        self.confirmed_at = datetime.now().isoformat()
        self.status = "confirmed"


# ─────────────────────────────────────────
# 增长策略生成器
# ─────────────────────────────────────────

class GrowthStrategyEngine:
    """
    苏思（脑虫虾）的策略生成核心
    
    调用方式：
    engine = GrowthStrategyEngine()
    route = engine.generate_strategy_options(
        tenant_id="rongrong_beauty_2026",
        campaign_context="母亲节大促活动",
        business_goal="到店新客增加30人",
        time_window="2026-05-01 至 2026-05-20",
    )
    """

    def generate_strategy_options(
        self,
        tenant_id: str,
        campaign_context: str,
        business_goal: str,
        time_window: str,
    ) -> StrategyRouteV2:
        """
        生成 3-5 个增长策略备选
        
        内部流程：
        1. 读取企业记忆三层上下文
        2. 根据增长阶段筛选适合的策略类型
        3. 每个策略进行可行性评估（资源 vs 预期）
        4. 标记推荐策略（最优性价比）
        5. 识别自动化机会
        """
        from enterprise_memory import EnterpriseMemoryBank

        bank = EnterpriseMemoryBank()
        ctx = bank.get_merged_context(tenant_id)

        if "error" in ctx:
            raise ValueError(f"无法读取企业档案: {ctx['error']}")

        route_id = f"route_{tenant_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        route = StrategyRouteV2(
            route_id=route_id,
            tenant_id=tenant_id,
            campaign_context=campaign_context,
            business_goal=business_goal,
            time_window=time_window,
        )

        growth_stage = ctx.get("growth_stage", "冷启动")
        weekly_capacity = ctx.get("content_capacity", {}).get("weekly_max", 2)
        ads_ok = ctx.get("content_capacity", {}).get("platform_ads_willing", False)
        city_tier = ctx.get("city_tier", "三线城市")
        price_pos = ctx.get("price_position", "中端")

        # 历史教训（避免重蹈覆辙）
        past_failures = [
            m for m in ctx.get("last_campaign_lessons", [])
            if m.startswith("注意：")
        ]

        # ── 策略1：内容增长 ──
        route.strategy_options.append(StrategyOption(
            strategy_id="s1_content_growth",
            strategy_type=StrategyType.CONTENT_GROWTH.value,
            title="垂直内容矩阵爆发",
            one_liner="集中生产3-5条高质量内容，打造爆款→引流到私域",
            rationale=f"当前账号处于{growth_stage}，内容质量是流量的核心驱动力。{city_tier}的算法对本地内容有CTR加成。",
            target_segment="在平台刷到我们内容的潜在到店客户",
            expected_outcome="至少1条内容完播率>35%，带动私信量增加20%",
            timeline_weeks=3,
            resource_requirement={
                "content_per_week": min(3, weekly_capacity + 1),
                "budget": 500,
                "lobsters": ["radar", "inkwriter", "visualizer", "dispatcher"],
            },
            risk_factors=["内容生产质量不稳定", "单条爆款不可预测"],
            pros=["低成本", "可复用爆款公式", "长尾效应"],
            cons=["见效慢（2-4周）", "对拍摄能力有一定要求"],
            prerequisite=["账号健康状态为绿色"],
            automation_opportunities=[
                "radar 自动监控竞品内容 CTR，每周输出热点简报",
                "inkwriter 自动生成3个差异化版本文案",
                "dispatcher 自动选择最优发布时间窗",
            ],
            recommended=(growth_stage in ["冷启动", "扩张期"]),
        ))

        # ── 策略2：活动引流 ──
        activity_risk = "避免低价吸引薅羊毛客户" if "低质量客户" in str(past_failures) else "活动设计门槛"
        route.strategy_options.append(StrategyOption(
            strategy_id="s2_event_activation",
            strategy_type=StrategyType.EVENT_ACTIVATION.value,
            title=f"{campaign_context}专项活动",
            one_liner="设计有门槛的节点活动，内容+私域双线引流到店",
            rationale=f"节点活动能在短期内集中引爆流量，{campaign_context}是天然流量窗口。关键：活动设计要有客单价门槛（{price_pos}定位不适合无门槛优惠）。",
            target_segment="有消费意向、符合客单价区间的潜在客户",
            expected_outcome="活动期间新客到店>25人，客单价≥历史均值85%",
            timeline_weeks=2,
            resource_requirement={
                "content_per_week": min(2, weekly_capacity),
                "budget": 800,
                "lobsters": ["strategist", "inkwriter", "dispatcher", "echoer", "catcher"],
            },
            risk_factors=[activity_risk, "活动期间店内接待压力增大"],
            pros=["短期见效快", "可精准控制到店节奏"],
            cons=["需要设计活动规则", "执行期间店内压力大", "高端定位要避免促销感"],
            prerequisite=["不在店内繁忙期（如周末不适合做大促活动）"],
            automation_opportunities=[
                "echoer 自动监控评论区活动咨询，按意向级别分类移交",
                "catcher 自动评分参与活动的用户意向",
                "followup 自动发送活动后的跟进话术",
            ],
            recommended=(growth_stage == "扩张期"),
        ))

        # ── 策略3：口碑裂变 ──
        wom_multiplier = 2.5 if city_tier == "三线城市" else 1.5
        route.strategy_options.append(StrategyOption(
            strategy_id="s3_referral_viral",
            strategy_type=StrategyType.REFERRAL_VIRAL.value,
            title="老顾客口碑裂变计划",
            one_liner="激活现有老顾客，设计分享激励，让顾客成为内容创作者",
            rationale=f"{city_tier}熟人经济强，口碑传播效率是一线城市{wom_multiplier}倍。老顾客带来的新客信任度更高，决策周期更短。",
            target_segment="现有VIP顾客（消费≥2次）",
            expected_outcome="新客中老带新占比提升至25%，转化率比陌生新客高40%",
            timeline_weeks=4,
            resource_requirement={
                "content_per_week": 1,
                "budget": 1500,
                "lobsters": ["followup", "echoer", "inkwriter"],
            },
            risk_factors=["激励设计不当可能降低品牌调性（高端定位不适合粗糙的返佣机制）"],
            pros=["获客质量高", "成本低于付费获客", "复利效应"],
            cons=["需要精心设计激励机制", "见效慢（需要老客配合）"],
            prerequisite=["有一定存量老客基础（建议≥50人）"],
            automation_opportunities=[
                "followup 自动识别高满意度老客，发送邀请话术",
                "catcher 自动识别老带新转化的线索来源",
            ],
            recommended=(growth_stage == "成熟期"),
        ))

        # ── 策略4：沉睡唤醒（如果有历史客户数据）──
        route.strategy_options.append(StrategyOption(
            strategy_id="s4_reactivation",
            strategy_type=StrategyType.REACTIVATION.value,
            title="沉睡客户专项唤醒",
            one_liner="精准触达90天未到店的老客，用个性化话术重新激活",
            rationale="已有关系的老客复购成本远低于新客获取，且成交速度更快。特别适合作为活动期间的补充策略。",
            target_segment="90天以上未到店的有效历史客户",
            expected_outcome="沉睡客户激活率>12%，复购贡献>20%的活动期间收入",
            timeline_weeks=2,
            resource_requirement={
                "content_per_week": 0,
                "budget": 200,
                "lobsters": ["followup", "catcher"],
            },
            risk_factors=["过度打扰可能导致拉黑", "需要有客户微信/联系方式"],
            pros=["成本极低", "成交速度快", "可并行于其他策略"],
            cons=["依赖现有客户数据质量"],
            prerequisite=["有沉睡客户微信/联系方式数据"],
            automation_opportunities=[
                "followup 按沉睡时长自动分级触达（90天/180天/1年+）",
                "catcher 自动标记响应/未响应，更新客户状态",
            ],
            recommended=False,
        ))

        # ── 策略5：私域深耕（如果微信私域强）──
        if ctx.get("preferred_channels", {}).get("wechat_private") in ["极强", "强"]:
            route.strategy_options.append(StrategyOption(
                strategy_id="s5_private_traffic",
                strategy_type=StrategyType.PRIVATE_TRAFFIC.value,
                title="微信私域精细化运营",
                one_liner="建立企业微信/社群矩阵，把公域流量沉淀为高粘性私域客户",
                rationale=f"{city_tier}微信私域渗透率远高于其他城市，私域客户复购率通常是公域的3-5倍。",
                target_segment="已加微信的潜在客户和老客户",
                expected_outcome="微信私域客户月活跃率>30%，私域成交占比>25%",
                timeline_weeks=8,
                resource_requirement={
                    "content_per_week": 1,
                    "budget": 300,
                    "lobsters": ["echoer", "followup", "inkwriter"],
                },
                risk_factors=["需要持续输出内容维护社群活跃度", "长期工程见效慢"],
                pros=["护城河高", "客户粘性强", "成交成本极低"],
                cons=["需要长期持续维护", "短期内难以量化ROI"],
                prerequisite=["已有企业微信或个人微信池"],
                automation_opportunities=[
                    "echoer 自动回复社群常见问题",
                    "followup 定时发送个性化关怀内容",
                ],
                recommended=False,
            ))

        return route

    def decompose_to_dag(
        self,
        route: StrategyRouteV2,
        selected_strategy_id: str,
    ) -> MissionDAG:
        """
        将选定策略拆解为任务 DAG
        Commander 调用此方法获得可执行的任务树
        """
        strategy = next(
            (s for s in route.strategy_options if s.strategy_id == selected_strategy_id),
            None,
        )
        if not strategy:
            raise ValueError(f"策略不存在: {selected_strategy_id}")

        mission_id = f"mission_{route.tenant_id}_{selected_strategy_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        dag = MissionDAG(
            mission_id=mission_id,
            tenant_id=route.tenant_id,
            strategy_id=selected_strategy_id,
            campaign_name=route.campaign_context,
        )

        # 根据策略类型生成标准任务链
        if strategy.strategy_type == StrategyType.CONTENT_GROWTH.value:
            dag.nodes = [
                TaskNode(
                    node_id="t1_radar_signal",
                    title="情报侦察：本次活动的热点和竞品动态",
                    assigned_lobster="radar",
                    input_artifact="campaign_context + enterprise_profile",
                    output_artifact="SignalBrief",
                    depends_on=[],
                    estimated_hours=1.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t2_strategy_brief",
                    title="制定内容策略Brief（5字段）",
                    assigned_lobster="strategist",
                    input_artifact="SignalBrief + enterprise_profile",
                    output_artifact="StrategyBrief（5字段）",
                    depends_on=["t1_radar_signal"],
                    estimated_hours=1.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t3_inkwriter_copy",
                    title="创作3个差异化版本文案",
                    assigned_lobster="inkwriter",
                    input_artifact="StrategyBrief",
                    output_artifact="CopyPack（3版本+核心赌注）",
                    depends_on=["t2_strategy_brief"],
                    estimated_hours=1.5,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t4_strategy_judge",
                    title="文案评判（选定1-2个版本）",
                    assigned_lobster="strategist",
                    input_artifact="CopyPack",
                    output_artifact="SelectedCopyPack",
                    depends_on=["t3_inkwriter_copy"],
                    estimated_hours=0.5,
                    automation_level="manual",
                ),
                TaskNode(
                    node_id="t5_visualizer_storyboard",
                    title="生成视觉分镜和封面",
                    assigned_lobster="visualizer",
                    input_artifact="SelectedCopyPack + visual_brief",
                    output_artifact="StoryboardPack",
                    depends_on=["t4_strategy_judge"],
                    estimated_hours=2.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t6_dispatcher_plan",
                    title="制定发布执行计划",
                    assigned_lobster="dispatcher",
                    input_artifact="StoryboardPack + platform_accounts",
                    output_artifact="ExecutionPlan",
                    depends_on=["t5_visualizer_storyboard"],
                    estimated_hours=0.5,
                    automation_level="full-auto",
                    notes="dispatcher 自动选择最优发布时间窗，生成执行计划",
                ),
                TaskNode(
                    node_id="t7_echoer_monitor",
                    title="发布后评论区互动监控",
                    assigned_lobster="echoer",
                    input_artifact="ExecutionPlan（发布完成信号）",
                    output_artifact="EngagementReplyPack",
                    depends_on=["t6_dispatcher_plan"],
                    estimated_hours=2.0,
                    automation_level="semi-auto",
                    notes="持续监控，黄金1小时密集回复",
                ),
                TaskNode(
                    node_id="t8_catcher_leads",
                    title="线索捕获与评分",
                    assigned_lobster="catcher",
                    input_artifact="EngagementReplyPack",
                    output_artifact="LeadAssessment",
                    depends_on=["t7_echoer_monitor"],
                    estimated_hours=1.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t9_followup_convert",
                    title="热线索跟进转化",
                    assigned_lobster="followup",
                    input_artifact="LeadAssessment（热线索）",
                    output_artifact="FollowUpActionPlan",
                    depends_on=["t8_catcher_leads"],
                    estimated_hours=3.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t10_abacus_report",
                    title="效果归因报告",
                    assigned_lobster="abacus",
                    input_artifact="FollowUpActionPlan + ExecutionPlan数据",
                    output_artifact="ValueScoreCard",
                    depends_on=["t9_followup_convert"],
                    estimated_hours=1.5,
                    automation_level="semi-auto",
                    notes="Level 3+ 洞察，回写企业记忆库",
                ),
            ]

        elif strategy.strategy_type == StrategyType.REACTIVATION.value:
            dag.nodes = [
                TaskNode(
                    node_id="t1_catcher_segment",
                    title="沉睡客户分级筛选",
                    assigned_lobster="catcher",
                    input_artifact="enterprise_profile.growth_history",
                    output_artifact="DormantLeadList（按沉睡时长分级）",
                    depends_on=[],
                    estimated_hours=1.0,
                    automation_level="full-auto",
                ),
                TaskNode(
                    node_id="t2_inkwriter_reactivation",
                    title="撰写个性化唤醒话术",
                    assigned_lobster="inkwriter",
                    input_artifact="DormantLeadList + enterprise_profile",
                    output_artifact="ReactivationMessagePack（按级别差异化）",
                    depends_on=["t1_catcher_segment"],
                    estimated_hours=1.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t3_followup_execute",
                    title="执行唤醒触达序列",
                    assigned_lobster="followup",
                    input_artifact="ReactivationMessagePack + DormantLeadList",
                    output_artifact="FollowUpActionPlan",
                    depends_on=["t2_inkwriter_reactivation"],
                    estimated_hours=4.0,
                    automation_level="semi-auto",
                ),
                TaskNode(
                    node_id="t4_abacus_track",
                    title="唤醒效果追踪",
                    assigned_lobster="abacus",
                    input_artifact="FollowUpActionPlan",
                    output_artifact="ReactivationScoreCard",
                    depends_on=["t3_followup_execute"],
                    estimated_hours=0.5,
                    automation_level="full-auto",
                ),
            ]

        else:
            # 通用任务链（其他策略类型）
            dag.nodes = [
                TaskNode(
                    node_id="t1_radar",
                    title=f"情报侦察：{strategy.title}",
                    assigned_lobster="radar",
                    input_artifact="campaign_context",
                    output_artifact="SignalBrief",
                    depends_on=[],
                    estimated_hours=1.0,
                ),
                TaskNode(
                    node_id="t2_strategy",
                    title="策略规划",
                    assigned_lobster="strategist",
                    input_artifact="SignalBrief + enterprise_profile",
                    output_artifact="StrategyBrief",
                    depends_on=["t1_radar"],
                    estimated_hours=1.0,
                ),
                TaskNode(
                    node_id="t3_execute",
                    title="业务虾执行",
                    assigned_lobster=strategy.resource_requirement.get("lobsters", ["dispatcher"])[0],
                    input_artifact="StrategyBrief",
                    output_artifact="ExecutionResult",
                    depends_on=["t2_strategy"],
                    estimated_hours=2.0,
                ),
                TaskNode(
                    node_id="t4_report",
                    title="效果归因",
                    assigned_lobster="abacus",
                    input_artifact="ExecutionResult",
                    output_artifact="ValueScoreCard",
                    depends_on=["t3_execute"],
                    estimated_hours=1.0,
                ),
            ]

        route.mission_dag = dag
        return dag

    def identify_automation_opportunities(
        self,
        strategy: StrategyOption,
        ctx: dict,
    ) -> list[dict]:
        """
        苏思新技能：识别流程中可自动化的环节
        返回可以被 Prompt/工具化的任务点
        
        这是"策略师懂技术"的核心体现：
        发现哪里重复、哪里可以Prompt化、哪里可以工具化
        不写代码，只输出需求规格
        """
        opportunities = []
        for auto_item in strategy.automation_opportunities:
            opportunities.append({
                "description": auto_item,
                "type": "prompt_engineering" if "自动" in auto_item else "workflow",
                "priority": "high" if "自动监控" in auto_item or "自动识别" in auto_item else "medium",
                "implementation_note": "苏思输出 Prompt 规格 → 工程师实现 → 写入 prompt_registry",
            })
        return opportunities
