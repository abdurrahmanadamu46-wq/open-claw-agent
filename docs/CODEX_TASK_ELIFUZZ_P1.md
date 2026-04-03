# CODEX TASK：EliFuzz Awesome System Prompts P1 任务

**来源分析**：AWESOME_SYSPROMPTS_ELIFUZZ_ANALYSIS.md  
**优先级**：P1（6个任务，立即落地）  
**日期**：2026-04-02

---

## P1-1：龙虾指挥官审批层（Commander Gate）

**借鉴自**：Parahelp manager-agent 机制  
**核心价值**：执行高风险操作前强制审批，防止龙虾执行越权/有害动作  
**落地文件**：`dragon-senate-saas-v2/commander_gate.py`（新建）

### 实现规格

```python
# dragon-senate-saas-v2/commander_gate.py
"""
龙虾指挥官审批层（Commander Gate）
借鉴自 Parahelp manager-agent 审批机制

审批触发条件：
  🔴 必须审批：向线索发消息、发报价单、承诺折扣/交付期
  🟡 建议审批：含竞品对比、超出常规跟进频率（>2次/天）
  🟢 直接执行：调研分析、内部报告、数据统计（不涉及外部输出）
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional
import json

class RiskLevel(str, Enum):
    RED = "red"       # 必须审批
    YELLOW = "yellow" # 建议审批
    GREEN = "green"   # 直接执行

class GateDecision(str, Enum):
    ACCEPT = "accept"
    REJECT = "reject"
    ESCALATE = "escalate"  # 需要人工审批

@dataclass
class DraftAction:
    """龙虾待执行动作（草稿）"""
    lobster_id: str          # 执行龙虾 ID（如 inkwriter-moxiaoya）
    action_type: str         # 动作类型（send_message / send_quote / analyze）
    content: str             # 动作内容（消息文本 / 报价内容）
    rationale: str           # 执行理由（借鉴 Cursor tool rationale）
    target_contact_id: Optional[str] = None  # 目标联系人（外部发送时必填）
    risk_level: RiskLevel = RiskLevel.GREEN

@dataclass
class GateResult:
    """审批结果"""
    decision: GateDecision
    feedback: Optional[str] = None   # 拒绝时提供反馈（类 Parahelp feedback_comment）
    revised_content: Optional[str] = None  # 建议修改后的内容

# 风险分级规则
RISK_RULES = {
    "send_message": RiskLevel.RED,        # 向线索发消息 → 必须审批
    "send_quote": RiskLevel.RED,          # 发报价单 → 必须审批
    "make_promise": RiskLevel.RED,        # 做承诺 → 必须审批
    "send_competitor_comparison": RiskLevel.YELLOW,  # 竞品对比 → 建议审批
    "followup_extra": RiskLevel.YELLOW,   # 超频跟进 → 建议审批
    "analyze_lead": RiskLevel.GREEN,      # 分析线索 → 直接执行
    "write_report": RiskLevel.GREEN,      # 写报告 → 直接执行
    "calculate_roi": RiskLevel.GREEN,     # 计算ROI → 直接执行
}

COMMANDER_GATE_SYSTEM_PROMPT = """
你是龙虾执行团队的指挥官审批员（Commander Gate）。

你的职责：
在龙虾执行每个高风险动作之前，审批或拒绝该动作。

审批流程：
1. 分析龙虾的执行意图（action_type + rationale）
2. 检查动作内容是否违反《龙虾红线宪法》
3. 检查动作是否符合当前线索状态和销售阶段
4. 如果通过 → 返回 <commander_verify>accept</commander_verify>
5. 如果拒绝 → 返回 <commander_verify>reject</commander_verify>
             + <feedback>具体原因和修改建议</feedback>

红线禁区（立即拒绝）：
- 消息中包含贬低竞品的表述
- 消息中包含未经授权的折扣承诺
- 向24小时内已联系过的线索发送第2条消息
- 消息语气不符合龙虾人格设定

输出格式（严格遵守）：
通过：<commander_verify>accept</commander_verify>
拒绝：<commander_verify>reject</commander_verify><feedback>原因</feedback>
"""

class CommanderGate:
    """
    指挥官审批层
    
    使用方法：
        gate = CommanderGate(llm_client)
        result = await gate.review(draft_action, contact_context)
        if result.decision == GateDecision.ACCEPT:
            execute_action(draft_action)
        else:
            notify_lobster_with_feedback(result.feedback)
    """
    
    def __init__(self, llm_client, auto_approve_green: bool = True):
        self.llm = llm_client
        self.auto_approve_green = auto_approve_green  # 绿色风险自动通过
    
    async def review(
        self, 
        draft_action: DraftAction,
        contact_context: dict,
        tenant_id: str
    ) -> GateResult:
        # 绿色风险直接通过（不消耗 LLM 调用）
        if self.auto_approve_green and draft_action.risk_level == RiskLevel.GREEN:
            return GateResult(decision=GateDecision.ACCEPT)
        
        # 构建审批上下文
        review_prompt = self._build_review_prompt(draft_action, contact_context)
        
        # LLM 审批（~0.3-0.5s，使用快速模型如 gpt-4o-mini）
        response = await self.llm.chat(
            system=COMMANDER_GATE_SYSTEM_PROMPT,
            user=review_prompt,
            model="gpt-4o-mini",  # 用快速/便宜模型做审批
            max_tokens=300
        )
        
        return self._parse_gate_response(response, draft_action)
    
    def _build_review_prompt(self, action: DraftAction, context: dict) -> str:
        return f"""
## 待审批动作

龙虾：{action.lobster_id}
动作类型：{action.action_type}
执行理由：{action.rationale}

动作内容：
{action.content}

## 线索上下文

{json.dumps(context, ensure_ascii=False, indent=2)}

请审批此动作是否可以执行。
"""
    
    def _parse_gate_response(self, response: str, action: DraftAction) -> GateResult:
        if "<commander_verify>accept</commander_verify>" in response:
            return GateResult(decision=GateDecision.ACCEPT)
        
        # 提取 feedback
        feedback = ""
        if "<feedback>" in response and "</feedback>" in response:
            start = response.index("<feedback>") + len("<feedback>")
            end = response.index("</feedback>")
            feedback = response[start:end].strip()
        
        return GateResult(
            decision=GateDecision.REJECT,
            feedback=feedback
        )
    
    @staticmethod
    def assess_risk(action_type: str, content: str) -> RiskLevel:
        """评估动作风险级别"""
        base_risk = RISK_RULES.get(action_type, RiskLevel.YELLOW)
        
        # 内容级别检查（提升风险）
        red_keywords = ["竞品", "比他们便宜", "免费", "承诺", "保证"]
        if any(kw in content for kw in red_keywords):
            return RiskLevel.RED
        
        return base_risk
```

