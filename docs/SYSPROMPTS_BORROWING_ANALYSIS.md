# System Prompts & AI Tools 借鉴分析报告

**来源**：https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools（⭐134,012）  
**收录工具**：Cursor、Windsurf、Manus、Devin AI、v0、Kiro、Claude Code、Replit、Anthropic 等 30+ 个顶级 AI 工具  
**分析日期**：2026-04-02  
**核心价值**：全网最权威的 AI Agent 设计模式参考库

---

## 一、各AI工具架构速览

### 🎯 Windsurf（Cascade）— AI Flow 范式
```
定位：世界第一个 Agentic Coding Assistant（AI Flow paradigm）
System Prompt 核心设计：
  - 明确声明自己是"对开发者友好的 pair programmer"
  - 工具调用原则：Only when absolutely necessary（最小工具原则）
  - 每次工具调用前先说明原因（透明化）
  - 代码变更：NEVER output code to user，只用工具实现
  - 任务完成后给 BRIEF summary（不冗长）

工具体系（Tools Wave 11）：
  browser_preview / capture_screenshot / check_deploy
  run_command / edit_file / view_file / grep_search
  semantic_search / deploy_web_app
```

### 🎯 Cursor（Agent Prompt 2.0）— 38KB 超长 Prompt
```
定位：IDE 内嵌 AI 编程助手，多版本迭代
核心特色：
  - 有完整的 Agent CLI Prompt（CLI 模式独立 Prompt）
  - Chat Prompt 和 Agent Prompt 分离（两套独立 System）
  - Tools v1.0 独立管理工具定义
  - 版本化管理（v1.0 → v1.2 → 2.0 → 2025-09-03）
```

### 🎯 Manus Agent — 最完整的 Multi-Agent 架构
```
文件结构：
  Agent loop.txt    ← Agent 执行循环设计（2KB）
  Modules.txt       ← 模块化设计（12KB）
  Prompt.txt        ← 主提示词（10KB）
  tools.json        ← 工具定义（18KB）

核心创新：
  - 明确的 Agent Loop 设计（不是简单的 prompt，是循环架构）
  - 模块化：每个能力是独立 Module，可组合
  - 工具与 Prompt 分离存储
```

### 🎯 Devin AI — 最长 Prompt（34KB）
```
定位：自主软件工程师
核心设计：
  - 超长详细 prompt（34KB = 约 8500 词）
  - 完整的任务规划、执行、验证三阶段设计
  - DeepWiki Prompt（5KB）独立用于知识库查询
```

### 🎯 v0（Vercel）— 前端生成专家（36KB Prompt）
```
定位：前端代码生成（React/Next.js/shadcn）
核心设计：
  - 36KB 的精细 Prompt（最长非 Agent 类）
  - Tools.json（29KB）— 丰富的前端工具
  - 严格的代码风格约束（tailwind/shadcn 规范）
```

### 🎯 Kiro — 规格驱动开发（Spec-First）
```
文件结构：
  Mode_Classifier_Prompt.txt  ← 模式分类器（Vibe vs Spec）
  Spec_Prompt.txt             ← 规格模式 Prompt（31KB）
  Vibe_Prompt.txt             ← 快捷模式 Prompt（14KB）

核心创新：
  - 两种工作模式：Vibe（快速迭代）vs Spec（规格驱动）
  - Mode Classifier 根据请求自动选择模式
  - Spec 先写规格文档，再执行代码
```

### 🎯 Claude Code 2.0 — 最克制的设计
```
核心原则（最高价值）：
  1. Do what has been asked; nothing more, nothing less.
  2. NEVER create files unless absolutely necessary
  3. ALWAYS prefer editing existing files
  4. NEVER proactively create documentation
  5. Minimize output tokens as much as possible
  6. Answer directly, avoiding any elaboration/preamble/postamble
```

### 🎯 Replit Agent — 沙箱执行专家
```
Prompt.txt（8KB）+ Tools.json（25KB）
特色：
  - 云端沙箱执行环境
  - 工具集包含文件系统、进程管理、网络工具
```

---

## 二、逐层对比分析（对应我们的 6 层架构）

