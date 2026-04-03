# ZeroLeaks 借鉴分析报告

**来源**：https://github.com/ZeroLeaks/zeroleaks（⭐539）  
**定位**：AI Security Scanner — 自主多 Agent 架构的 LLM 系统安全扫描器  
**技术栈**：TypeScript / Bun / OpenRouter / Vercel AI SDK  
**核心价值**：全球最完整的开源 AI Prompt 注入攻击框架，6大攻击 Agent + 12类攻击探针 + 知识库  
**分析日期**：2026-04-02

---

## 一、项目架构速览

### 🏗️ 整体架构
```
zeroleaks/
├── src/agents/         # 多 Agent 扫描引擎（10个 Agent 文件）
│   ├── engine.ts       # 扫描引擎主控（44KB，最核心）
│   ├── strategist.ts   # 策略选择 Agent（18KB）
│   ├── attacker.ts     # 攻击生成 Agent（18KB）
│   ├── evaluator.ts    # 结果评估 Agent（14KB）
│   ├── mutator.ts      # 攻击变异 Agent（11KB）
│   ├── inspector.ts    # 防御指纹 Agent（19KB，TombRaider）
│   ├── orchestrator.ts # 多轮攻击编排（19KB）
│   └── target.ts       # 被测系统包装器（2KB）
├── src/probes/         # 12类攻击探针库（总计 130KB+）
│   ├── direct.ts       # 直接提取攻击
│   ├── encoding.ts     # Base64/ROT13/Unicode 编码绕过
│   ├── personas.ts     # DAN/角色扮演/人格注入
│   ├── social.ts       # 社会工程学
│   ├── modern.ts       # Crescendo/CoT 劫持/政策操控
│   ├── injection.ts    # 32KB 完整注入攻击库
│   ├── hybrid.ts       # 混合攻击
│   └── garak-inspired.ts # 来自 garak 框架的攻击
├── src/knowledge/      # 攻击知识库（CVE 级别）
│   ├── techniques.ts   # 攻击技术文档（16KB）
│   ├── payloads.ts     # Payload 模板（11KB）
│   ├── exfiltration.ts # 数据外泄向量（8KB）
│   └── defense-bypass.ts # 防御绕过方法（11KB）
└── src/types.ts        # 完整类型系统（13KB）
```

### 🤖 6大攻击 Agent 职责分工

| Agent | 类比我们 | 核心能力 |
|-------|---------|---------|
| Engine（引擎）| Commander 陈总 | 主控扫描流程，管理攻击树 |
| Strategist（策略师）| 苏思（Strategist）| 根据防御画像选择攻击策略 |
| Attacker（攻击者）| 铁狗（Catcher）| 生成攻击 Prompt |
| Evaluator（评估者）| 算无遗策（Abacus）| 分析响应，判断是否泄露 |
| Mutator（变异者）| 墨小雅（InkWriter）| 变异成功攻击，生成变体 |
| Inspector（检查员）| 雷达（Radar）| TombRaider 防御指纹识别 |
| Orchestrator（编排者）| 老健（Dispatcher）| 多轮攻击序列编排 |

### ⚔️ 攻击阶段（6阶段攻击框架）
```typescript
type AttackPhase = 
  "reconnaissance"  // 侦察 - 探测系统信息
  | "profiling"     // 画像 - 建立防御画像
  | "soft_probe"    // 软探 - 低强度试探
  | "escalation"    // 升级 - 加强攻击
  | "exploitation"  // 利用 - 实际漏洞利用
  | "persistence"   // 持久 - 建立持久访问
```

### 🛡️ 防御等级评估系统
```typescript
type DefenseLevel = "none" | "weak" | "moderate" | "strong" | "hardened"
type LeakStatus = "none" | "hint" | "fragment" | "substantial" | "complete"
```

---

## 二、逐层对比分析（对应我们的 6 层架构）

### 🌐 前端 SaaS 控制台

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **开源版 vs 托管版对比表**（免费/设置/扫描次数/报告格式 4维度对比）| 我们有定价页 | ✅ **P1** — 前端定价对比表（开源自托管 vs SaaS 托管，对比表格式更直观）|
| **CLI 工具 + npm 包**（zeroleaks scan 命令，开发者友好入口）| 无 CLI 工具 | ✅ **P2** — 龙虾 CLI 工具包（运营技术人员可 CLI 调用龙虾，不必通过 SaaS UI）|
| **扫描报告 PDF 导出**（托管版支持 JSON + Interactive Dashboard + PDF）| 有报告导出 | ✅ **P2** — 执行报告 PDF（龙虾执行结果 + 转化漏斗 + 建议的 PDF 报告）|
| **双模式扫描**（system prompt 提取 vs prompt 注入测试，两种模式独立配置）| 无安全扫描 | ✅ **P1** — 龙虾安全审计（对龙虾 Prompt 做注入安全扫描，防止竞争对手攻击）|