### 集成到 lobster_runner.py
```python
# 在 lobster_runner.py 的 execute_step() 中集成
async def execute_step(self, lobster_id: str, action: dict, context: dict):
    # 1. 构建 DraftAction
    draft = DraftAction(
        lobster_id=lobster_id,
        action_type=action["type"],
        content=action["content"],
        rationale=action.get("rationale", ""),
        target_contact_id=action.get("contact_id"),
        risk_level=CommanderGate.assess_risk(action["type"], action["content"])
    )
    
    # 2. 通过 Commander Gate 审批
    gate = CommanderGate(self.llm_client)
    result = await gate.review(draft, context, self.tenant_id)
    
    # 3. 处理审批结果
    if result.decision == GateDecision.ACCEPT:
        return await self._execute(draft)
    else:
        # 将 feedback 发回给龙虾，让其修改后重新提交
        await self.lobster_mailbox.send(lobster_id, {
            "type": "gate_rejection",
            "feedback": result.feedback,
            "original_action": action
        })
        return {"status": "rejected", "feedback": result.feedback}
```

---

## P1-2：龙虾执行三阶段（Plan → Execute → Verify）

**借鉴自**：Devin 的三阶段执行框架  
**核心价值**：防止龙虾盲目执行，显式成功标准避免"自我声明完成"  
**落地文件**：升级 `dragon-senate-saas-v2/lobster_runner.py`

