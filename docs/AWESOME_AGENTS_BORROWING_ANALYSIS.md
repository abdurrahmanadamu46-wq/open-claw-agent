# Awesome OpenClaw Agents 借鉴分析

> ?? ????????? `SOUL.md / HEARTBEAT.md / WORKING.md` ????????????? **CODEX-AA-01**??????????


> **项目**: [mergisi/awesome-openclaw-agents](https://github.com/mergisi/awesome-openclaw-agents)
> **Stars**: 2237 | **Forks**: 333 | **Language**: JavaScript | **License**: MIT
> **描述**: 162 production-ready AI agent templates for OpenClaw. SOUL.md configs across 19 categories.
> **Homepage**: [crewclaw.com](https://crewclaw.com)
> **分析日期**: 2026-03-31

---

## 一、项目定位

**Awesome OpenClaw Agents** 是一个**社区驱动的 AI Agent 模板仓库**，提供 162 个生产就绪的 Agent 配置，覆盖 19 个行业分类。其核心创新是定义了一套 **"Agent 操作系统"文件规范**（SOUL.md / AGENTS.md / HEARTBEAT.md / WORKING.md），让任何人通过纯 Markdown 配置就能创建一个有身份、有规则、有启动检查、有状态管理的 AI Agent。

**它不是竞品，是上游生态——Agent 身份配置的"素材库"和规范参考。**

---

## 二、核心架构拆解

### 2.1 Agent OS 文件系统（核心创新）

```
agents/[category]/[agent-name]/
├── SOUL.md          ← 身份与人格 (必须)
├── README.md        ← 描述与用例 (必须)
├── AGENTS.md        ← 运行规则与指令 (可选)
├── HEARTBEAT.md     ← 唤醒检查清单 (可选)
└── WORKING.md       ← 当前任务状态 (可选)
```

| 文件 | 职责 | 与我们的对应物 |
|------|------|--------------|
| **SOUL.md** | Agent 身份定义：角色、人格、职责、行为准则、沟通风格、示例对话 | `role-card.json` + `prompt-kit/` |
| **AGENTS.md** | 运行规则：工作空间规范、通信协议、工具权限、规则约束 | 散落在 `dragon_senate.py` / `lobster_runner.py` |
| **HEARTBEAT.md** | 唤醒检查清单：启动时检查任务、通知、被阻塞项 | ❌ **我们完全没有** |
| **WORKING.md** | 当前状态：活跃任务、上下文、下一步 | 类似 Clawith 的 `focus.json` / `state.json` |

### 2.2 提交层级系统

| 层级 | 包含文件 | 徽章 |
|------|---------|------|
| Basic | SOUL.md + README.md | Community Agent |
| Standard | + AGENTS.md | Production Agent |
| Full | + HEARTBEAT.md + WORKING.md | **Full Agent OS** |

### 2.3 运行时实现

`quickstart/bot.js` 展示了最简运行时：

```javascript
// SOUL.md 直接作为 system prompt 注入
const soulMd = fs.readFileSync("./SOUL.md", "utf-8");
// 每个 chat 维护独立对话历史（最近 20 条）
const response = await anthropic.messages.create({
  system: soulMd,
  messages: history,
});
```

**关键特点**：
- SOUL.md = system prompt（身份即配置）
- 每 chat 独立对话历史（20 条窗口）
- Telegram 作为默认渠道
- 一键 Docker 部署

### 2.4 19 个行业分类

```
business / creative / data / development / devops / ecommerce / education
finance / freelance / healthcare / hr / legal / marketing / personal
productivity / real-estate / saas / security / voice
```

### 2.5 营销类 Agent 深度分析（24 个，与我们最相关）

| Agent | 对应龙虾 | 差异分析 |
|-------|---------|---------|
| **competitor-watch** (Scout) | 触须虾 | 它有详细的**报告格式规范**（周报/月报/季度），我们触须虾缺少标准输出格式 |
| **echo** (The Writer) | 吐墨虾 | 它按**平台分别定义内容风格**（Blog/Twitter/Email/LinkedIn），我们吐墨虾的平台适配规则未结构化 |
| **multi-account-social** | 点兵虾 | 它有**品牌声音隔离**规范（不同账号不同人格），我们多账号管理还在规划 |
| **cold-outreach** | 回访虾 | 它有**冷邮件序列**模板和跟进节奏 |
| **ab-test-analyzer** | 反馈虾 | 它有**A/B 测试假设-变量-结果**结构 |
| **brand-monitor** | 触须虾 | 品牌舆情监控 |
| **content-repurposer** | 吐墨虾+幻影虾 | **一次创作，多平台改编**的结构化流程 |
| **influencer-finder** | 触须虾 | 达人筛选和匹配 |
| **seo-writer** | 吐墨虾 | SEO 优化写作规范 |
| **social-media** | 回声虾 | 社媒互动管理 |
| **tiktok-repurposer** | 幻影虾 | TikTok 内容二次创作 |
| **ugc-video** | 幻影虾 | UGC 视频脚本 |
| **x-twitter-growth** | 回声虾+脑虫虾 | Twitter/X 增长策略 |
| **youtube-seo** | 幻影虾+吐墨虾 | YouTube SEO 优化 |
| **linkedin-content** | 吐墨虾 | LinkedIn 内容创作 |
| **email-sequence** | 回访虾 | 邮件序列编排 |
| **geo-agent** | 触须虾 | 地理区域数据分析 |
| **hackernews-agent** | 触须虾 | HackerNews 技术社区监控 |
| **newsletter** | 吐墨虾 | 通讯编写 |
| **news-curator** | 触须虾 | 新闻筛选策展 |
| **reddit-scout** | 触须虾 | Reddit 社区监控 |
| **telemarketer** | 回访虾 | 电话营销脚本 |
| **localization** | 吐墨虾 | 多语言本地化 |
| **book-writer** | 吐墨虾 | 长篇内容写作 |

---

## 三、对比分析：我们 vs Awesome Agents

### 3.1 整体对比

| 维度 | Awesome OpenClaw Agents | 我们（龙虾元老院） | 结论 |
|------|------------------------|------------------|------|
| **定位** | 社区 Agent 模板市场 | 商业 AI 增长操作系统 | 互补：他们做"模板"，我们做"引擎" |
| **Agent 深度** | 单 Agent，角色浅，无协作 | 9 龙虾深度专业化 + Commander 协调 | 我们更强 |
| **身份定义** | SOUL.md（Markdown，结构清晰） | role-card.json（JSON，程序化但人格弱） | **他们更好** |
| **运行规则** | AGENTS.md（显式、可读） | 散落在代码中 | **他们更规范** |
| **启动检查** | HEARTBEAT.md | ❌ 没有 | **重大缺失** |
| **状态管理** | WORKING.md | ❌ 没有（Clawith 的 focus.json 也指出了） | **重大缺失** |
| **执行能力** | ❌ 无（纯 prompt 注入） | BBP + 提线木偶 + 边缘自动化 | 我们独有 |
| **协作能力** | ❌ 无多 Agent 协作 | Commander + 9 龙虾编排 | 我们独有 |
| **部署体验** | Docker 一键部署 + crewclaw.com 一键部署 | 多文件手动配置 | 他们更好 |
| **社区生态** | 162 模板 + PR 提交 + 徽章系统 | 闭源团队开发 | 可借鉴 |
| **行业覆盖** | 19 个行业 | 聚焦本地生活/服务业 | 我们垂直更深 |

### 3.2 关键差距分析

#### ❌ 差距 1: 缺少 HEARTBEAT.md — 龙虾不知道"醒来干什么"

Awesome Agents 的 HEARTBEAT.md 定义了 Agent 每次唤醒时的检查清单：

```markdown
## On Wake
- [ ] Read WORKING.md for current task
- [ ] Check for @mentions and notifications
- [ ] Review assigned tasks

## Periodic
- [ ] Scan activity feed for relevant updates
- [ ] Check if blocked tasks can be unblocked
- [ ] Update daily notes in memory/

## Stand Down
- If no tasks and no mentions, reply HEARTBEAT_OK
```

**对我们的启发**：每只龙虾应该有一个 `heartbeat.md`（或 `heartbeat.json`），定义：
- 唤醒时必须检查什么（新事件？新线索？新评论？）
- 周期性巡检什么（阈值告警？KPI 异常？）
- 没有任务时的行为（待机？主动巡逻？自我学习？）

这与 **Clawith 的 Aware 触发引擎** 和 **CODEX-MC-01 心跳生命周期** 形成三方印证——龙虾需要自主唤醒能力。

#### ❌ 差距 2: 缺少 WORKING.md — 龙虾不知道"自己在干什么"

WORKING.md 是 Agent 的运行时状态文件：

```markdown
## Current Task
Processing customer onboarding for Acme Corp.

## Context
- Customer signed up 2 hours ago
- Waiting for API key verification

## Next Steps
1. Verify API key
2. Send welcome email sequence
3. Schedule 7-day check-in
```

**对我们的启发**：每只龙虾应该有运行时状态文件，记录：
- 当前正在处理的任务
- 上下文（来自哪个客户/租户/渠道）
- 下一步动作
- 阻塞项

这与 Clawith 的 `focus.json` + `state.json` 再次印证。

#### ❌ 差距 3: SOUL.md 的身份定义比我们的 role-card.json 更丰富

对比 `competitor-watch/SOUL.md` vs 我们触须虾的 `role-card.json`：

| 维度 | SOUL.md (competitor-watch) | role-card.json (触须虾) |
|------|--------------------------|----------------------|
| 人格描述 | "Observant, analytical, strategic" | ❌ 缺少 |
| 沟通风格 | "Factual, concise, actionable insights" | ❌ 缺少 |
| Do/Don't 行为准则 | ✅ 5 条 Do + 5 条 Don't | ❌ 缺少（只有 forbidden_actions） |
| 沟通格式 | 按消息类型定义（Alert/Report/Analysis/Recommendation） | ❌ 缺少 |
| 示例对话 | ✅ 3 个完整 Example Interactions | ❌ 缺少 |
| 集成说明 | ✅ MCP/Twitter API/Notion/Telegram | ❌ 缺少 |

**对我们的启发**：`role-card.json` 需要大幅扩展，或者引入并行的 `SOUL.md` 文件。

#### ❌ 差距 4: AGENTS.md 的运行规则比我们更显式

AGENTS.md 明确定义了：
- **工作空间规范**：文件读写范围、记忆存储位置、日志格式
- **通信协议**：@mentions、任务线程、消息简洁性要求
- **工具权限**：文件系统、Shell、Web 浏览
- **核心规则**：启动必查 WORKING.md、完成任务必更新状态

我们的龙虾运行规则散落在 `dragon_senate.py`、`lobster_runner.py`、`base_lobster.py` 等多个文件中，没有统一的、可读的运行规则文档。

#### ✅ 优势: 我们独有的能力

| 我们有，他们没有 | 说明 |
|-----------------|------|
| **多 Agent 协作编排** | 他们是单 Agent 模板，我们有 Commander + 9 龙虾动态编排 |
| **边缘自动化执行** | 他们只有 prompt 注入，我们有 BBP + 提线木偶 + WSS |
| **深度治理体系** | 审批门、审计日志、零信任安全、女巫检测 |
| **知识包系统** | 每虾 10-15 个专业知识包，RAG 召回 |
| **策略张量路由** | policy-router-service 动态调整策略参数 |
| **线索评分引擎** | xai-scorer 反事实 XAI 解释 |

---

## 四、最高价值借鉴点

### 🔴 P0 借鉴（立即可做）

#### 1. 引入 HEARTBEAT 机制（对齐 Clawith Aware + CODEX-MC-01）

为每只龙虾创建 `heartbeat.json`，定义唤醒检查清单：

```json
{
  "agent_id": "radar",
  "on_wake": [
    "check_new_events(type=['competitor_event', 'metrics_event'])",
    "check_pending_tasks()",
    "check_alerts(threshold_breached=true)"
  ],
  "periodic": [
    {"interval": "30m", "action": "scan_competitor_feeds()"},
    {"interval": "1h", "action": "check_trending_topics()"},
    {"interval": "6h", "action": "generate_signal_brief()"}
  ],
  "stand_down": {
    "condition": "no_tasks AND no_events AND no_alerts",
    "action": "HEARTBEAT_OK",
    "max_idle_minutes": 60
  }
}
```

#### 2. 引入 WORKING 状态文件（对齐 Clawith focus.json）

为每只龙虾维护运行时状态：

```json
{
  "agent_id": "echoer",
  "current_task": {
    "task_id": "task_20260331_001",
    "description": "处理品牌A抖音账号的15条新评论",
    "started_at": "2026-03-31T07:00:00Z",
    "progress": "8/15 已回复"
  },
  "context": {
    "tenant_id": "tenant_abc",
    "channel": "douyin",
    "account": "brand_a_official"
  },
  "next_steps": [
    "完成剩余 7 条评论回复",
    "检查是否有高意向评论需转铁网虾",
    "更新评论互动率统计"
  ],
  "blocked_by": []
}
```

#### 3. 扩展 role-card.json — 增加 SOUL.md 风格的身份维度

在现有 role-card.json 基础上增加：

```json
{
  "personality": "观察力强、分析型、战略思维",
  "communication_style": "事实优先、简洁、可执行洞察",
  "behavioral_guidelines": {
    "do": [
      "报告事实而非假设",
      "每个主张必须有来源",
      "关注可执行洞察",
      "客观对比优缺点",
      "追踪长期趋势"
    ],
    "dont": [
      "轻视竞品或过度自信",
      "盲目复制竞品策略",
      "报告每一个小变化（过滤重要性）",
      "假设竞品收入",
      "使用竞品监控做不道德的事"
    ]
  },
  "output_formats": {
    "alert": "一行：什么变了 + 为什么重要",
    "report": "结构化对比表格",
    "analysis": "数据先行，解读其次",
    "recommendation": "具体、可测试的行动"
  },
  "example_interactions": [
    {
      "user": "竞品动态更新",
      "agent": "本周竞品周报：\n1. 竞品A 上线免费版...\n2. 竞品B 涨价至..."
    }
  ]
}
```

### 🟡 P1 借鉴（架构强化期）

#### 4. 引入 AGENTS.md 风格的运行规则文档

为每只龙虾创建独立的运行规则文档（可以是 JSON 或 Markdown），统一定义：
- 工作空间范围（可读写哪些数据）
- 通信协议（如何与其他龙虾交互、如何上报）
- 工具权限（可以调用哪些 MCP 工具/API）
- 硬性规则（启动必查、完成必更新、禁止越权）

#### 5. 借鉴 multi-account-social 的品牌声音隔离

`multi-account-social` Agent 的核心设计：
- 每个管理账号有独立的 **Brand Voice Profile**（语气、人格、禁忌）
- **不同品牌间声音不交叉**（no voice bleed）
- 统一周运营时间表（周一排期 → 周二至五互动 → 周六互动冲刺 → 周日报告）
- 每账号至少保持 20+ 预批准内容作为缓冲

**对我们的启发**：
- 回声虾/吐墨虾需要支持 **per-account 品牌声音配置**
- 点兵虾需要支持 **跨账号内容不重复**的检查
- 需要 **内容缓冲池**概念（预生成 → 审批 → 定时发布）

#### 6. 借鉴 competitor-watch 的报告格式规范

Scout Agent 定义了 4 种标准报告格式：
- **Alert**（一行 + 影响 + 行动）
- **Weekly Digest**（结构化变化清单）
- **Pricing Comparison**（对比表格）
- **Trend Analysis**（趋势 + 建议）

**对我们的启发**：
- 每只龙虾的工件（Artifact）应该有 **多种输出格式模板**
- 报告类工件需要 `format: "alert" | "digest" | "comparison" | "analysis"` 参数
- 格式模板应该在 `role-card.json` 的 `output_formats` 中定义

### 🟢 P2 借鉴（生态建设）

#### 7. 社区 Agent 模板生态

Awesome Agents 的生态模式值得学习：
- **提交层级**（Basic → Standard → Full）激励社区贡献
- **agents.json 注册表**统一索引
- **crewclaw.com 一键部署**降低使用门槛
- **Issue 模板**（agent-request / agent-submission / bug-report）

**对我们的启发**：
- 未来可以开放**龙虾模板市场**，让客户提交行业特定的 SOUL + 知识包配置
- 行业预设模板（美容/餐饮/教育/医美/健身...）可以参考此模式发布

#### 8. 内容改编（Content Repurposer）理念

`content-repurposer` Agent 的核心理念：**一次创作，多平台改编**。

**对我们的启发**：
- 吐墨虾 + 幻影虾应该支持 **一个内容种子 → N 个平台版本** 的自动改编流
- 点兵虾的分发应该在改编完成后自动触发
- 需要知道每个平台的格式限制（字数/尺寸/标签规则）

---

## 五、与现有 Codex 任务的关联

| Awesome Agents 借鉴点 | 已有 Codex 任务 | 关联说明 |
|----------------------|---------------|---------|
| HEARTBEAT 机制 | CODEX-MC-01 (心跳生命周期) | 直接增强：从基础心跳升级为含唤醒检查清单的完整 HEARTBEAT |
| WORKING 状态文件 | CODEX-CW-04 (Soul 持久化) | 直接增强：在 state.json 基础上增加 WORKING 维度 |
| 扩展 role-card.json | CODEX-OCM-03 (role-card 安全增强) | 合并：安全增强 + SOUL 风格身份增强 |
| 品牌声音隔离 | CODEX-DCIM-02 (多账号管理) | 直接增强：多账号不仅是 config，还需要 per-account 声音隔离 |
| 报告格式规范 | CODEX-KP-01 (知识包扩展) | 间接关联：知识包 seed_goal 应包含输出格式规范 |
| 运行规则文档 | CODEX-CW-02 (Autonomy Policy) | 增强：自主权策略 + 运行规则 = 完整 AGENTS 配置 |
| 内容改编流 | CODEX-CAP-01 (能力扩展) | 已包含：吐墨虾 SKL-INK-05 多平台格式适配 |

---

## 六、建议 Codex 任务

### CODEX-AA-01: 龙虾 SOUL 配置体系升级

**优先级**: P0 | **算力**: 中

将每只龙虾的身份配置从单一的 `role-card.json` 升级为完整的 **Agent OS 文件体系**：

```
packages/lobsters/lobster-radar/
├── role-card.json       ← 现有（保留，程序化读取）
├── SOUL.md              ← 新增：丰富的身份、人格、沟通风格、示例对话
├── AGENTS.md            ← 新增：运行规则、工具权限、通信协议
├── HEARTBEAT.json       ← 新增：唤醒检查清单、周期巡检、待机规则
└── WORKING.json         ← 新增：运行时状态（由 LobsterRunner 自动维护）
```

**关键**: 
- `SOUL.md` 在运行时被注入为 system prompt 的一部分（与 Awesome Agents 一致）
- `HEARTBEAT.json` 被 trigger_daemon（Clawith 借鉴）读取
- `WORKING.json` 被 LobsterRunner 在任务开始/结束时自动更新
- 这是 CODEX-MC-01（心跳）、CODEX-CW-04（持久化）、CODEX-OCM-03（role-card 增强）的**统一升级版**

### CODEX-AA-02: 输出格式模板系统

**优先级**: P1 | **算力**: 低

为每只龙虾定义标准输出格式模板，参考 competitor-watch 的 4 种报告格式：

```json
{
  "agent_id": "radar",
  "output_templates": {
    "alert": "🔔 {what_changed} — 影响: {impact} — 建议: {action}",
    "weekly_digest": "## 本周竞品动态\n| 竞品 | 变化 | 影响 | 行动 |\n...",
    "comparison": "## 竞品对比\n| 维度 | 我们 | 竞品A | 竞品B |\n...",
    "trend_analysis": "## 趋势分析\n### 关键发现\n...\n### 建议\n..."
  }
}
```

---

## 七、核心结论

### 一句话总结

> **Awesome OpenClaw Agents 最大贡献不是 162 个模板本身，而是它定义的 "Agent OS 文件系统" 规范（SOUL / AGENTS / HEARTBEAT / WORKING）——这正好填补了我们龙虾系统在 "身份丰富度"、"运行规则显式化"、"自主唤醒检查" 和 "运行时状态管理" 四个维度的缺失。**

### 行动优先级

| 排名 | 借鉴点 | 投入 | 价值 | 路径 |
|------|--------|------|------|------|
| **1** | HEARTBEAT 机制 | 低 | 🔴 高 | 每虾增加 `HEARTBEAT.json`，trigger_daemon 消费 |
| **2** | SOUL.md 身份增强 | 中 | 🔴 高 | 每虾增加 `SOUL.md`，LobsterRunner 注入 system prompt |
| **3** | WORKING 状态管理 | 中 | 🔴 高 | LobsterRunner 自动维护 `WORKING.json` |
| **4** | AGENTS.md 运行规则 | 低 | 🟡 中 | 每虾增加运行规则文档 |
| **5** | 输出格式模板 | 低 | 🟡 中 | 在 role-card 中增加 output_templates |
| **6** | 品牌声音隔离 | 中 | 🟡 中 | 多账号管理增加 per-account voice config |
| **7** | 社区模板生态 | 高 | 🟢 远期 | 开放龙虾行业模板提交 |

### 三方印证汇总

以下三个项目独立指向了同一个结论——**Agent 需要从"被动工具"升级为"有身份、有状态、能自主唤醒的数字员工"**：

| 维度 | Clawith | Awesome Agents | CODEX-MC-01 | 我们的差距 |
|------|---------|---------------|-------------|-----------|
| **自主唤醒** | Aware 触发引擎 + Trigger | HEARTBEAT.md 检查清单 | Agent 心跳协议 | ❌ 完全缺失 |
| **身份人格** | soul.md + memory.md | SOUL.md (丰富) | — | 🟡 role-card 太薄 |
| **运行规则** | L1/L2/L3 autonomy policy | AGENTS.md | — | 🟡 散落在代码中 |
| **状态管理** | focus.json + state.json | WORKING.md | — | ❌ 完全缺失 |
| **多 Agent 协作** | A2A + Participant | ❌ 无 | — | ✅ Commander 编排 |
| **执行能力** | 简单 Poll | ❌ 无 | — | ✅ BBP + 提线木偶 |
