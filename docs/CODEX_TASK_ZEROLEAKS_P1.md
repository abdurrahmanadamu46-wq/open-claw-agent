# CODEX TASK: ZeroLeaks P1 — 变异器 + 转化状态机 + 失败分类 + 任务树

**来源**：ZEROLEAKS_BORROWING_ANALYSIS.md  
**优先级**：P1（高价值，立即落地）  
**借鉴自**：ZeroLeaks Mutator / LeakStatus / FailureReason / TAP / Orchestrator  
**日期**：2026-04-02

---

## Task 1: 龙虾成功案例变异器（message_mutator.py）

**借鉴**：ZeroLeaks `mutator.ts`（11KB，对成功攻击 Prompt 做变异，生成 3-5 个变体）

**核心价值**：成功发出的消息，自动变异出多个版本，供 A/B 测试和规避过滤

```python
# dragon-senate-saas-v2/message_mutator.py（新建）

from enum import Enum
from dataclasses import dataclass

class MutationStrategy(Enum):
    TONE_SHIFT = "tone_shift"           # 语气变换（正式→亲切→活泼）
    OPENING_VARY = "opening_vary"       # 开头变换（直接→问候→情境引入）
    LENGTH_COMPRESS = "length_compress" # 压缩版（减少30%字数）
    LENGTH_EXPAND = "length_expand"     # 扩展版（增加案例/数据）
    PERSPECTIVE_SHIFT = "perspective_shift"  # 视角转换（我们→您→第三方）
    URGENCY_ADD = "urgency_add"         # 添加紧迫感
    SOCIAL_PROOF = "social_proof"       # 加入社会证明

@dataclass
class MutationResult:
    original_message: str
    mutations: list[dict]   # [{strategy, content, estimated_score}]
    best_mutation: str
    mutation_count: int

class MessageMutator:
    """
    龙虾成功消息变异器
    参考 ZeroLeaks Mutator Agent 设计
    
    输入：一条成功的消息（有回复/点击/转化）
    输出：5-10 个变体（保持核心说服力，改变表达）
    目的：A/B 测试找最优，规避重复发送过滤
    """
    
    def __init__(self, llm_client, prompt_registry):
        self.llm = llm_client
        self.prompt_registry = prompt_registry
    
    async def mutate(
        self, 
        message: str,
        context: dict,           # 线索画像/行业/场景
        strategies: list = None, # 指定变异策略，None=自动选
        count: int = 5,          # 生成变体数量
    ) -> MutationResult:
        """
        对成功消息进行变异
        参考 ZeroLeaks Mutator 的核心逻辑
        """
        if strategies is None:
            strategies = self._auto_select_strategies(context)
        
        mutations = []
        for strategy in strategies[:count]:
            mutated = await self._apply_mutation(message, strategy, context)
            score = await self._estimate_score(mutated, context)
            mutations.append({
                "strategy": strategy.value,
                "content": mutated,
                "estimated_score": score,
                "char_count": len(mutated),
            })
        
        # 按预估评分排序
        mutations.sort(key=lambda x: x["estimated_score"], reverse=True)
        
        return MutationResult(
            original_message=message,
            mutations=mutations,
            best_mutation=mutations[0]["content"] if mutations else message,
            mutation_count=len(mutations),
        )
    
    def _auto_select_strategies(self, context: dict) -> list:
        """根据线索上下文自动选择最合适的变异策略"""
        strategies = [MutationStrategy.TONE_SHIFT, MutationStrategy.OPENING_VARY]
        if context.get("lead_cold"):
            strategies.append(MutationStrategy.SOCIAL_PROOF)
        if context.get("is_followup"):
            strategies.append(MutationStrategy.LENGTH_COMPRESS)
        return strategies
    
    async def _apply_mutation(self, message: str, strategy: MutationStrategy, context: dict) -> str:
        """应用变异策略，调用 LLM 生成变体"""
        prompt = self.prompt_registry.get("message_mutator", strategy=strategy.value)
        result = await self.llm.generate(prompt.format(
            original=message,
            strategy=strategy.value,
            context=context,
        ))
        return result.strip()
    
    async def bulk_mutate_successful(self, tenant_id: str, days: int = 30) -> list:
        """批量变异最近N天成功消息（有回复的消息）"""
        # 从数据库获取最近成功消息
        # 批量变异，入库备用
        ...
```