### 🧠 云端大脑层（Commander + 调度）

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **Tree of Attacks（TAP）**（攻击树探索 + 剪枝，系统性覆盖所有攻击向量）| `commander_graph_builder.py` 有 DAG | ✅ **P1** — Commander 任务攻击树（参考 TAP 设计，Commander 规划任务时用攻击树式的系统覆盖）|
| **ScanEngine（44KB）**（扫描主控：管理 Agent 协作、攻击树、进度、结果）| `lobster_runner.py` 有基础 | ✅ **P1** — 升级 Commander 引擎（参考 ScanEngine 的 Agent 协调机制）|
| **自适应温度控制**（`TemperatureConfig`：根据攻击阶段动态调整 LLM temperature）| 固定 temperature | ✅ **P2** — 动态 Temperature（龙虾在不同执行阶段用不同 temperature：探索高/执行低）|
| **攻击 abort 机制**（`ScanResult.aborted + completionReason`，扫描异常时优雅终止）| 缺少优雅退出 | ✅ **P1** — 龙虾任务 abort 机制（执行超时/异常/边界违反时有明确的终止理由）|

### 🦞 9个龙虾层

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **Strategist Agent（策略师）**（根据 DefenseProfile 选择攻击策略，有 StrategyState）| 苏思有基础 | ✅ **P1** — 苏思策略状态机（参考 StrategyState，策略执行有明确状态转移）|
| **Evaluator Agent（评估者）**（对每次 LLM 输出做专项评估，LeakStatus 评分）| abacus 有基础 | ✅ **P1** — 算无遗策评分系统（参考 LeakStatus，每次龙虾输出有 0-100 效果评分）|
| **Mutator Agent（变异者）**（对成功案例做变体生成，扩大攻击覆盖面）| 无变异机制 | ✅ **P1** — 龙虾成功案例变异（成功的消息/内容做变体，自动生成 3-5 个变体测试）|
| **Inspector 防御指纹**（TombRaider：识别目标系统使用了什么防御手段）| 无防御感知 | ✅ **P2** — 线索防御感知（识别线索使用了什么防护机制：已读回执/自动回复/过滤词）|
| **Orchestrator 多轮编排**（`MultiTurnSequence` + `MultiTurnStep`：精细控制多轮对话序列）| 多轮对话有基础 | ✅ **P1** — 多轮对话编排升级（参考 MultiTurnSequence，对话轮次有精确控制和步骤定义）|
| **LearningRecord（学习记录）**（记录成功/失败的攻击，用于改进策略）| `battle_log.json` 有基础 | ✅ **P1** — 龙虾学习记录增强（参考 LearningRecord，记录每次执行的成功/失败原因）|

### 🏗️ L1.5 支撑微服务集群

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **Knowledge Base 独立服务**（techniques/payloads/exfiltration/defense-bypass 4个模块独立）| 知识库分散 | ✅ **P1** — 龙虾攻击知识库（行业知识/客户案例/竞品分析 独立模块，按需加载）|
| **Probe Library（探针库）**（12类攻击探针，每类独立文件，可按需加载）| `skill_frontmatter.py` 有雏形 | ✅ **P1** — 龙虾技能探针库（每种沟通技巧是独立探针，可组合选择最优探针）|
| **DefenseFingerprint 数据库**（`DefenseFingerprintDatabase`：已知防御系统的特征库）| 无特征库 | ✅ **P2** — 线索特征数据库（不同类型线索的响应特征，自动识别线索类型）|
| **renderPayload（渲染引擎）**（模板 + 上下文 → 动态渲染攻击 Payload）| 模板有基础 | ✅ **P1** — 消息渲染引擎（参考 renderPayload，线索画像 + 模板 → 个性化消息）|

