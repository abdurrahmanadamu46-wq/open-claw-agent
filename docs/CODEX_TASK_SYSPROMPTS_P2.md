# CODEX TASK: SysPrompts P2 — 任务分类器 + 三阶段框架 + 边缘无头模式

**来源**：SYSPROMPTS_BORROWING_ANALYSIS.md  
**优先级**：P2（高价值，计划落地）  
**借鉴自**：Kiro Mode Classifier / Devin AI 三阶段 / Cursor CLI Prompt / Windsurf/Cursor Tools 类型系统  
**日期**：2026-04-02

---

## Task 1: 任务复杂度分类器（Vibe vs Spec 双模式）

**借鉴**：Kiro 的 `Mode_Classifier_Prompt.txt`（2KB，自动判断 Vibe 快捷模式 vs Spec 规格模式）

**设计思路**：
- **Vibe 模式**：线索回复、标准跟进、常规发送 → 单龙虾直接执行，无需规划
- **Spec 模式**：活动策划、内容系列、复杂工作流 → 先出规格方案，Commander 审核后执行

```python
# dragon-senate-saas-v2/task_classifier.py（新建）

from enum import Enum

class TaskMode(Enum):
    VIBE = "vibe"   # 快捷模式：直接执行
    SPEC = "spec"   # 规格模式：先规划后执行

VIBE_KEYWORDS = [
    "回复", "跟进", "发送", "通知", "打招呼",
    "转发", "更新状态", "标记", "快速"
]

SPEC_KEYWORDS = [
    "活动", "策划", "方案", "系列", "批量",
    "分析", "报告", "工作流", "多步骤", "长期"
]

COMPLEXITY_RULES = {
    "max_leads": 50,          # 超过50条线索 → Spec
    "max_steps": 3,           # 超过3步 → Spec
    "has_creative_content": True,  # 需要创意内容 → Spec
    "multi_lobster": True,    # 需要多龙虾协作 → Spec
}

class TaskClassifier:
    """
    任务复杂度分类器
    参考 Kiro 的 Mode Classifier 设计
    """
    
    def classify(self, task: dict) -> TaskMode:
        """
        根据任务特征自动分类
        Returns: TaskMode.VIBE or TaskMode.SPEC
        """
        description = task.get("description", "")
        lead_count = task.get("lead_count", 1)
        estimated_steps = task.get("estimated_steps", 1)
        requires_multi_lobster = task.get("requires_multi_lobster", False)
        
        # Spec 模式触发条件
        if lead_count > COMPLEXITY_RULES["max_leads"]:
            return TaskMode.SPEC
        if estimated_steps > COMPLEXITY_RULES["max_steps"]:
            return TaskMode.SPEC
        if requires_multi_lobster:
            return TaskMode.SPEC
        if any(kw in description for kw in SPEC_KEYWORDS):
            return TaskMode.SPEC
        
        # 默认 Vibe 模式（快速执行）
        return TaskMode.VIBE
    
    def get_execution_strategy(self, mode: TaskMode) -> dict:
        if mode == TaskMode.VIBE:
            return {
                "skip_planning": True,
                "max_lobsters": 1,
                "require_approval": False,
                "timeout_seconds": 60,
            }
        else:  # SPEC
            return {
                "skip_planning": False,
                "require_spec_doc": True,
                "require_approval": True,
                "max_lobsters": 5,
                "timeout_seconds": 600,
            }
```

**SaaS 后台 UI**：
```
任务创建时显示模式标签：
  ⚡ Vibe 模式：快捷执行  [自动检测]
  📋 Spec 模式：规格规划  [自动检测]

运营可手动切换模式
```

**验收标准**：
- [ ] 新建 `task_classifier.py`，实现 classify() 方法
- [ ] 覆盖至少 5 种 Spec 触发条件
- [ ] `lobster_runner.py` 执行前调用分类器，按模式选择策略
- [ ] SaaS 后台任务创建页显示自动检测的模式
- [ ] 运营可手动覆盖分类结果

---

## Task 2: 工具类型系统（tools.json TypeScript-like 定义）

**借鉴**：Windsurf `Tools Wave 11.txt` 和 Cursor `Agent Tools v1.0.json` 的工具类型定义方式
（每个工具用 TypeScript 类型声明，参数有明确类型和说明）