**验收标准**：
- [ ] 新建 `message_mutator.py`，实现 mutate() 方法
- [ ] 支持至少 7 种变异策略
- [ ] 变异后消息质量评分（`estimated_score`，0-100）
- [ ] SaaS 后台在成功消息旁显示"生成变体"按钮
- [ ] `bulk_mutate_successful()` 支持批量变异历史成功消息

---

## Task 2: 线索转化状态机（lead_conversion_fsm.py）

**借鉴**：ZeroLeaks 的 `LeakStatus`（none→hint→fragment→substantial→complete 5级）

```python
# dragon-senate-saas-v2/lead_conversion_fsm.py（新建）

from enum import Enum
from dataclasses import dataclass
from datetime import datetime

class ConversionStatus(Enum):
    """线索转化状态（参考 ZeroLeaks LeakStatus 设计）"""
    UNKNOWN = "unknown"           # 未知状态（新线索）
    AWARE = "aware"               # 已知晓（已阅读/已看到）
    INTERESTED = "interested"     # 有兴趣（主动回复/询问）
    CONSIDERING = "considering"   # 考虑中（多次互动/要求资料）
    DECIDED = "decided"           # 已决定（明确意向/报价）
    CONVERTED = "converted"       # 已转化（成交/付款/注册）
    LOST = "lost"                 # 已流失（明确拒绝/长期无响应）

# 状态流转矩阵（合法的状态转移）
VALID_TRANSITIONS = {
    ConversionStatus.UNKNOWN: [ConversionStatus.AWARE, ConversionStatus.LOST],
    ConversionStatus.AWARE: [ConversionStatus.INTERESTED, ConversionStatus.LOST],
    ConversionStatus.INTERESTED: [ConversionStatus.CONSIDERING, ConversionStatus.LOST],
    ConversionStatus.CONSIDERING: [ConversionStatus.DECIDED, ConversionStatus.LOST, ConversionStatus.INTERESTED],
    ConversionStatus.DECIDED: [ConversionStatus.CONVERTED, ConversionStatus.LOST],
    ConversionStatus.CONVERTED: [],  # 终态
    ConversionStatus.LOST: [],       # 终态（除非人工重置）
}

@dataclass
class StatusTransition:
    from_status: ConversionStatus
    to_status: ConversionStatus
    trigger: str              # 触发事件（message_replied / doc_downloaded / price_asked）
    confidence: float         # 置信度 0-100
    triggered_by: str         # 触发龙虾 ID
    evidence: str             # 状态变化的证据（回复内容摘要）
    transitioned_at: datetime

class LeadConversionFSM:
    """
    线索转化状态机
    参考 ZeroLeaks LeakStatus 的 5 级评估体系
    设计为 7 级转化漏斗状态
    """
    
    def __init__(self, db):
        self.db = db
    
    def get_status(self, lead_id: str) -> ConversionStatus:
        """获取线索当前转化状态"""
        record = self.db.get_lead_status(lead_id)
        return ConversionStatus(record["status"]) if record else ConversionStatus.UNKNOWN
    
    def can_transition(self, current: ConversionStatus, target: ConversionStatus) -> bool:
        """检查状态转移是否合法"""
        return target in VALID_TRANSITIONS.get(current, [])
    
    async def transition(
        self,
        lead_id: str,
        target_status: ConversionStatus,
        trigger: str,
        confidence: float,
        triggered_by: str,
        evidence: str = "",
    ) -> StatusTransition:
        """执行状态转移"""
        current = self.get_status(lead_id)
        
        if not self.can_transition(current, target_status):
            raise InvalidTransitionError(
                f"线索 {lead_id} 无法从 {current.value} 转移到 {target_status.value}"
            )
        
        if confidence < 60:
            # 置信度不足，只记录但不转移
            await self.db.log_low_confidence_signal(lead_id, target_status, confidence)
            return None
        
        transition = StatusTransition(
            from_status=current,
            to_status=target_status,
            trigger=trigger,
            confidence=confidence,
            triggered_by=triggered_by,
            evidence=evidence,
            transitioned_at=datetime.utcnow(),
        )
        
        await self.db.update_lead_status(lead_id, target_status.value)
        await self.db.log_status_transition(lead_id, transition)
        
        # 触发后续自动化（状态升级 → 通知对应龙虾）
        await self._trigger_automation(lead_id, transition)
        
        return transition
    
    async def _trigger_automation(self, lead_id: str, transition: StatusTransition):
        """根据状态转移触发后续龙虾动作"""
        automation_map = {
            ConversionStatus.INTERESTED: "dispatcher-laojian",    # 通知老健分配跟进
            ConversionStatus.CONSIDERING: "strategist-susi",      # 通知苏思制定策略
            ConversionStatus.DECIDED: "abacus-suanwuyice",        # 通知算无遗策评估
            ConversionStatus.CONVERTED: "followup-xiaochui",      # 通知小锤做售后跟进
            ConversionStatus.LOST: None,                          # 归档，不触发
        }
        lobster = automation_map.get(transition.to_status)
        if lobster:
            await self.notify_lobster(lobster, lead_id, transition)
    
    def get_conversion_rate(self, tenant_id: str, from_status: str, to_status: str) -> float:
        """计算特定阶段的转化率"""
        ...
```