### 🌐 前端 SaaS 控制台

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **v0 的前端生成专家化**（专门为 shadcn/tailwind 优化，有严格的组件使用规范）| 前端有基础组件 | ✅ **P1** — 前端组件专家化规范（每个组件有明确的设计约束，不随意选型）|
| **Windsurf 的 Browser Preview 工具**（实时预览 + 截图 + Console 日志三合一）| 无浏览器预览 | ✅ **P1** — 前端调试工具链（SaaS 后台支持实时预览龙虾执行效果）|
| **Kiro 的 Spec-First 模式**（先写规格文档，再写代码，避免反复改需求）| 无结构化需求管理 | ✅ **P2** — 运营工作流规格化（运营人员先写任务规格，再执行）|
| **Cursor 的 Chat vs Agent 双模式**（普通对话 vs Agent 自主执行，不同模式不同 Prompt）| 单一模式 | ✅ **P2** — 双模式前端（快速问答 vs 深度执行，切换不同龙虾团队）|

### 🧠 云端大脑层（Commander + 调度）

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **Manus 的 Agent Loop 设计**（明确的循环：感知→规划→执行→反馈→下一轮）| `lobster_runner.py` 有基础 | ✅ **P1** — 标准化 Agent Loop（每次执行是完整循环，有反馈闭环）|
| **Claude Code 的极简原则**（Do what's asked, nothing more. 不主动创建文件）| 龙虾有时过度执行 | ✅ **P1** — 龙虾最小执行原则（只做被要求的，不主动扩展范围）|
| **Manus 的 Module 化设计**（每个能力是独立 Module，按需组合）| `skill_frontmatter.py` 有雏形 | ✅ **P1** — 龙虾能力 Module 注册（每种能力是独立模块，Commander 按需组合）|
| **Kiro 的 Mode Classifier**（根据请求复杂度自动分配执行模式）| 无复杂度分类 | ✅ **P2** — 任务复杂度分类器（简单任务→单龙虾，复杂任务→龙虾团队协作）|
| **Devin 的三阶段**（规划 → 执行 → 验证，每阶段有明确输出）| 执行和验证混在一起 | ✅ **P2** — 三阶段任务框架（Plan/Execute/Verify 明确分离）|
| **Windsurf 的 toolSummary**（每个工具调用都有 2-5 字 summary，方便 UI 显示）| 无执行摘要 | ✅ **P1** — 龙虾执行步骤摘要（每个执行步骤有简短摘要，前端实时显示）|

### 🦞 9个龙虾层

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **Claude Code 的「不主动扩展」原则**（拒绝超范围执行，保持职责边界）| 龙虾职责有时模糊 | ✅ **P1** — 龙虾职责红线（每只龙虾有明确的"不做什么"清单）|
| **Windsurf 的「先说明工具调用原因」**（Before calling each tool, explain why）| 无执行理由记录 | ✅ **P1** — 龙虾执行日志强制原因字段（每步操作记录 why 字段）|
| **v0 的代码风格约束**（有严格的 UI 组件使用规范，不随意选型）| 龙虾输出格式不统一 | ✅ **P1** — 龙虾输出规范化（每类龙虾的输出有明确格式约束）|
| **Cursor 的版本化 Prompt**（v1.0→v1.2→2.0→2025-09-03，持续迭代有记录）| `prompt_registry.py` 有基础 | ✅ **P1** — Prompt 版本化管理（已落地，继续强化变更记录）|
| **Manus 的工具与 Prompt 分离**（tools.json 独立维护，prompt 单独管理）| 混合管理 | ✅ **P2** — 龙虾能力与 Prompt 解耦（工具定义和提示词分开存储和版本化）|
| **Kiro 的 Vibe Mode**（快速迭代模式，不写规格，直接执行）| 无快捷执行模式 | ✅ **P2** — 龙虾快捷模式（线索紧急时跳过规划，直接执行标准动作）|