### 🛰️ 云边调度层

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **ScanProgress（扫描进度）**（详细的进度结构：当前阶段/已完成步骤/总步骤/ETA）| 进度有基础 | ✅ **P1** — 任务进度升级（参考 ScanProgress，任务进度有阶段/步骤/ETA 三级精度）|
| **ParallelEvaluationResult（并行评估）**（多个 Evaluator 并行评估同一结果）| 串行评估 | ✅ **P2** — 并行评估（多龙虾并行评估同一执行结果，取共识）|
| **retry util（重试工具）**（指数退避重试，maxAttempts + backoff 配置）| 重试逻辑分散 | ✅ **P1** — 统一重试工具（参考 ZeroLeaks 的 retry util，统一所有 LLM 调用的重试策略）|

### 🖥️ 边缘执行层

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **攻击阶段枚举**（6阶段：侦察→画像→软探→升级→利用→持久）| 边缘执行无阶段 | ✅ **P2** — 边缘执行阶段化（边缘任务执行分阶段：接收→准备→执行→回传→确认）|
| **FailedAttack + FailureReason**（失败原因精确记录：rate_limited/blocked/refused/timeout）| 失败记录粗糙 | ✅ **P1** — 边缘失败原因分类（参考 FailureReason，失败有精确分类便于诊断）|
| **Target 包装器**（`target.ts`：被测系统的统一包装，隔离 API 差异）| 渠道耦合 | ✅ **P2** — IM 渠道统一包装器（参考 target.ts，每个 IM 渠道有统一包装接口）|

### 💰 整体 SaaS 系统

| ZeroLeaks 设计 | 我们现状 | 借鉴价值 |
|-------------|---------|---------|
| **开源+托管双轨制**（开源版无限扫描/JSON输出 vs 托管版PDF报告/CI-CD集成/历史趋势）| 纯 SaaS 模式 | ✅ **P2** — 开源+托管双轨（考虑开源精简版，引流到托管 SaaS）|
| **npm 包发布**（`bun add zeroleaks`，可集成到任意 TypeScript 项目）| 无 SDK | ✅ **P2** — 龙虾 SDK（`pip install openclaw`，开发者可编程调用龙虾）|
| **CI/CD 集成**（托管版内置 CI/CD 扫描，每次发布前自动安全扫描）| 无 CI/CD | ✅ **P2** — 龙虾 CI/CD 钩子（企业客户在 CI/CD 中触发龙虾内容合规检查）|

---

## 三、最高价值设计模式提炼

### 🏆 TOP 1: Tree of Attacks（TAP）- 攻击树探索框架

```
ZeroLeaks 的 TAP 设计：
  根节点：目标（被测 LLM 系统）
  分支节点：攻击策略（直接/编码/人格/社会工程）
  叶节点：具体 Probe（单个攻击 Prompt）
  剪枝：失败的分支不再深入，聚焦有效路径
  评分：每个节点有漏洞评分（0-100）

转化为我们的任务规划：
  根节点：目标（获客/转化/复购/内容）
  分支节点：龙虾策略（情感连接/价值展示/痛点挖掘）
  叶节点：具体消息/动作（发送/回复/跟进）
  剪枝：无响应的线索降低优先级
  评分：每个线索的转化潜力评分
```

### 🏆 TOP 2: DefenseProfile + DefenseLevel - 目标防御画像

```python
# ZeroLeaks 的防御画像（转化为我们的线索画像）
class DefenseProfile:
    defense_level: str    # none/weak/moderate/strong/hardened
    known_systems: list   # 已识别的防御系统
    observed_behaviors: list  # 观察到的防御行为

# 转化为线索响应画像
class LeadResponseProfile:
    engagement_level: str   # none/cold/warm/hot/converted
    known_objections: list  # 已发现的拒绝理由
    observed_patterns: list # 观察到的回复模式（已读不回/礼貌拒绝/主动询问）
```

### 🏆 TOP 3: LeakStatus - 效果评分系统

```
ZeroLeaks 的 LeakStatus（泄露程度）：
  none → hint → fragment → substantial → complete

转化为我们的转化漏斗状态：
  unknown → aware → interested → considering → decided → converted
  
每次龙虾执行后：
  - 当前转化状态
  - 状态是否有进展（升级/降级/保持）
  - 进展置信度（0-100）
```

### 🏆 TOP 4: Mutator Agent - 成功案例变异