**验收标准**：
- [ ] 新建 `lead_conversion_fsm.py`，实现 7 级状态机
- [ ] 状态转移矩阵防止非法跳转
- [ ] 置信度 < 60% 时只记录不转移（避免误判）
- [ ] 状态升级自动通知对应龙虾
- [ ] SaaS 后台线索详情页显示转化漏斗进度条
- [ ] 提供各阶段转化率统计 API

---

## Task 3: 失败原因精确分类（升级 audit_logger）

**借鉴**：ZeroLeaks `FailedAttack + FailureReason` 类型系统（4 种失败类型精确枚举）

```python
# 升级 dragon-senate-saas-v2/audit_logger.py

from enum import Enum

class LobsterFailureReason(Enum):
    """
    龙虾执行失败原因枚举
    参考 ZeroLeaks FailureReason 精确分类
    """
    LEAD_NOT_FOUND = "lead_not_found"           # 线索不存在或已删除
    CHANNEL_BLOCKED = "channel_blocked"          # IM 渠道封号/限流
    MESSAGE_FILTERED = "message_filtered"        # 消息被平台过滤（违规词）
    RATE_LIMITED = "rate_limited"                # 发送频率超限
    LEAD_REJECTED = "lead_rejected"              # 线索明确拒绝（回复"不需要"）
    TIMEOUT = "timeout"                          # 执行超时（> max_seconds）
    LLM_ERROR = "llm_error"                     # LLM API 调用失败
    BOUNDARY_VIOLATION = "boundary_violation"    # 越权操作（被 BoundaryGuard 拦截）
    PARSE_ERROR = "parse_error"                  # LLM 输出格式解析失败
    KNOWLEDGE_MISSING = "knowledge_missing"      # 缺少所需行业知识
    PERMISSION_DENIED = "permission_denied"      # 租户权限不足
    DEPENDENCY_FAILED = "dependency_failed"      # 依赖的上游龙虾失败

FAILURE_ACTION_MAP = {
    LobsterFailureReason.LEAD_NOT_FOUND: "archive_lead",
    LobsterFailureReason.CHANNEL_BLOCKED: "switch_channel",
    LobsterFailureReason.MESSAGE_FILTERED: "rewrite_message",
    LobsterFailureReason.RATE_LIMITED: "retry_after_cooldown",
    LobsterFailureReason.LEAD_REJECTED: "mark_lost_update_status",
    LobsterFailureReason.TIMEOUT: "retry_with_simpler_task",
    LobsterFailureReason.LLM_ERROR: "retry_with_fallback_model",
    LobsterFailureReason.BOUNDARY_VIOLATION: "alert_admin_no_retry",
    LobsterFailureReason.PARSE_ERROR: "retry_with_structured_prompt",
    LobsterFailureReason.KNOWLEDGE_MISSING: "request_knowledge_update",
    LobsterFailureReason.PERMISSION_DENIED: "notify_tenant_admin",
    LobsterFailureReason.DEPENDENCY_FAILED: "retry_after_dependency",
}

class FailureRecord:
    task_id: str
    lobster_id: str
    reason: LobsterFailureReason
    detail: str           # 详细错误信息
    suggested_action: str # 建议的修复动作（来自 FAILURE_ACTION_MAP）
    auto_retried: bool    # 是否已自动重试
    occurred_at: str
```