### 🏗️ L1.5 支撑微服务集群

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **Manus Modules.txt 的模块化架构**（12KB 的模块定义，每个模块有独立职责）| 微服务有基础 | ✅ **P1** — 能力模块注册表（参考 Manus Modules 设计，每个微服务有标准化模块定义）|
| **工具类型系统**（Windsurf/Cursor 的 tools.json 用 TypeScript 类型描述工具，类型安全）| 工具定义无类型 | ✅ **P2** — 工具类型系统（每个 L1.5 微服务的 API 有 TypeScript-like 类型定义）|
| **Replit 的沙箱工具集**（25KB 工具集覆盖文件/进程/网络/数据库）| 无标准工具集 | ✅ **P2** — 边缘工具集标准化（参考 Replit Tools 设计，定义边缘节点标准工具集）|

### 🛰️ 云边调度层

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **Windsurf 的「keep working until resolved」**（Agent 持续工作，不中途停下等用户）| 有时中途等待 | ✅ **P1** — 龙虾自驱执行（一旦接任务，自主执行到结束，不中途请示）|
| **Manus Agent Loop 的循环设计**（每轮感知→规划→执行→反馈，明确循环边界）| 无明确循环边界 | ✅ **P1** — 标准化执行循环（边缘节点的每次任务执行有标准化循环结构）|
| **Claude Code 的「不重复工具调用」**（Avoid redundant tool calls，每步工具调用必要性验证）| 有时重复执行 | ✅ **P2** — 执行去重机制（云边调度检测重复指令，防止龙虾重复执行）|

### 🖥️ 边缘执行层

| AI工具设计模式 | 我们现状 | 差距/借鉴价值 |
|-------------|---------|------------|
| **Windsurf 的 Browser Preview**（边缘可以控制浏览器，截图，读 Console 日志）| `marionette_executor.py` 有基础 | ✅ **P1** — 边缘浏览器截图回传（执行截图自动回传云端，运营可见执行效果）|
| **Devin 的 DeepWiki 独立查询**（有专门的知识库查询 Prompt，独立于主 Prompt）| 知识库查询内嵌 | ✅ **P2** — 边缘独立知识查询（边缘有独立的产品/行业知识库查询模块）|
| **Cursor CLI Prompt**（CLI 模式有独立的、更简洁的 Prompt，适合非交互场景）| 无 CLI 模式 | ✅ **P2** — 边缘无头模式（边缘执行有独立的 headless Prompt，去掉 UI 相关指令）|

---

## 三、最高价值设计模式提炼

### 🏆 TOP 1: Claude Code 的「最小执行原则」

```
原文：
  "Do what has been asked; nothing more, nothing less."
  "NEVER create files unless absolutely necessary."
  "ALWAYS prefer editing existing files."
  "Minimize output tokens as much as possible."

转化为我们的龙虾设计原则：
  ✅ 龙虾只做被分配的任务，不主动扩展范围
  ✅ 龙虾能用已有数据就不发起新请求
  ✅ 龙虾输出尽量简洁，不冗长
  ✅ 龙虾操作有副作用前必须确认（删除/批量操作）
```

### 🏆 TOP 2: Manus 的 Agent Loop 结构

```
Manus Agent Loop（2KB 精华）：
  LOOP {
    1. 感知当前状态（Perception）
    2. 选择下一步行动（Action Selection）
    3. 调用工具执行（Tool Execution）
    4. 观察结果（Observation）
    5. 判断是否完成（Completion Check）
    → 未完成则继续循环
  }

转化为我们的龙虾执行框架：
  每次龙虾执行 = 感知(线索状态) → 选择动作 → 执行工具 → 观察反馈 → 判断完成
```

### 🏆 TOP 3: Kiro 的双模式设计

```
Kiro 的 Mode Classifier：
  - Vibe Mode：快速执行，不写规格，适合简单任务
  - Spec Mode：先写规格文档，适合复杂任务

转化为我们的任务分级：
  - 快捷模式（Vibe）：线索回复/标准跟进 → 单龙虾直接执行
  - 规格模式（Spec）：活动策划/内容生产 → 先出方案，再分配龙虾
```

### 🏆 TOP 4: Windsurf 的 toolSummary 设计