### 新增到所有龙虾任务模板的字段

```yaml
# 龙虾任务模板（YAML）新增字段
task:
  id: "task_001"
  lobster: "strategist-susi"
  instruction: "分析这个线索的购买意向"
  
  # 新增：执行计划（Plan 阶段，龙虾自行生成）
  execution_plan: []  # 龙虾执行前填写：["步骤1", "步骤2", "步骤3"]
  
  # 新增：成功标准（明确验收条件，非自我声明）
  success_criteria:
    - "输出包含线索购买意向评分（1-10分）"
    - "输出包含至少3个支持判断的证据"
    - "输出包含推荐的下一步行动"
  
  # 新增：中间验证点
  checkpoints:
    - step: 1
      expected: "完成线索基本信息读取"
    - step: 2
      expected: "完成行为信号分析"
    - step: 3
      expected: "完成意向评分"
```

### 龙虾系统提示词新增片段（注入所有龙虾 KB）

```markdown
## 执行规范（Plan-Execute-Verify）

在执行任何任务前，你必须遵循三阶段框架：

### 第一阶段：计划（Plan）
执行前先输出执行计划：
```
[执行计划]
步骤1：xxx
步骤2：xxx
步骤3：xxx
预计完成标准：xxx
```

### 第二阶段：执行（Execute）
逐步执行，每完成一步输出中间结果：
```
[步骤1完成] 结果：xxx
[步骤2完成] 结果：xxx
```

### 第三阶段：验证（Verify）
完成后对照成功标准逐一核验（不得自我声明"已完成"）：
```
[验收核查]
✅ 标准1：（说明如何满足）
✅ 标准2：（说明如何满足）
❌ 标准3：（未满足，原因是xxx）
```
```

---

## P1-3：龙虾权限分级 L1-L4

**借鉴自**：Manus 的 Agent 能力分级机制  
**核心价值**：权限边界清晰，防止低权限龙虾越权执行高风险操作  
**落地文件**：升级 `dragon-senate-saas-v2/rbac_permission.py`

### 分级定义

```python
# 新增到 rbac_permission.py

LOBSTER_PERMISSION_LEVELS = {
    # L1：只读（调研信息，不生成外部内容）
    "radar-lintao": {
        "level": 1,
        "label": "只读侦察",
        "can_do": ["read_lead_info", "web_search", "analyze_data", "write_internal_report"],
        "cannot_do": ["send_message", "send_quote", "assign_task", "call_external_api"]
    },
    "abacus-suanwuyice": {
        "level": 1,
        "label": "只读计算",
        "can_do": ["calculate_roi", "read_pricing", "write_internal_report"],
        "cannot_do": ["send_message", "send_quote", "assign_task"]
    },
    
    # L2：草稿生成（可写内容，但不能直接发送）
    "inkwriter-moxiaoya": {
        "level": 2,
        "label": "内容草稿",
        "can_do": ["write_message_draft", "write_report", "read_lead_info"],
        "cannot_do": ["send_message_directly", "assign_task"]  # 草稿需经 Commander Gate 审批
    },
    "visualizer-shadow": {
        "level": 2,
        "label": "可视化草稿",
        "can_do": ["generate_chart", "write_report", "read_metrics"],
        "cannot_do": ["send_external", "assign_task"]
    },
    "strategist-susi": {
        "level": 2,
        "label": "策略草稿",
        "can_do": ["analyze_lead", "write_strategy", "read_all_lead_data"],
        "cannot_do": ["send_message_directly", "assign_task"]
    },
    
    # L3：执行（可对外发送，需 Commander Gate 审批高风险操作）
    "echoer-asheng": {
        "level": 3,
        "label": "对外执行",
        "can_do": ["send_message", "make_phone_call", "read_lead_info", "write_followup_log"],
        "gate_required_for": ["send_message", "make_phone_call"]  # 必须过 Gate
    },
    "catcher-tiegou": {
        "level": 3,
        "label": "线索执行",
        "can_do": ["qualify_lead", "create_lead", "send_qualification_message"],
        "gate_required_for": ["send_qualification_message"]
    },
    "followup-xiaochui": {
        "level": 3,
        "label": "跟进执行",
        "can_do": ["send_followup_message", "schedule_reminder", "update_lead_status"],
        "gate_required_for": ["send_followup_message"]
    },
    
    # L4：协调（可分配任务给其他龙虾）
    "dispatcher-laojian": {
        "level": 4,
        "label": "任务协调",
        "can_do": ["assign_task", "monitor_progress", "read_all_data", "send_internal_message"],
        "gate_required_for": []  # 调度员协调任务不需过 Gate（仅对内）
    },
    "commander-chen": {
        "level": 4,
        "label": "最高协调",
        "can_do": ["all"],
        "gate_required_for": []
    }
}
```