**验收标准**：
- [ ] `audit_logger.py` 引入 `LobsterFailureReason` 枚举（12 种）
- [ ] 每种失败原因有对应的 suggested_action
- [ ] `lobster_runner.py` 捕获异常时映射到 FailureReason
- [ ] SaaS 后台失败任务列表显示失败原因 + 建议动作
- [ ] 运营可一键触发 suggested_action

---

## Task 4: Commander 任务攻击树（升级 commander_graph_builder.py）

**借鉴**：ZeroLeaks `TAP（Tree of Attacks with Pruning）`（攻击树 + 剪枝 + 评分）

```python
# 升级 dragon-senate-saas-v2/commander_graph_builder.py

@dataclass
class TaskNode:
    """
    任务树节点（参考 ZeroLeaks AttackNode）
    """
    node_id: str
    node_type: str        # root / strategy / action / leaf
    description: str
    assigned_lobster: str
    priority_score: float # 优先级评分（0-100），高分优先执行
    success_probability: float  # 预估成功概率
    
    # 执行结果（执行后填充）
    executed: bool = False
    result_score: float = 0.0   # 执行后的实际效果评分
    pruned: bool = False         # 是否被剪枝（效果差的分支跳过）
    
    children: list = None        # 子节点

class CommanderTaskTree:
    """
    Commander 任务规划树
    参考 ZeroLeaks TAP 设计：
    - 系统性覆盖所有执行路径
    - 对低效分支剪枝（节省 token/时间）
    - 优先执行高概率成功的路径
    """
    
    def build_tree(self, goal: str, lead_profile: dict) -> TaskNode:
        """
        根据目标和线索画像构建任务树
        
        例：目标="首次建立联系"，线索="科技行业 CTO，LinkedIn 活跃"
        
        Root: 首次建立联系
        ├── 策略A: 技术价值切入（概率 0.7）
        │   ├── 雷达分析 LinkedIn 动态
        │   ├── 墨小雅写技术共鸣消息
        │   └── 阿晟发送并等待回复
        ├── 策略B: 行业洞察切入（概率 0.5）
        │   ├── 苏思生成行业报告摘要
        │   └── 老健分配发送任务
        └── 策略C: 活动邀约切入（概率 0.3）
            └── 墨小雅写活动邀请
        """
        root = TaskNode(
            node_id=generate_id("task"),
            node_type="root",
            description=goal,
            assigned_lobster="commander",
            priority_score=100.0,
            success_probability=1.0,
        )
        
        # 根据线索画像选择策略分支
        strategies = self._select_strategies(goal, lead_profile)
        root.children = [self._build_strategy_node(s, lead_profile) for s in strategies]
        
        return root
    
    def prune_tree(self, root: TaskNode, min_score: float = 30.0) -> TaskNode:
        """
        剪枝：对成功概率低于阈值的节点标记为 pruned
        参考 TAP 的剪枝机制
        """
        if root.success_probability * 100 < min_score:
            root.pruned = True
            return root
        
        if root.children:
            root.children = [
                self.prune_tree(child, min_score)
                for child in root.children
                if not child.pruned
            ]
        
        return root
    
    def get_next_action(self, root: TaskNode) -> TaskNode:
        """获取下一个待执行的叶节点（优先级最高且未执行）"""
        leaves = self._get_executable_leaves(root)
        if not leaves:
            return None
        return max(leaves, key=lambda n: n.priority_score)
    
    def update_scores(self, node_id: str, result_score: float):
        """执行完一个节点后，更新父节点的成功概率（反向传播）"""
        ...
```

**验收标准**：
- [ ] `commander_graph_builder.py` 引入 `CommanderTaskTree` 类
- [ ] 支持 3 层任务树（root → strategy → action）
- [ ] 剪枝机制（低概率分支不执行，节省 token）
- [ ] 执行结果反向更新父节点评分
- [ ] SaaS 后台任务详情页可视化展示任务树

---

## Task 5: 多轮对话序列编排（升级 lobster_task_dag.py）