```
ZeroLeaks 的 Mutator：
  输入：一个成功的攻击 Prompt
  输出：3-5 个变体（保持有效性，改变表达方式）
  目的：绕过防御过滤，增加成功率

转化为我们的消息变异：
  输入：一条成功的成交消息模板
  输出：5-10 个变体（保持说服力，改变语气/开头/结尾）
  目的：A/B 测试，找到最优表达
```

### 🏆 TOP 5: FailureReason - 失败原因精确分类

```typescript
type FailureReason = 
  "rate_limited"    // 速率限制
  | "blocked"       // 被拦截
  | "refused"       // 模型拒绝
  | "timeout"       // 超时
  | "parse_error"   // 解析错误

转化为我们的龙虾失败分类：
type LobsterFailureReason =
  "lead_not_found"       // 线索不存在
  | "channel_blocked"    // IM 渠道封号
  | "message_filtered"   // 消息被过滤
  | "rate_limited"       // 发送频率限制
  | "lead_rejected"      // 线索明确拒绝
  | "timeout"            // 执行超时
  | "llm_error"          // LLM 调用失败
  | "boundary_violation" // 越权操作
```

---

## 四、优先级汇总

### 🔴 P1（新增高价值，6项）

| # | 功能 | 借鉴自 | 落地文件 |
|---|------|-------|---------|
| P1-1 | **龙虾安全审计**（对我们自己的龙虾 Prompt 做注入安全扫描）| ScanEngine | `dragon-senate-saas-v2/lobster_security_audit.py` |
| P1-2 | **Commander 任务攻击树**（TAP 风格的任务覆盖树，系统规划执行路径）| TAP 框架 | 升级 `commander_graph_builder.py` |
| P1-3 | **龙虾成功案例变异器**（对成功消息自动生成 5-10 个变体）| Mutator Agent | `dragon-senate-saas-v2/message_mutator.py` |
| P1-4 | **失败原因精确分类**（7种失败原因枚举，精确诊断）| FailureReason | 升级 `audit_logger.py` + `lobster_runner.py` |
| P1-5 | **线索转化状态机**（LeakStatus 转化为转化漏斗状态，6个层级）| LeakStatus | `dragon-senate-saas-v2/lead_conversion_fsm.py` |
| P1-6 | **多轮对话序列编排**（MultiTurnSequence 精细控制对话轮次）| Orchestrator | 升级 `lobster_task_dag.py` |

### 🟡 P2（5项）

| # | 功能 | 借鉴自 | 落地文件 |
|---|------|-------|---------|
| P2-1 | **动态 Temperature 控制**（不同执行阶段不同 temperature）| TemperatureConfig | 升级 `prompt_registry.py` |
| P2-2 | **线索特征数据库**（不同类型线索的响应特征库）| DefenseFingerprintDB | `dragon-senate-saas-v2/lead_profile_db.py` |
| P2-3 | **龙虾 SDK 包**（`pip install openclaw`，可编程调用）| npm package | `dragon-senate-saas-v2/sdk/__init__.py` 升级 |
| P2-4 | **并行评估机制**（多龙虾并行评估执行结果，取共识）| ParallelEvaluation | 升级 `llm_quality_judge.py` |
| P2-5 | **IM 渠道统一包装器**（参考 target.ts，隔离各渠道 API 差异）| target.ts 设计 | 升级 `lobster_im_channel.py` |

---

## 五、我们的独特护城河（ZeroLeaks 没有的）

```
ZeroLeaks 是安全扫描工具，我们是营销自动化平台：

我们有，ZeroLeaks 没有：
  🦞 9只有灵魂的角色（ZeroLeaks 的 Agent 是功能性的，无人格）
  📱 中国 IM 渠道深度集成（企微/飞书/钉钉/微信）
  💰 LLM 成本实时可见（每次龙虾执行的 token/cost）
  🧠 mem0 长期记忆（ZeroLeaks 每次扫描都是无状态的）
  📊 营销漏斗量化指标（回复率/转化率，ZeroLeaks 无业务指标）
  🔄 持续跟进系统（ZeroLeaks 是一次性扫描，我们是长期关系管理）

互补借鉴：
  ZeroLeaks 的攻击框架 → 我们的防御框架（保护自己的龙虾 Prompt 不被竞争对手注入）
  ZeroLeaks 的评估体系 → 我们的效果评估（从漏洞评分到转化评分）
  ZeroLeaks 的变异机制 → 我们的内容生产（从攻击变异到消息变体）
```

---

*来源：ZeroLeaks/zeroleaks（⭐539）| 分析日期：2026-04-02*