---

## P1-4："不确定时问人"规则（注入所有龙虾 KB）

**借鉴自**：Cline 的 "Ask when uncertain" 原则  
**核心价值**：防止龙虾自行假设导致执行偏差，提前确认胜于事后纠正  
**落地文件**：升级所有 `docs/lobster-kb/*.md`

### 统一注入片段（所有龙虾 KB 的 "执行规范" 章节添加）

```markdown
## 不确定性处理规则

当遇到以下情况时，**必须先向老健（dispatcher-laojian）确认，不得自行假设**：

1. **任务描述歧义**：同一指令有两种以上合理解读
2. **信息缺失**：执行任务所需的关键信息不完整
3. **结果偏差**：执行中间结果与预期偏差超过30%
4. **越权操作**：需要访问超出我的权限级别的资源
5. **红线边缘**：不确定某个操作是否触碰红线

### 请示格式

向老健请示时，使用以下格式：
```
[请示-{我的名字}]
任务：xxx
不确定点：xxx（两种理解：A方案 vs B方案）
我的倾向：xxx（理由是xxx）
请确认应按哪种方式执行？
```

### 禁止事项

❌ 禁止自行假设任务意图后直接执行
❌ 禁止因"不想打扰"而跳过请示
❌ 禁止在汇报时用"我以为"作为执行偏差的解释
```

---

## P1-5：雷达引用标注（Perplexity 风格搜索结果）

**借鉴自**：Perplexity 的搜索结果引用标注系统  
**核心价值**：雷达信息可追溯，苏思/老健可验证信息来源  
**落地文件**：升级 `docs/lobster-kb/radar-lintao-kb.md` + `web_search_tool.py`

### 雷达输出格式升级

```python
# web_search_tool.py 中搜索结果的新输出格式

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    published_date: Optional[str]
    source_type: str  # "official" | "news" | "blog" | "social"
    credibility_score: float  # 0.0 - 1.0

def format_search_results_for_lobster(results: list[SearchResult], query: str) -> str:
    """
    Perplexity 风格：带引用编号的搜索结果摘要
    """
    lines = [f"## 搜索结果：{query}\n"]
    
    # 来源列表
    lines.append("### 来源")
    for i, r in enumerate(results, 1):
        credibility_label = {
            "official": "🟢官方",
            "news": "🔵媒体",
            "blog": "🟡博客",
            "social": "🔴社交"
        }.get(r.source_type, "⚪未知")
        date_str = f"（{r.published_date}）" if r.published_date else ""
        lines.append(f"[{i}] {credibility_label} {r.title}{date_str} — {r.url}")
    
    lines.append("\n### 综合摘要")
    # 按可信度排序，优先引用高可信度来源
    sorted_results = sorted(results, key=lambda x: x.credibility_score, reverse=True)
    for r in sorted_results[:3]:
        idx = results.index(r) + 1
        lines.append(f"- {r.snippet} [{idx}]")
    
    # 矛盾信息标注
    # （简化版：如有需要可做 NLP 矛盾检测）
    
    return "\n".join(lines)
```

