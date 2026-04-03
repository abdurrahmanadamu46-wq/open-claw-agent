# Awesome System Prompts (EliFuzz) 借鉴分析报告

**来源**：https://github.com/EliFuzz/awesome-system-prompts  
**定位**：70+ 主流 AI 产品的系统提示词泄漏库（Prompt Labs）  
**收录产品**：Manus / Devin / Cursor / Perplexity / Notion / Cline / Windsurf / Anthropic / Factory / Parahelp / Augment / Aider / Grok / Gemini 等  
**核心价值**：直接观察全球顶级 AI 产品的 prompt 工程设计，提炼可复用的结构模式  
**分析日期**：2026-04-02  
**规则**：已生成过 Codex Task 的默认已落地，我们已更好的略过

---

## 一、项目概述

这是一个 **Docusaurus** 文档站点 + **leaks/** 原始 prompt 文件的组合：
- `leaks/` 目录：按产品分组的原始 prompt 文件（md/txt/json/yaml）
- `docs/` 目录：Docusaurus 渲染的文档展示页面（70+ 产品）
- 时间跨度：2023 - 2025年（持续更新）

### 对我们最高价值的 10 个产品
```
1. Manus        → 最接近我们的 multi-agent 系统（agent 协作/工具调用）
2. Devin        → 最强 AI Agent，prompt 架构参考（思维链/任务拆解）
3. Cursor       → tool-use 设计极致精良（边缘执行参考）
4. Perplexity   → 搜索+AI 结合（雷达实时搜索设计参考）
5. Parahelp     → manager-agent 审批机制（惊天发现！）
6. Cline        → agent runner 设计，tool 调用规范
7. Windsurf     → agentic 工作流，cascade 模式
8. Factory      → AI 工厂分工，类似龙虾分工
9. Notion AI    → 生产力AI，结构化输出参考
10. Augment     → 任务管理+记忆工具设计
```

---

## 二、最重要发现：Parahelp 的 Manager-Agent 审批机制 🏆

这是**本次分析最高价值的发现**，与我们的大脑层（Commander/老健）完全契合。

### Parahelp 的设计
```
Manager Prompt 核心逻辑：
  角色：你是客服 Agent 的管理者（manager）
  任务：在 Agent 执行每个 tool call 之前审批或拒绝
  
  流程：
    1. 分析 <context_customer_service_agent> + <latest_internal_messages>
    2. 对照 <customer_service_policy> 和 <checklist_for_tool_call>
    3. 如果通过 → 返回 <manager_verify>accept</manager_verify>
    4. 如果不通过 → 返回 <manager_verify>reject</manager_verify>
                   + <feedback_comment>具体原因</feedback_comment>
  
  关键特性：
    - 每个 tool call 执行前都需要 manager 审批（不是事后复盘）
    - Manager 可以提供"过程反馈"而不仅仅是对具体 tool call 的反馈
    - Planning Prompt 独立于 Manager Prompt（分离关注点）
```

### 转化为我们的龙虾审批层
```
当前我们的问题：
  龙虾执行任务是"发令→执行→汇报"，没有执行中的实时审批
  如果龙虾判断出错（如墨小雅写了不合适的话），没有拦截机制

借鉴 Parahelp 设计的龙虾指挥官审批层（Commander Gate）：
  
  触发场景：
    - 高风险操作（向线索发消息、发报价）
    - 敏感内容（含折扣/承诺/竞品对比）
    - 红线边缘操作（超出龙虾职责范围）
  
  审批格式（复用 Parahelp 的 XML 格式）：
    通过：<commander_verify>accept</commander_verify>
    拒绝：<commander_verify>reject</commander_verify>
           <feedback>墨小雅的消息含竞品贬低，违反红线第3条</feedback>
  
  实现路径：
    1. 龙虾执行前先生成 draft_action（草稿动作）
    2. 送达 Commander 审批（LLM 调用，~0.5s）
    3. 通过 → 执行；拒绝 → 修改后重新提交
    4. 审批记录入 audit_logger（合规证据）
```

---

## 三、Manus 的多 Agent 协调模式

### 设计要点
```
Manus 的 Agent 系统：
  - Agent 之间通过 event stream 通信（我们的 webhook_event_bus 类似）
  - 每个 Agent 有独立的 tool_call 权限列表
  - Agent 可以创建子 Agent（我们的 lobster_clone_manager）
  - 失败重试：最多3次，失败后 escalate 到上级 Agent

关键 prompt 模式（对我们的龙虾直接可用）：
  1. 角色限定："You ONLY do X. You do NOT do Y."
     → 我们已有红线禁区，已落地
  
  2. 输出格式强制："Always respond with JSON matching schema..."
     → 我们的 skill_frontmatter 已有输出格式，已落地
  
  3. 工具调用原则："Prefer calling ONE tool at a time..."
     → 龙虾执行时应遵循：每步只做一件事（原子性）
  
  4. 错误处理："If tool fails, explain why and retry with different approach"
     → 我们的 lobster_circuit_breaker 已有基础，但缺 retry-with-insight
```

### 新发现（我们没有的）
```
Manus 的 Agent 能力分级机制：
  Level 1: 只能读取信息（read-only）
  Level 2: 可以生成内容（write draft）
  Level 3: 可以执行动作（execute action）
  Level 4: 可以协调其他 Agent（orchestrate）

转化为龙虾权限级别：
  L1（只读）：雷达（调研信息，不执行）
  L2（草稿）：墨小雅（生成消息草稿，需审批）
  L3（执行）：阿声（发出消息，需审批高风险）
  L4（协调）：老健/大脑（分配任务给其他龙虾）
```

---

## 四、Devin 的 Agent 思维框架

### 设计要点
```
Devin 的核心 prompt 设计：
  1. 任务规划阶段（Plan）：
     "Before executing, create a step-by-step plan. 
      Number each step. Mark dependencies."
  
  2. 执行阶段（Execute）：
     "Execute one step at a time. After each step, 
      verify the result before proceeding."
  
  3. 验证阶段（Verify）：
     "After completing the task, explicitly verify 
      each success criterion."

关键设计：
  - 计划 → 执行 → 验证 三阶段严格分离
  - 每步执行后强制"中间验证"（不等最终结果才检查）
  - 显式的成功标准列表（success criteria）

我们的现状：
  - lobster_runner 有基础执行框架
  - 缺乏"中间验证"机制（只有最终结果检查）
  - 缺乏显式成功标准（龙虾说完成了就算完成）
```

### 转化（新增 Codex Task）
```
龙虾执行三阶段强化：
  1. 计划阶段：龙虾在执行前输出 execution_plan（N步计划）
  2. 执行阶段：每步执行后输出 step_result（中间验证）
  3. 验证阶段：对照 success_criteria 逐一确认（非自我声明）

具体到龙虾：
  - 苏思分析线索时：先输出分析框架（计划），再逐步填充，最后核验
  - 墨小雅写消息时：先输出消息结构（计划），再逐段生成，最后审查红线
  - 老健分配任务时：先输出任务分配方案，再确认各龙虾接收，最后验证
```

---

## 五、Cursor 的 Tool-Use 设计原则

### 设计要点（对边缘执行层高度相关）
```
Cursor 的 tool-use 设计：
  1. 工具调用规范：
     - 工具调用必须包含 rationale（为什么调用这个工具）
     - 工具调用结果必须 confirm（确认执行成功/失败）
     - 禁止在不确定时进行破坏性操作（删除/覆写）
  
  2. 工具调用错误处理：
     - tool_error → 分析原因 → 调整参数 → 重试（最多3次）
     - 重试失败 → 向用户报告，提供替代方案
  
  3. 上下文管理（与 LobeHub context-engine 相似）：
     - 只加载当前任务需要的文件（按需加载，非全量）
     - 使用 grep/search 精确定位，而非全文读取

我们的边缘执行层（marionette_executor）对应关系：
  cursor tool_call → marionette 操作
  cursor grep → edge 端文件搜索
  cursor edit → edge 端浏览器/应用操作
```

### 新发现
```
Cursor 的"工具调用有理由"模式：

传统：agent.call_tool("browser_click", {"x": 100, "y": 200})
Cursor：{
  "tool": "browser_click",
  "rationale": "点击确认按钮以提交表单",
  "args": {"x": 100, "y": 200}
}

价值：
  - 每个工具调用都有 rationale，可追溯决策原因
  - 便于审计日志（我们的 audit_logger 可记录 rationale）
  - 便于 Commander 审批（理由清晰则审批快）

转化到我们的边缘层：
  marionette_executor 每次操作附带 rationale 字段
  → 存入 workflow_event_log 便于追溯
  → Commander 审批时参考 rationale 判断是否合规
```

---

## 六、Perplexity 的搜索+AI 融合设计

### 设计要点（对雷达/林桃高度相关）
```
Perplexity 的搜索结果处理：
  1. 引用标注：每段信息必须附带来源编号 [1] [2] [3]
  2. 时效性标注：搜索结果附带 published_date
  3. 可信度分级：官方来源/新闻媒体/博客/论坛 分级权重
  4. 信息整合：多个搜索结果 → 综合摘要（去重、去矛盾）

我们的雷达（radar-lintao）对应改进：
  当前：雷达搜索返回原始结果列表
  改进：
    - 每条信息附带来源 URL 和发布时间
    - 来源可信度评分（官方网站 > 媒体报道 > 社交媒体）
    - 多源信息矛盾时标注"存在争议"
    - 整合后的摘要带标注，便于苏思/老健引用
```

---

## 七、Cline 的 Agent Runner 设计

### 设计要点（对龙虾执行框架直接参考）
```
Cline 的 agent runner 关键规则：
  1. "Think before act"：执行前必须思考，输出内心独白
  2. "One action at a time"：每次只执行一个动作
  3. "Verify after each action"：每个动作后确认结果
  4. "Ask when uncertain"：不确定时主动向用户确认
  5. "Never make assumptions"：不自行假设用户意图

对龙虾的直接影响：
  当前问题：龙虾有时会自行假设任务意图（导致执行偏差）
  
  改进规则（新增到龙虾系统提示词中）：
    "当任务指令不明确时，优先向调度员（老健）确认，
     而不是自行假设。每次执行后，明确报告执行结果。
     不确定是否应该执行某操作时，应先上报而不是执行。"
```

---

## 八、Notion AI 的结构化输出设计

### 设计要点（对可视化和报告生成高度相关）
```
Notion AI 的结构化输出规范：
  1. 使用 Markdown 层级结构（H1/H2/H3）
  2. 数据用表格（勿用纯文字列举）
  3. 关键数据用 **加粗** 或 `高亮`
  4. 操作步骤用有序列表（1. 2. 3.）
  5. 参考资料独立成节（## 参考来源）

对我们的可视化龙虾（影子/visualizer-shadow）：
  当前：影子输出的报告格式不统一
  改进：强制遵循 Notion AI 的结构化输出规范
    - 销售漏斗报告 → 表格（本月/上月/目标 三列）
    - 线索分析报告 → H2 分节（线索概况/关键发现/推荐行动）
    - ROI 计算报告 → 带加粗关键数字的结构化摘要
```

---

## 九、逐层对比（我们的7层架构）

### 🌐 前端 SaaS 控制台
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **Docusaurus 文档站**（系统提示词在线展示）| EliFuzz 整体 | 🆕 | ✅ P2 — 龙虾技能库在线展示文档站 |
| **结构化输出规范**（H1/H2/表格/有序列表）| Notion AI | 🆕 | ✅ P1 — 强化影子报告输出格式规范 |
| Prompt 多版本历史对比展示 | EliFuzz 设计 | 已落地 | ⚡ CODEX_TASK_SYSPROMPTS_P1 |

### 🧠 云端大脑层（Commander）
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **Manager-Agent 审批机制**（执行前审批 tool call）| Parahelp manager | 🆕 | ✅ **P1 最高价值** |
| **Agent 能力分级 L1-L4**（只读/草稿/执行/协调）| Manus | 🆕 | ✅ P1 — 龙虾权限分级 |
| **三阶段执行框架**（计划→执行→验证）| Devin | 🆕 | ✅ P1 — lobster_runner 升级 |

### 🦞 9个龙虾层
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **"不确定时问人"规则**（ask when uncertain）| Cline | 🆕 | ✅ P1 — 所有龙虾系统提示词新增规则 |
| **原子操作原则**（one action at a time）| Cline/Manus | 🆕 | ✅ P1 — lobster_runner 步骤拆分 |
| **Tool call rationale 字段**（每次调用附带理由）| Cursor | 🆕 | ✅ P2 — audit_logger 扩展 |
| **成功标准显式化**（success criteria 列表）| Devin | 🆕 | ✅ P1 — 龙虾任务模板增加验收标准 |
| **搜索引用标注**（每条信息带来源+时间）| Perplexity | 🆕 | ✅ P1 — 雷达输出格式升级 |

### 🏗️ L1.5 支撑微服务集群
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **Augment 任务管理工具**（task list + memory 联动）| Augment | 已落地 | ⚡ CODEX_TASK_LOBSTER_KANBAN |
| **Augment 记忆工具**（memory storage 独立工具）| Augment | 已落地 | ⚡ CODEX_TASK_MEMORY_UPGRADE |

### 🛰️ 云边调度层
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **Windsurf cascade 模式**（流式工作流执行）| Windsurf | 已落地 | ⚡ CODEX_TASK_WORKFLOW_REALTIME_STREAM |

### 🖥️ 边缘执行层
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **Tool call rationale**（操作附带理由，便于审计）| Cursor | 🆕 | ✅ P2 — marionette_executor 扩展 |
| **破坏性操作保护**（禁止在不确定时删除/覆写）| Cursor | 🆕 | ✅ P1 — edge 层安全增强 |

### 💰 整体 SaaS 系统
| 发现 | 借鉴自 | 状态 | 值 |
|------|-------|------|----|
| **prompt 版本管理**（多版本对比，时间线展示）| EliFuzz 站点设计 | 已落地 | ⚡ CODEX_TASK_SYSPROMPTS_P1 |
| **Parahelp Planning Prompt 独立**（计划与执行分离）| Parahelp | 🆕 | ✅ P1 — 龙虾计划阶段独立 |

---

## 十、优先级汇总（新增，排除已落地）

### 🔴 P1（6项）

| # | 功能 | 借鉴自 | 落地位置 |
|---|------|-------|---------|
| P1-1 | **龙虾指挥官审批层**（Commander Gate，执行前审批高风险操作）| Parahelp manager | 升级 `commander_graph_builder.py` |
| P1-2 | **龙虾执行三阶段**（Plan→Execute→Verify，显式成功标准）| Devin | 升级 `lobster_runner.py` |
| P1-3 | **龙虾权限分级 L1-L4**（只读/草稿/执行/协调）| Manus | 升级龙虾角色卡 + `rbac_permission.py` |
| P1-4 | **"不确定时问人"规则**（所有龙虾系统提示词新增规则）| Cline | 升级所有 `lobster-kb/*.md` |
| P1-5 | **雷达引用标注**（每条搜索结果附来源+发布时间+可信度）| Perplexity | 升级 `web_search_tool.py` + 雷达 KB |
| P1-6 | **边缘操作破坏性保护**（删除/覆写操作前二次确认）| Cursor | 升级 `marionette_executor.py` |

### 🟡 P2（2项）

| # | 功能 | 借鉴自 | 落地位置 |
|---|------|-------|---------|
| P2-1 | **Tool call rationale 字段**（每次工具调用附带理由，存审计日志）| Cursor | 升级 `audit_logger.py` + `workflow_event_log.py` |
| P2-2 | **龙虾技能库文档站**（类 EliFuzz 站点，在线展示龙虾技能和提示词）| EliFuzz Docusaurus | 新建文档站（`docs/lobster-skills-portal/`）|

---

## 十一、最重要的 Prompt 工程规律（跨产品提炼）

通过对比 70+ 产品的系统提示词，提炼出以下适用于我们所有龙虾的通用规律：

### 规律1：角色 + 禁区 + 格式 = 最小完整提示词
```
每个龙虾的系统提示词必须包含且仅需包含：
  1. 角色定义（你是谁，你的核心职责）
  2. 禁区声明（你绝对不做什么，来自 LOBSTER_CONSTITUTION）
  3. 输出格式（你的输出必须符合什么格式）

我们已有 ✅：角色定义和禁区
我们缺少 ❗：统一的输出格式规范（影子不统一，苏思格式混乱）
```

### 规律2：不确定性处理 = 提前问，而非事后纠正
```
Cline/Cursor/Devin 都强调：
  "在不确定时，优先问用户/上级，而非自行假设"
  
我们的龙虾当前：
  遇到不确定时 → 自行假设 → 执行 → 可能出错 → 老健纠正

应改为：
  遇到不确定时 → 向老健发 mailbox 消息 → 等待确认 → 执行
  
触发"主动问人"的场景：
  - 任务描述歧义（两种理解方式）
  - 执行结果与预期偏差 > 30%
  - 需要访问未授权资源
  - 涉及红线边缘操作
```

### 规律3：工具调用 = 原子操作 + 理由 + 确认
```
所有顶级 AI Agent 的工具调用模式：
  {
    "tool": "xxx",
    "rationale": "为什么需要这个工具",
    "args": {...},
    "expected_result": "预期会得到什么"
  }
  
执行后：
  {
    "status": "success/failure",
    "actual_result": "实际得到什么",
    "next_action": "下一步"
  }

我们的现状：工具调用没有 rationale 和 expected_result
```

### 规律4：审批流 = 高风险操作的护城河
```
Parahelp 的 manager-agent 模式揭示：
  并非所有操作都需要审批（效率考虑）
  只有高风险操作（直接与客户交互、财务相关）需要审批
  
我们的龙虾审批触发条件：
  🔴 必须审批：向线索发消息、发报价单、做承诺
  🟡 建议审批：含竞品对比的内容、超出常规跟进频率
  🟢 直接执行：调研分析、内部报告、数据统计
```

---

*来源：EliFuzz/awesome-system-prompts | 分析日期：2026-04-02*
