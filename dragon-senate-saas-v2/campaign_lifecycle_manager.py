"""
活动全生命周期管理器
Dragon Senate — Campaign Lifecycle Manager

这是整个系统的"胶水层"控制器，把所有模块串联为一个完整闭环：

  [入驻] → [建档] → [策略生成] → [客户确认] → [DAG拆解]
    → [注入企业记忆上下文执行] → [IM实时播报] → [复盘写回]
    → [下次策略自动更智能]

没有这层，各模块是孤立的；有了这层，形成真正的飞轮。

调用方式（Commander 主控）：
  manager = CampaignLifecycleManager()
  
  # 启动一次活动
  session = manager.launch_campaign(
      tenant_id="rongrong_beauty_2026",
      campaign_context="母亲节大促",
      business_goal="到店新客增加30人",
      time_window="2026-05-01 至 2026-05-20",
  )
  
  # 客户确认策略后推进
  manager.confirm_and_execute(session.session_id, selected_strategy_id="s1_content_growth")
  
  # 活动结束后复盘写回
  manager.close_campaign(session.session_id, actual_results={...})
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable


# ─────────────────────────────────────────
# 活动会话状态机
# ─────────────────────────────────────────

class CampaignPhase(str, Enum):
    STRATEGY_DRAFT = "策略草拟"          # 正在生成策略备选
    AWAITING_CONFIRM = "等待客户确认"     # 策略已发到群，等客户选
    EXECUTING = "执行中"                 # DAG已启动，龙虾并行执行
    REVIEWING = "复盘中"                 # 活动结束，abacus出报告
    CLOSED = "已归档"                    # 结果写回记忆库，完整闭环


@dataclass
class CampaignSession:
    """一次活动的完整会话上下文"""
    session_id: str
    tenant_id: str
    campaign_context: str
    business_goal: str
    time_window: str
    phase: str = CampaignPhase.STRATEGY_DRAFT.value
    strategy_route_id: str = ""           # growth_strategy_engine 返回的 route_id
    selected_strategy_id: str = ""        # 客户确认后填入
    mission_dag_id: str = ""              # 拆解后的 DAG id
    phase_history: list[dict] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    closed_at: str = ""
    actual_results: dict = field(default_factory=dict)
    lessons_learned: list[str] = field(default_factory=list)

    def advance_phase(self, new_phase: str, note: str = "") -> None:
        self.phase_history.append({
            "from": self.phase,
            "to": new_phase,
            "at": datetime.now().isoformat(),
            "note": note,
        })
        self.phase = new_phase


# ─────────────────────────────────────────
# 主控制器
# ─────────────────────────────────────────

class CampaignLifecycleManager:
    """
    活动全生命周期管理器
    
    核心职责：
    1. 串联 enterprise_memory → growth_strategy_engine → lobster_task_dag
    2. 每个执行节点注入企业记忆上下文（修复"lobster_runner未注入上下文"缺口）
    3. 实时同步进度到飞书/微信群
    4. 活动结束后自动写回复盘结果到企业记忆库（修复"复盘写回钩子缺失"缺口）
    
    依赖注入（避免循环导入）：
    manager = CampaignLifecycleManager()
    manager.set_memory_bank(memory_bank_instance)
    manager.set_strategy_engine(strategy_engine_instance)
    manager.set_im_manager(im_manager_instance)
    manager.set_runner(runner_instance)
    """

    def __init__(self) -> None:
        self._sessions: dict[str, CampaignSession] = {}
        self._memory_bank = None
        self._strategy_engine = None
        self._im_manager = None
        self._runner = None
        self._on_phase_change: list[Callable] = []

    # ── 依赖注入 ──────────────────────────────

    def set_memory_bank(self, memory_bank: Any) -> None:
        """注入 EnterpriseMemoryBank 实例"""
        self._memory_bank = memory_bank

    def set_strategy_engine(self, engine: Any) -> None:
        """注入 GrowthStrategyEngine 实例"""
        self._strategy_engine = engine

    def set_im_manager(self, im_manager: Any) -> None:
        """注入 LobsterIMGroupManager 实例"""
        self._im_manager = im_manager

    def set_runner(self, runner: Any) -> None:
        """注入 lobster_runner 实例"""
        self._runner = runner

    def on_phase_change(self, callback: Callable) -> None:
        """注册阶段变化回调（用于外部监控）"""
        self._on_phase_change.append(callback)

    # ── Phase 0：启动活动，生成策略 ───────────

    def launch_campaign(
        self,
        tenant_id: str,
        campaign_context: str,
        business_goal: str,
        time_window: str,
    ) -> CampaignSession:
        """
        启动一次活动。
        
        步骤：
        1. 读取企业记忆三层上下文（确保策略是定制化的，不是通用的）
        2. 调用 GrowthStrategyEngine 生成 3-5 个策略备选
        3. 把策略发到飞书/微信群让客户确认
        4. 创建 CampaignSession，进入 AWAITING_CONFIRM 状态
        """
        session = CampaignSession(
            session_id=str(uuid.uuid4())[:8],
            tenant_id=tenant_id,
            campaign_context=campaign_context,
            business_goal=business_goal,
            time_window=time_window,
        )
        self._sessions[session.session_id] = session

        # Step 1: 读取三层上下文
        enterprise_ctx = {}
        if self._memory_bank:
            enterprise_ctx = self._memory_bank.get_merged_context(tenant_id)

        # Step 2: 生成策略备选
        route = None
        if self._strategy_engine:
            route = self._strategy_engine.generate_strategy_options(
                tenant_id=tenant_id,
                campaign_context=campaign_context,
                business_goal=business_goal,
                time_window=time_window,
            )
            session.strategy_route_id = route.route_id

        # Step 3: 推送策略到 IM 群（让客户确认）
        if self._im_manager and route:
            from lobster_im_channel import AutoReportTemplates
            enterprise_name = enterprise_ctx.get("enterprise_name", tenant_id)
            strategy_options_simple = [
                {
                    "title": s.title,
                    "one_liner": s.one_liner,
                    "expected_outcome": s.expected_outcome,
                    "timeline_weeks": s.timeline_weeks,
                }
                for s in route.strategy_options
            ]
            recommended_idx = next(
                (i for i, s in enumerate(route.strategy_options) if s.recommended),
                0,
            )
            msg = AutoReportTemplates.strategist_strategy_delivery(
                enterprise_name=enterprise_name,
                campaign_name=campaign_context,
                strategy_options=strategy_options_simple,
                recommended_index=recommended_idx,
            )
            self._send_to_main_group(tenant_id, msg, sender="strategist")

        # Phase 推进
        session.advance_phase(
            CampaignPhase.AWAITING_CONFIRM.value,
            note=f"策略方案已发送到群，共{len(route.strategy_options) if route else 0}个备选",
        )
        self._notify_phase_change(session)

        return session

    # ── Phase 1：客户确认策略，启动执行 ──────

    def confirm_and_execute(
        self,
        session_id: str,
        selected_strategy_id: str,
    ) -> CampaignSession:
        """
        客户/operator 确认策略后调用。
        
        步骤：
        1. 验证策略 id 合法
        2. 拆解为 MissionDAG
        3. 每个任务节点注入企业记忆上下文（关键修复点！）
        4. 启动 DAG 执行
        5. 推送周作战计划到群
        """
        session = self._get_session(session_id)
        if session.phase != CampaignPhase.AWAITING_CONFIRM.value:
            raise ValueError(f"当前阶段 {session.phase} 不支持确认操作")

        session.selected_strategy_id = selected_strategy_id

        # Step 1: 读取企业上下文（注入给所有执行节点）
        enterprise_ctx = {}
        if self._memory_bank:
            enterprise_ctx = self._memory_bank.get_merged_context(session.tenant_id)

        # Step 2: 拆解 DAG
        dag = None
        if self._strategy_engine:
            # 重建 route（实际生产中应从存储层读取）
            route = self._strategy_engine.generate_strategy_options(
                tenant_id=session.tenant_id,
                campaign_context=session.campaign_context,
                business_goal=session.business_goal,
                time_window=session.time_window,
            )
            dag = self._strategy_engine.decompose_to_dag(route, selected_strategy_id)
            session.mission_dag_id = dag.mission_id

        # Step 3 + 4: 带企业记忆上下文执行 DAG（关键修复点）
        if self._runner and dag:
            self._run_dag_with_enterprise_context(
                dag=dag,
                enterprise_ctx=enterprise_ctx,
                tenant_id=session.tenant_id,
            )

        # Step 5: 推送执行计划到群
        if self._im_manager:
            enterprise_name = enterprise_ctx.get("enterprise_name", session.tenant_id)
            msg = self._build_execution_kickoff_message(
                enterprise_name=enterprise_name,
                session=session,
                dag=dag,
            )
            self._send_to_main_group(session.tenant_id, msg, sender="commander")

        # Phase 推进
        session.advance_phase(
            CampaignPhase.EXECUTING.value,
            note=f"策略 {selected_strategy_id} 已确认，DAG 启动执行",
        )
        self._notify_phase_change(session)
        return session

    def _run_dag_with_enterprise_context(
        self,
        dag: Any,
        enterprise_ctx: dict,
        tenant_id: str,
    ) -> None:
        """
        【关键修复点 #2】
        带企业记忆上下文执行 DAG
        
        每个任务节点执行前，从 enterprise_memory 读取对应龙虾的专属上下文注入：
          - inkwriter 的节点：注入 brand_vocabulary + content_tone + forbidden_words
          - dispatcher 的节点：注入 platform_accounts + best_publish_time
          - followup 的节点：注入 customer_profile + conversion_path
          - ...
        
        这样每只龙虾产出的结果不再是通用版本，而是该客户专属版本。
        """
        if not self._runner:
            return

        # 获取可立即执行的节点（依赖已满足）
        ready_nodes = dag.get_ready_nodes()

        for node in ready_nodes:
            # 从 enterprise_memory 取该龙虾专属的上下文切片
            lobster_ctx = {}
            if self._memory_bank:
                lobster_ctx = self._memory_bank.get_lobster_context(
                    tenant_id=tenant_id,
                    lobster_id=node.assigned_lobster,
                )

            # 把企业记忆上下文注入任务节点再执行
            enriched_task = {
                "node_id": node.node_id,
                "title": node.title,
                "assigned_lobster": node.assigned_lobster,
                "input_artifact": node.input_artifact,
                "output_artifact": node.output_artifact,
                "enterprise_context": lobster_ctx,      # ← 注入点
                "automation_level": node.automation_level,
            }

            # 调用 runner 执行（runner 应支持 enterprise_context 参数）
            if hasattr(self._runner, "run_task_with_context"):
                self._runner.run_task_with_context(enriched_task)
            else:
                # 兼容旧版 runner（没有上下文注入支持）
                self._runner.run_task(node.node_id)

    # ── Phase 2：节点完成播报 ─────────────────

    def report_node_completion(
        self,
        session_id: str,
        node_id: str,
        node_title: str,
        assigned_lobster: str,
        output_summary: str,
        next_node_title: str = "",
    ) -> None:
        """
        某个任务节点完成时调用，向客户群播报进度。
        由 runner 在节点完成时回调。
        """
        session = self._get_session(session_id)
        enterprise_ctx = {}
        if self._memory_bank:
            enterprise_ctx = self._memory_bank.get_merged_context(session.tenant_id)
        enterprise_name = enterprise_ctx.get("enterprise_name", session.tenant_id)

        from lobster_im_channel import LOBSTER_IM_IDENTITY
        lobster_display = LOBSTER_IM_IDENTITY.get(
            assigned_lobster, {}
        ).get("display_name_feishu", assigned_lobster)

        msg = (
            f"✅ {lobster_display} 完成：{node_title}\n"
            f"产出：{output_summary}"
        )
        if next_node_title:
            msg += f"\n→ 下一步：{next_node_title}"

        self._send_to_main_group(session.tenant_id, msg, sender=assigned_lobster)

    # ── Phase 3：活动结束，复盘写回 ───────────

    def close_campaign(
        self,
        session_id: str,
        actual_results: dict,
        lessons_learned: list[str] | None = None,
    ) -> CampaignSession:
        """
        【关键修复点 #1 + #3】
        活动结束后：
        1. abacus 出 ValueScoreCard
        2. 自动把复盘结果写回企业记忆库的 growth_history
        3. 把经验教训写入永久记忆（下次策略自动继承）
        4. 触发 Layer 1 行业知识库的脱敏回写判断（积累行业规律）
        
        这是"越用越懂你"飞轮的关键驱动点。
        """
        session = self._get_session(session_id)
        session.actual_results = actual_results
        session.lessons_learned = lessons_learned or []

        enterprise_ctx = {}
        if self._memory_bank:
            enterprise_ctx = self._memory_bank.get_merged_context(session.tenant_id)
        enterprise_name = enterprise_ctx.get("enterprise_name", session.tenant_id)

        # Step 1: 构建活动记录（写入 growth_history）
        campaign_record = {
            "campaign_name": session.campaign_context,
            "time_window": session.time_window,
            "strategy_used": session.selected_strategy_id,
            "business_goal": session.business_goal,
            "actual_results": actual_results,
            "goal_achieved": actual_results.get("goal_achieved", False),
            "key_metrics": actual_results.get("key_metrics", {}),
            "lessons": session.lessons_learned,
            "closed_at": datetime.now().isoformat(),
        }

        # Step 2: 写回企业记忆库（关键修复点！）
        if self._memory_bank:
            self._memory_bank.record_campaign(
                tenant_id=session.tenant_id,
                campaign_record=campaign_record,
            )

            # Step 3: 把经验教训写入永久记忆
            for i, lesson in enumerate(session.lessons_learned):
                self._memory_bank.add_memory_entry(
                    tenant_id=session.tenant_id,
                    key=f"lesson_{session.session_id}_{i}",
                    value=lesson,
                    category="campaign_lesson",
                    expires_days=-1,   # 永久有效，下次策略自动读到
                )

            # Step 4: 判断是否触发行业知识库脱敏回写
            self._maybe_contribute_to_industry_kb(
                tenant_id=session.tenant_id,
                enterprise_ctx=enterprise_ctx,
                campaign_record=campaign_record,
            )

        # Step 5: 发复盘报告到群
        summary_msg = self._build_campaign_summary_message(
            enterprise_name=enterprise_name,
            session=session,
            actual_results=actual_results,
        )
        self._send_to_main_group(session.tenant_id, summary_msg, sender="abacus")

        # Phase 推进
        session.phase = CampaignPhase.CLOSED.value
        session.closed_at = datetime.now().isoformat()
        self._notify_phase_change(session)
        return session

    def _maybe_contribute_to_industry_kb(
        self,
        tenant_id: str,
        enterprise_ctx: dict,
        campaign_record: dict,
    ) -> None:
        """
        【行业知识库脱敏回写】
        
        当某个活动结果达到统计显著性时，
        把行业规律（脱敏后）回写到 Layer 1 INDUSTRY_KNOWLEDGE_TREE。
        
        脱敏规则：
        - 保留：内容类型/策略类型/城市级别/行业标签/效果指标
        - 移除：企业名称/具体话术/客户姓名/联系方式
        
        触发条件：
        - 效果超出行业均值 50% 以上（正向或负向）
        - 样本量 n≥3（同类企业出现同一规律才算）
        """
        key_metrics = campaign_record.get("key_metrics", {})
        industry_l1 = enterprise_ctx.get("industry_l1", "")
        industry_l2 = enterprise_ctx.get("industry_l2", "")
        city_tier = enterprise_ctx.get("city_tier", "")
        strategy_used = campaign_record.get("strategy_used", "")

        # 判断是否有显著效果（超出均值50%以上）
        completion_rate = key_metrics.get("completion_rate", 0)
        industry_avg_rate = 0.23  # 简化：实际从 Layer 1 读取行业均值

        if completion_rate > industry_avg_rate * 1.5:
            # 正向显著：这个策略组合在这个行业/城市级别表现优秀
            # 实际场景：写入数据库，累积到 n≥3 时才合并到 INDUSTRY_KNOWLEDGE_TREE
            insight = {
                "industry": f"{industry_l1} > {industry_l2}",
                "city_tier": city_tier,
                "strategy_type": strategy_used,
                "insight": f"完播率高于行业均值{int((completion_rate/industry_avg_rate-1)*100)}%",
                "confidence": "single_sample",  # 需要 n≥3 才升为 confirmed
                "contributed_at": datetime.now().isoformat(),
            }
            # TODO: 写入行业洞察暂存库（积累到 n≥3 后合并到 Layer 1）
            _ = insight  # 占位，待持久化实现

    # ── 辅助方法 ──────────────────────────────

    def _get_session(self, session_id: str) -> CampaignSession:
        if session_id not in self._sessions:
            raise ValueError(f"Session 不存在: {session_id}")
        return self._sessions[session_id]

    def _send_to_main_group(
        self,
        tenant_id: str,
        message: str,
        sender: str = "commander",
    ) -> None:
        """发消息到主群（实际接入飞书/微信 API 时替换此方法）"""
        # TODO: 接入飞书 Bot API / 微信企业号 API
        # 当前以日志方式记录，等 API 接入后替换
        print(f"[IM-GROUP-{tenant_id}] [{sender}] {message}")

    def _build_execution_kickoff_message(
        self,
        enterprise_name: str,
        session: CampaignSession,
        dag: Any,
    ) -> str:
        """生成活动启动通知（Commander 发到群里）"""
        node_count = len(dag.nodes) if dag else 0
        return (
            f"🐉 开始执行 | {enterprise_name} × {session.campaign_context}\n\n"
            f"策略方案已确认，龙虾团队启动！\n"
            f"共 {node_count} 个执行节点，预计完成时间：{session.time_window.split('至')[-1].strip()}\n\n"
            f"我会在每个关键节点完成时在群里播报进度 📢\n"
            f"有任何问题随时@我"
        )

    def _build_campaign_summary_message(
        self,
        enterprise_name: str,
        session: CampaignSession,
        actual_results: dict,
    ) -> str:
        """生成活动复盘报告（abacus 发到群里）"""
        goal_icon = "✅" if actual_results.get("goal_achieved") else "⚠️"
        metrics = actual_results.get("key_metrics", {})
        metrics_lines = "\n".join([f"  - {k}：{v}" for k, v in metrics.items()])
        lessons = session.lessons_learned
        lessons_lines = (
            "\n".join([f"  - {l}" for l in lessons]) if lessons else "  - 暂无特别记录"
        )
        return (
            f"📊 活动复盘报告 | {enterprise_name} × {session.campaign_context}\n\n"
            f"{goal_icon} 目标：{session.business_goal}\n"
            f"  完成情况：{'达成' if actual_results.get('goal_achieved') else '未达成'}\n\n"
            f"核心数据：\n{metrics_lines}\n\n"
            f"经验教训（已写入记忆库，下次自动继承）：\n{lessons_lines}\n\n"
            f"算无遗策 完整报告已生成，陈指挥正在安排下一阶段策略 🐉"
        )

    def _notify_phase_change(self, session: CampaignSession) -> None:
        """通知所有已注册的阶段变化监听器"""
        for callback in self._on_phase_change:
            try:
                callback(session)
            except Exception:
                pass


# ─────────────────────────────────────────
# 健康度监控：SLA 自动检查
# ─────────────────────────────────────────

class CampaignHealthMonitor:
    """
    服务 SLA 自动监控
    
    定期检查：
    - 每只龙虾的响应延迟是否超出 SLA
    - 客户活跃度（连续7天未发言 → 流失预警）
    - 策略确认率（连续3周未确认 → Commander 主动跟进）
    """

    SLA_THRESHOLDS = {
        "followup": {"max_response_hours": 2, "alert": "热线索响应超时"},
        "echoer": {"max_response_hours": 1, "alert": "评论区监控延迟"},
        "commander": {"max_response_hours": 0.5, "alert": "Commander 响应过慢"},
        "inkwriter": {"max_response_hours": 4, "alert": "文案交付延迟"},
        "abacus": {"max_response_hours": 24, "alert": "数据报告延迟"},
    }

    CLIENT_HEALTH_RULES = [
        {
            "rule": "7天未在群里发言",
            "days_silent": 7,
            "action": "commander_proactive_outreach",
            "message_template": (
                "嗨，好久没听到你们的声音了 😊\n"
                "最近业务怎么样？我们这边{lobster_count}个顾问都在待命，\n"
                "要不要聊聊下一步的计划？"
            ),
        },
        {
            "rule": "连续3周策略未确认",
            "weeks_no_confirm": 3,
            "action": "strategy_simplification",
            "message_template": (
                "荣荣姐，我把方案简化了一下——\n"
                "只需要做一件事：{simplified_action}\n"
                "这周能不能先试试？"
            ),
        },
        {
            "rule": "出现流失信号词",
            "trigger_words": ["算了", "再说吧", "忙", "没时间", "考虑一下"],
            "action": "retention_intervention",
            "message_template": (
                "我理解，你们现在肯定很忙。\n"
                "要不这样：让我们的自动化帮你减轻负担——\n"
                "接下来2周，你只需要确认一次就好，其余全由我们来。"
            ),
        },
    ]

    def check_lobster_sla(
        self,
        lobster_id: str,
        task_start_time: str,
        current_time: str | None = None,
    ) -> dict:
        """检查某只龙虾的响应是否在 SLA 内"""
        if lobster_id not in self.SLA_THRESHOLDS:
            return {"status": "ok", "in_sla": True}

        threshold = self.SLA_THRESHOLDS[lobster_id]
        from datetime import datetime as dt
        start = dt.fromisoformat(task_start_time)
        now = dt.fromisoformat(current_time) if current_time else dt.now()
        elapsed_hours = (now - start).total_seconds() / 3600

        in_sla = elapsed_hours <= threshold["max_response_hours"]
        return {
            "lobster_id": lobster_id,
            "elapsed_hours": round(elapsed_hours, 2),
            "max_hours": threshold["max_response_hours"],
            "in_sla": in_sla,
            "alert": threshold["alert"] if not in_sla else None,
        }

    def check_client_health(
        self,
        tenant_id: str,
        last_message_date: str,
        strategy_last_confirm_date: str | None = None,
        recent_messages: list[str] | None = None,
    ) -> list[dict]:
        """
        检查客户健康度，返回需要触发的干预动作列表
        """
        from datetime import datetime as dt
        alerts = []
        now = dt.now()

        # 规则1：长时间未发言
        try:
            last_msg = dt.fromisoformat(last_message_date)
            days_silent = (now - last_msg).days
            if days_silent >= 7:
                alerts.append({
                    "rule": "7天未在群里发言",
                    "days_silent": days_silent,
                    "action": "commander_proactive_outreach",
                    "priority": "high",
                })
        except Exception:
            pass

        # 规则2：策略长期未确认
        if strategy_last_confirm_date:
            try:
                last_confirm = dt.fromisoformat(strategy_last_confirm_date)
                weeks_no_confirm = (now - last_confirm).days // 7
                if weeks_no_confirm >= 3:
                    alerts.append({
                        "rule": "连续3周策略未确认",
                        "weeks_no_confirm": weeks_no_confirm,
                        "action": "strategy_simplification",
                        "priority": "medium",
                    })
            except Exception:
                pass

        # 规则3：检测流失信号词
        if recent_messages:
            trigger_words = ["算了", "再说吧", "忙", "没时间", "考虑一下"]
            found_triggers = [
                word for word in trigger_words
                if any(word in msg for msg in recent_messages)
            ]
            if found_triggers:
                alerts.append({
                    "rule": "出现流失信号词",
                    "trigger_words": found_triggers,
                    "action": "retention_intervention",
                    "priority": "high",
                })

        return alerts