### 雷达 KB 新增输出规范

```markdown
## 搜索输出规范（Perplexity 风格）

所有搜索结果必须按以下格式输出：

1. **引用编号**：每条信息用 [1][2][3] 标注来源
2. **时效性**：每条来源标注发布日期（若已知）
3. **可信度**：
   - 🟢 官方来源（公司官网/政府网站）：权重最高
   - 🔵 媒体报道（36kr/虎嗅/财新等）：权重高
   - 🟡 行业博客/KOL：权重中
   - 🔴 社交媒体/论坛：权重低（需交叉验证）
4. **矛盾标注**：若多个来源信息矛盾，明确标注"信息存在争议"
5. **时效警告**：信息超过6个月的，标注"⚠️ 信息可能已过时"
```

---

## P1-6：边缘操作破坏性保护

**借鉴自**：Cursor 的破坏性操作保护原则  
**核心价值**：防止边缘执行层误删/误覆盖关键数据  
**落地文件**：升级 `edge-runtime/marionette_executor.py`

### 实现规格

```python
# marionette_executor.py 新增破坏性操作保护

DESTRUCTIVE_OPERATIONS = {
    "delete_file", "overwrite_file", "clear_database",
    "send_bulk_message", "delete_contact", "modify_crm_record"
}

REQUIRE_DOUBLE_CONFIRM = {
    "send_bulk_message",    # 批量发消息（不可撤回）
    "delete_contact",       # 删除联系人
    "modify_crm_record",    # 修改 CRM 记录
}

async def execute_with_protection(self, operation: str, args: dict, rationale: str) -> dict:
    """
    带保护的操作执行
    
    新增字段：
    - rationale：为什么要执行这个操作（Cursor 的 tool rationale）
    - expected_result：预期结果（用于验证）
    """
    # 1. 记录操作意图（含 rationale）
    await self._log_operation_intent(operation, args, rationale)
    
    # 2. 破坏性操作检查
    if operation in DESTRUCTIVE_OPERATIONS:
        # 需要二次确认
        if operation in REQUIRE_DOUBLE_CONFIRM:
            confirmed = await self._request_confirmation(operation, args, rationale)
            if not confirmed:
                return {"status": "cancelled", "reason": "用户取消破坏性操作"}
        
        # 执行前快照（可回滚）
        await self._take_snapshot_before(operation, args)
    
    # 3. 执行操作
    try:
        result = await self._do_execute(operation, args)
        
        # 4. 记录结果（含 actual_result，与 expected 对比）
        await self._log_operation_result(operation, result, rationale)
        
        return {"status": "success", "result": result}
    
    except Exception as e:
        # 5. 失败：分析原因，建议替代方案（Cursor 风格）
        return {
            "status": "error",
            "error": str(e),
            "suggestion": self._suggest_alternative(operation, e)
        }
    
async def _request_confirmation(self, operation: str, args: dict, rationale: str) -> bool:
    """
    向 Commander Gate 发送破坏性操作确认请求
    """
    # 通过 lobster_mailbox 发给 commander
    confirmation = await self.mailbox.request_confirmation(
        to="commander-chen",
        subject=f"边缘操作确认：{operation}",
        body={
            "operation": operation,
            "args": args,
            "rationale": rationale
        },
        timeout_seconds=30
    )
    return confirmation.get("approved", False)
```

---

*EliFuzz/awesome-system-prompts P1 任务 | 2026-04-02*