```python
# dragon-senate-saas-v2/tool_schema.py（新建）

LOBSTER_TOOLS_SCHEMA = {
    "read_lead_profile": {
        "name": "read_lead_profile",
        "description": "读取线索的完整画像，包括基本信息、标签、历史记录",
        "parameters": {
            "lead_id": {
                "type": "string",
                "required": True,
                "description": "线索唯一ID"
            },
            "include_history": {
                "type": "boolean",
                "required": False,
                "default": True,
                "description": "是否包含历史对话记录"
            },
            "max_history_days": {
                "type": "integer",
                "required": False,
                "default": 30,
                "description": "历史记录天数上限"
            }
        },
        "returns": {
            "lead_profile": "object",
            "contact_history": "array",
            "tags": "array",
            "score": "number"
        },
        "available_to": ["dispatcher", "radar", "catcher", "followup", "strategist"],
        "estimated_tokens": 800,
        "estimated_ms": 500,
        "idempotent": True,
    },
    "send_im_message": {
        "name": "send_im_message",
        "description": "通过IM渠道（企微/飞书/钉钉）向线索发送消息",
        "parameters": {
            "lead_id": {
                "type": "string",
                "required": True,
                "description": "接收消息的线索ID"
            },
            "message": {
                "type": "string",
                "required": True,
                "description": "消息内容，不超过500字",
                "max_length": 500
            },
            "channel": {
                "type": "string",
                "required": False,
                "enum": ["wechat_work", "feishu", "dingtalk", "auto"],
                "default": "auto",
                "description": "发送渠道，auto=自动选择线索偏好渠道"
            },
            "require_confirmation": {
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "发送前是否需要运营确认"
            }
        },
        "returns": {
            "message_id": "string",
            "sent_at": "string",
            "channel_used": "string",
            "status": "string"
        },
        "available_to": ["echoer", "followup"],
        "estimated_tokens": 200,
        "estimated_ms": 1000,
        "idempotent": False,
        "side_effects": True,
        "requires_edge": True,
    },
    # ... 更多工具定义
}

class ToolSchemaValidator:
    def validate_call(self, tool_name: str, params: dict) -> bool:
        """验证工具调用参数是否符合 schema"""
        schema = LOBSTER_TOOLS_SCHEMA.get(tool_name)
        if not schema:
            raise ToolNotFoundError(f"工具 {tool_name} 不在注册表中")
        
        for param_name, param_def in schema["parameters"].items():
            if param_def.get("required") and param_name not in params:
                raise ToolParamMissingError(f"缺少必填参数: {param_name}")
        
        return True
    
    def get_tools_for_lobster(self, lobster_id: str) -> list:
        """获取指定龙虾可用的工具列表"""
        return [
            name for name, tool in LOBSTER_TOOLS_SCHEMA.items()
            if lobster_id in tool.get("available_to", [])
            or "all" in tool.get("available_to", [])
        ]
```

**验收标准**：
- [ ] 新建 `tool_schema.py`，定义至少 15 个核心工具
- [ ] 每个工具有 parameters/returns/available_to/estimated_tokens
- [ ] 标注 side_effects=True 的工具（发消息等不可逆操作）
- [ ] 标注 requires_edge=True 的工具（需要边缘节点执行）
- [ ] `lobster_runner.py` 执行工具前调用 `validator.validate_call()`

---

## Task 3: 三阶段任务框架（Plan/Execute/Verify）

**借鉴**：Devin AI 的三阶段设计（34KB Prompt 的核心结构）