**借鉴**：ZeroLeaks `orchestrator.ts`（19KB）的 `MultiTurnSequence + MultiTurnStep`

```python
# 升级 dragon-senate-saas-v2/lobster_task_dag.py

@dataclass
class ConversationStep:
    """
    多轮对话单步（参考 ZeroLeaks MultiTurnStep）
    """
    step_id: str
    step_index: int        # 第几轮（1-based）
    intent: str            # 本步意图（建立信任/传递价值/推动决策）
    lobster_id: str        # 执行本步的龙虾
    
    # 发送配置
    message_template: str  # 消息模板 ID
    wait_before_send: int  # 发送前等待（小时），避免太密集
    
    # 条件控制（参考 ZeroLeaks Orchestrator 的自适应）
    trigger_condition: str  # 触发条件（previous_replied / no_reply_3d / specific_keyword）
    skip_if: str           # 跳过条件（already_converted / explicitly_rejected）
    
    # 执行结果
    sent_at: str = None
    reply_received: bool = False
    reply_content: str = None

@dataclass  
class MultiTurnSequence:
    """
    多轮对话序列（参考 ZeroLeaks MultiTurnSequence）
    """
    sequence_id: str
    name: str               # 序列名称（如"高端客户7天跟进序列"）
    total_steps: int
    steps: list[ConversationStep]
    
    # 自适应配置（参考 ZeroLeaks Orchestrator 的自适应温度）
    adaptive_mode: bool = True   # 是否根据线索反应自适应调整
    abort_on_rejection: bool = True  # 明确拒绝后中止序列
    
    # 进度
    current_step_index: int = 0
    completed: bool = False
    abort_reason: str = None

class SequenceOrchestrator:
    """多轮对话序列编排器"""
    
    BUILTIN_SEQUENCES = {
        "cold_outreach_7day": {
            "name": "冷启动7天跟进序列",
            "steps": [
                {"intent": "初次破冰", "wait_before_send": 0, "trigger": "always"},
                {"intent": "价值展示", "wait_before_send": 48, "trigger": "no_reply_48h"},
                {"intent": "痛点共鸣", "wait_before_send": 72, "trigger": "no_reply_72h"},
                {"intent": "社会证明", "wait_before_send": 96, "trigger": "no_reply_96h"},
                {"intent": "最后机会", "wait_before_send": 120, "trigger": "no_reply_5d"},
            ]
        },
        "warm_followup_3step": {
            "name": "有回复快速跟进3步",
            "steps": [
                {"intent": "确认需求", "wait_before_send": 4, "trigger": "replied"},
                {"intent": "提供方案", "wait_before_send": 24, "trigger": "replied_again"},
                {"intent": "推动决策", "wait_before_send": 48, "trigger": "any"},
            ]
        }
    }
    
    async def start_sequence(self, lead_id: str, sequence_name: str) -> MultiTurnSequence:
        """启动一个多轮序列"""
        ...
    
    async def advance_sequence(self, sequence_id: str, reply_event: dict = None) -> ConversationStep:
        """根据回复情况推进序列"""
        ...
    
    async def abort_sequence(self, sequence_id: str, reason: str):
        """中止序列（明确拒绝/已转化/人工干预）"""
        ...
```

**验收标准**：
- [ ] `lobster_task_dag.py` 引入 `MultiTurnSequence + SequenceOrchestrator`
- [ ] 内置至少 2 个标准多轮序列（冷启动7天 / 有回复3步）
- [ ] 条件触发（回复了 vs 未回复 → 不同下一步）
- [ ] 明确拒绝时自动中止序列
- [ ] SaaS 后台可视化展示序列进度（时间线视图）
- [ ] 支持自定义序列（运营通过 UI 配置步骤）

---

## 联动关系

```
Task 2 (转化状态机)
  ↓ 状态变化触发
Task 5 (多轮序列)
  ↓ 序列执行中
Task 1 (消息变异器)：对成功消息生成变体
Task 3 (失败分类)：精确记录每步失败原因
Task 4 (任务树)：Commander 规划整体执行路径
```

---

*借鉴来源：ZeroLeaks Mutator + LeakStatus + FailureReason + TAP + Orchestrator | 2026-04-02*