```
Windsurf 每个工具调用必须有 toolSummary：
  toolSummary: "analyzing directory" | "editing file" | "running command"

转化为我们的龙虾执行步骤：
  每个步骤有 2-5 字的 action_summary
  → 前端实时显示"正在分析线索"、"正在撰写消息"、"正在发送"
```

### 🏆 TOP 5: Cursor 的 Prompt 版本化管理

```
Cursor 的版本化：
  Agent Prompt v1.0 → v1.2 → 2.0 → 2025-09-03（共4个版本）
  Chat Prompt 独立维护

我们已有 prompt_registry.py（已落地），需要强化：
  → 每个版本有 changelog（改了什么/为什么/效果对比）
  → 不同龙虾可以绑定不同版本的 Prompt
  → 支持 A/B 对比（已落地 Opik 实验）
```

---

## 四、优先级汇总

### 🔴 P1（新增高价值，5项）

| # | 功能 | 借鉴自 | 落地路径 |
|---|------|-------|---------|
| P1-1 | **龙虾最小执行原则**（执行边界声明 + 超范围拒绝机制）| Claude Code | 更新所有龙虾 KB 的「不做什么」章节 |
| P1-2 | **标准化 Agent Loop**（感知→选择→执行→观察→完成判断）| Manus | 升级 `lobster_runner.py` 循环结构 |
| P1-3 | **执行步骤摘要**（每步 2-5 字 action_summary，前端实时显示）| Windsurf toolSummary | 升级 `api_lobster_realtime.py` |
| P1-4 | **能力 Module 注册表**（每种能力是独立 Module，参考 Manus Modules）| Manus | `dragon-senate-saas-v2/module_registry.py` |
| P1-5 | **边缘执行截图回传**（marionette 执行时截图回传云端，运营可见）| Windsurf Browser Preview | 升级 `edge-runtime/marionette_executor.py` |

### 🟡 P2（5项）

| # | 功能 | 借鉴自 | 落地路径 |
|---|------|-------|---------|
| P2-1 | **任务复杂度分类器**（Vibe vs Spec 双模式，自动分配执行策略）| Kiro Mode Classifier | `dragon-senate-saas-v2/task_classifier.py` |
| P2-2 | **工具类型系统**（tools.json TypeScript-like 类型定义，类型安全）| Windsurf/Cursor Tools | `dragon-senate-saas-v2/tool_schema.py` |
| P2-3 | **三阶段任务框架**（Plan/Execute/Verify 显式分离，各有输出）| Devin AI | 升级 `lobster_task_dag.py` |
| P2-4 | **龙虾 Prompt 版本 Changelog**（每版本记录改了什么/效果对比）| Cursor 版本化 | 升级 `prompt_registry.py` |
| P2-5 | **边缘无头模式**（CLI/headless 场景的精简 Prompt，去掉 UI 相关）| Cursor CLI Prompt | `edge-runtime/headless_prompt.py` |

---

## 五、与我们项目的互补性

```
这些AI工具的核心设计哲学 vs 我们的实践：

Claude Code "Do nothing more"  →  龙虾职责红线（我们已有宪法，需更严格执行）
Manus Agent Loop               →  升级 lobster_runner 的循环结构（P1）
Windsurf toolSummary           →  实时执行步骤展示（P1，用户体验关键）
Kiro 双模式                    →  快捷 vs 规格任务分级（P2）
Cursor Prompt 版本化            →  prompt_registry 已落地，加 changelog（已落地）
v0 前端规范化                   →  组件使用规范（已落地 shadcn）
Devin 三阶段                    →  task_dag 已有，更明确 Plan/Execute/Verify

独特优势（这些工具没有的）：
  🦞 9只有灵魂的角色（这些工具的 AI 都没有人格/背景故事）
  📱 中国 IM 渠道深度集成（这些工具都不支持企微/飞书/钉钉）
  💰 LLM 成本可见性（每次执行的 token/cost 实时显示）
  🧠 mem0 记忆层（这些工具执行完不会记住用户偏好）
  📊 效果可量化（回复率/转化率，这些工具无营销漏斗指标）
```

---

*来源：system-prompts-and-models-of-ai-tools（⭐134k）| 分析日期：2026-04-02*