```python
# 升级 dragon-senate-saas-v2/lobster_task_dag.py

class ThreePhaseTask:
    """
    三阶段任务框架（参考 Devin AI 设计）
    Phase 1: Plan   - 规划阶段，明确目标/步骤/资源/风险
    Phase 2: Execute - 执行阶段，逐步执行，每步记录
    Phase 3: Verify - 验证阶段，检查结果，输出报告
    """
    
    class PlanOutput:
        goal: str           # 任务目标
        steps: list         # 执行步骤列表
        assigned_lobsters: list  # 分配的龙虾
        estimated_time: int      # 预估时间（秒）
        estimated_cost: dict     # 预估成本（tokens/money）
        risks: list              # 风险点清单
        approved_by: str         # 批准人（运营/Commander）
        approved_at: str
    
    class ExecuteOutput:
        steps_completed: int    # 已完成步骤数
        steps_total: int
        current_step: dict
        artifacts: list          # 产出物（消息/内容/报告）
        errors: list             # 执行错误记录
        loop_log: list           # Agent Loop 日志
    
    class VerifyOutput:
        success: bool
        goal_achieved: bool
        metrics: dict           # 量化指标（发送数/回复率等）
        issues_found: list      # 发现的问题
        recommendations: list  # 后续建议
        next_action: str        # 下一步行动建议
    
    async def run_plan_phase(self, task: dict) -> PlanOutput:
        """规划阶段：Commander 生成执行方案"""
        ...
    
    async def run_execute_phase(self, plan: PlanOutput) -> ExecuteOutput:
        """执行阶段：龙虾按方案执行"""
        ...
    
    async def run_verify_phase(self, execute: ExecuteOutput) -> VerifyOutput:
        """验证阶段：检查执行结果，生成报告"""
        ...
    
    async def run(self, task: dict) -> dict:
        plan = await self.run_plan_phase(task)
        if not plan.approved_by:
            return {"status": "pending_approval", "plan": plan}
        
        execute = await self.run_execute_phase(plan)
        verify = await self.run_verify_phase(execute)
        
        return {
            "status": "completed",
            "plan": plan,
            "execute": execute,
            "verify": verify,
        }
```

**SaaS 后台显示**：
```
任务详情页展示三阶段进度：
  📋 规划阶段   [完成] ✓ 批准人: 张三
  ⚙️ 执行阶段   [进行中] 3/7 步
  ✅ 验证阶段   [待执行]
```

**验收标准**：
- [ ] `lobster_task_dag.py` 引入 `ThreePhaseTask` 类
- [ ] Plan 阶段输出有明确的 goal/steps/risks
- [ ] Execute 阶段与 Agent Loop（P1-Task1）联动
- [ ] Verify 阶段自动计算量化指标（发送数/回复率）
- [ ] SaaS 后台任务详情页展示三阶段进度条

---

## Task 4: 龙虾 Prompt 版本 Changelog（强化版本管理）

**借鉴**：Cursor 的版本化（v1.0→v1.2→2.0→CLI版本，共4个维护分支）

**当前**：`prompt_registry.py` 已有基础版本管理

**升级目标**：

```python
# 升级 dragon-senate-saas-v2/prompt_registry.py

PROMPT_CHANGELOG_SCHEMA = {
    "version": str,           # 版本号（1.0.0 / 1.1.0 / 2.0.0）
    "lobster_id": str,        # 所属龙虾
    "release_date": str,      # 发布日期
    "author": str,            # 修改者
    "change_type": str,       # major / minor / patch
    "changes": list,          # 改动清单（每条改动）
    "motivation": str,        # 修改动机（为什么改）
    "eval_result": dict,      # 评测结果对比（改前/改后指标）
    "rollback_version": str,  # 可回滚到的版本
    "ab_test_id": str,        # 关联的 A/B 测试 ID（可选）
}

# 示例 changelog
DISPATCHER_PROMPT_CHANGELOG = [
    {
        "version": "2.1.0",
        "lobster_id": "dispatcher-laojian",
        "release_date": "2026-04-01",
        "author": "系统优化",
        "change_type": "minor",
        "changes": [
            "增加任务优先级评估步骤",
            "优化多龙虾协作的分工描述",
            "移除过时的工具调用示例",
        ],
        "motivation": "发现老健在高并发时分配不均匀，增加优先级评估",
        "eval_result": {
            "before": {"dispatch_accuracy": 0.82, "avg_latency_ms": 1200},
            "after":  {"dispatch_accuracy": 0.91, "avg_latency_ms": 1050},
        },
        "rollback_version": "2.0.0",
        "ab_test_id": "exp_dispatcher_v21_2026-04",
    }
]
```

**验收标准**：
- [ ] `prompt_registry.py` 添加 `PROMPT_CHANGELOG_SCHEMA`
- [ ] 每次 Prompt 更新必须填写 changelog（CI/CD 强制检查）
- [ ] changelog 包含 motivation（为什么改）和 eval_result（效果对比）
- [ ] SaaS 后台有 Prompt 版本历史页（可查看 diff）
- [ ] 支持一键回滚到历史版本

---

## Task 5: 边缘无头模式（Headless Prompt）

**借鉴**：Cursor 的 `Agent CLI Prompt`（14KB，CLI 模式有独立的更简洁 Prompt，去掉 IDE 相关指令）

**设计思路**：边缘节点在无 UI 的 headless 环境运行时，使用精简版 Prompt，去掉：
- 所有 UI 渲染相关指令
- 截图/预览相关说明
- 用户交互确认流程（无人值守）

```python
# edge-runtime/headless_prompt.py（新建）

class HeadlessPromptBuilder:
    """
    边缘无头模式 Prompt 构建器
    参考 Cursor CLI Prompt 的精简设计原则
    """
    
    HEADLESS_SYSTEM_TEMPLATE = """
你是龙虾 {lobster_name}（{lobster_id}），运行在边缘节点的无人值守模式。

【无头模式特殊规则】
1. 无需等待人工确认，根据预授权规则自主决策
2. 所有操作必须记录日志，通过 WSS 实时回传云端
3. 遇到不确定情况，选择最保守的操作，并标记为 needs_review
4. 执行耗时操作前检查 heartbeat，确认连接正常
5. 任务完成后主动发送 task_complete 信号给 Commander

【禁止操作（无头模式）】
- 不执行任何需要 UI 交互的操作
- 不发送金额超过 {max_transaction_amount} 的任何请求
- 不修改超过 {max_lead_batch_size} 条线索的状态
- 不执行不可逆操作（删除/清空）

【当前任务】
{task_description}

【可用工具】
{available_tools}

【执行上下文】
节点ID: {node_id}
租户ID: {tenant_id}
授权级别: {auth_level}
最大执行时间: {timeout_seconds}秒
"""
    
    def build(self, lobster_id: str, task: dict, node_context: dict) -> str:
        """构建边缘无头模式的 Prompt"""
        return self.HEADLESS_SYSTEM_TEMPLATE.format(
            lobster_name=self._get_lobster_name(lobster_id),
            lobster_id=lobster_id,
            task_description=task["description"],
            available_tools=self._get_headless_tools(lobster_id),
            node_id=node_context["node_id"],
            tenant_id=node_context["tenant_id"],
            auth_level=node_context.get("auth_level", "standard"),
            timeout_seconds=node_context.get("timeout_seconds", 120),
            max_transaction_amount=node_context.get("max_transaction_amount", 0),
            max_lead_batch_size=node_context.get("max_lead_batch_size", 10),
        )
    
    def _get_headless_tools(self, lobster_id: str) -> str:
        """只返回无头模式允许的工具（过滤掉 UI 相关工具）"""
        from tool_schema import LOBSTER_TOOLS_SCHEMA
        headless_tools = [
            name for name, tool in LOBSTER_TOOLS_SCHEMA.items()
            if lobster_id in tool.get("available_to", [])
            and not tool.get("requires_ui", False)  # 过滤掉需要 UI 的工具
        ]
        return "\n".join(f"- {t}" for t in headless_tools)
```

**验收标准**：
- [ ] 新建 `edge-runtime/headless_prompt.py`
- [ ] Headless Prompt 比完整 Prompt 精简 40%+（去掉 UI/交互相关内容）
- [ ] 包含完整的安全约束（金额上限/批量上限/禁止操作清单）
- [ ] 边缘节点启动时根据运行模式（有无 UI）自动选择 Prompt 类型
- [ ] `wss_receiver.py` 在下发任务时附带 headless=true/false 标志

---

## 联动关系

```
Task 1 (任务分类器)
  ↓ Vibe 模式跳过规划，Spec 模式触发三阶段
Task 3 (三阶段框架)
  ↓ Execute 阶段工具调用前做类型验证
Task 2 (工具类型系统)
  ↓ 边缘执行时用无头 Prompt
Task 5 (Headless Prompt)
  ↓ Prompt 每次更新记录 changelog
Task 4 (Prompt Changelog)
  ↓ Changelog 关联 A/B 实验结果（Opik 已落地）
```

---

*借鉴来源：Kiro Mode Classifier + Devin AI + Cursor CLI Prompt + Windsurf Tools | 2026-04-02*
