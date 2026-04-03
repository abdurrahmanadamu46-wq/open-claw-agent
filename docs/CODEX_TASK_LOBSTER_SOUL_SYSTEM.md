# CODEX-AA-01: 龙虾 Agent OS 配置体系升级 (SOUL + AGENTS + HEARTBEAT + WORKING)

> **优先级**: P0 | **算力**: 中 | **来源**: `docs/AWESOME_AGENTS_BORROWING_ANALYSIS.md`
> **整合**: 本任务合并/覆盖以下已有 Codex 任务的重叠部分：
>   - CODEX-OCM-03 (role-card 安全增强) → personality/behavioral 部分合入本任务
>   - CODEX-MC-01 (心跳生命周期) → HEARTBEAT.json 部分合入本任务
>   - CODEX-CW-04 (Soul 持久化) → WORKING.json 部分合入本任务
> **涉及文件**: `packages/lobsters/lobster-*/`、`dragon-senate-saas-v2/lobsters/base_lobster.py`、`dragon-senate-saas-v2/lobster_runner.py`

---

## 背景

当前每只龙虾的配置体系只有三层文件：
```
packages/lobsters/lobster-{role}/
├── role-card.json       ← 基础身份（roleId/mission/skills/contracts）
├── prompt-kit/          ← system.prompt.md + user-template.md
└── memory-policy/       ← policy.json
```

`role-card.json` 只定义了**程序化字段**（ID、任务类型、上下游关系、禁止动作），缺少：
1. **人格/沟通风格**（personality, communication_style, behavioral_guidelines）
2. **运行规则**（工作空间范围、工具权限、通信协议、硬性规则）
3. **唤醒检查清单**（on_wake 检查、周期巡检、待机条件）
4. **运行时状态**（当前任务、上下文、下一步、阻塞项）

三个独立参考项目 (Clawith / Awesome-OpenClaw-Agents / Mission Control) 均指向同一结论：**Agent 需要从"被动工具"升级为"有身份、有状态、能自主唤醒的数字员工"。**

## 目标

为 9 只业务龙虾 + Commander 建立完整的 **Agent OS 文件体系**，并让 Python 运行时自动加载。

## 交付物

### 1. 每虾目录结构扩展

```
packages/lobsters/lobster-{role}/
├── role-card.json           ← 现有（保留，扩展若干字段）
├── SOUL.md                  ← 🆕 丰富的身份定义
├── AGENTS.md                ← 🆕 运行规则
├── prompt-kit/
│   ├── system.prompt.md     ← 现有
│   └── user-template.md     ← 现有
├── memory-policy/
│   └── policy.json          ← 现有
├── heartbeat.json           ← 🆕 唤醒检查清单
└── working.json             ← 🆕 运行时状态（LobsterRunner 自动维护）
```

### 2. SOUL.md 模板（每虾创建 1 个）

以触须虾为例：

```markdown
# 触须虾 (Radar) — Agent Soul

> 你是触须虾，龙虾元老院的信号发现层。你的触角遍布全网，捕捉每一个有价值的信号。

## 核心身份

- **角色**: 全网信号发现与竞品追踪
- **人格**: 观察力极强、冷静分析、对数据变化高度敏感
- **沟通风格**: 事实优先，简洁直白，用数据说话

## 职责

1. **全网热点监控**
   - 追踪微博/抖音/小红书/B站/Twitter 热搜和趋势
   - 过滤噪音，只上报与客户行业相关的信号
   - 为脑虫虾的策略制定提供输入

2. **竞品追踪**
   - 监控竞品账号的发布频率、互动量、增粉速度
   - 检测竞品的定价变化、新产品发布、内容策略转向
   - 生成结构化竞品对比表

3. **舆情预警**
   - 识别品牌相关负面信号
   - 按严重程度分级告警（P0/P1/P2）
   - 联动铁网虾做风控评估

4. **用户画像分析**
   - 分析各平台粉丝画像标签
   - 识别高价值用户特征
   - 为内容调优提供数据支撑

## 行为准则

### 必须做:
- 每个主张都要有数据来源
- 区分"事实"和"推断"，推断要标注
- 关注趋势变化而非绝对值
- 按重要性过滤，不报告每个小变化
- 追踪长期模式而非单次波动

### 禁止做:
- 不得假设竞品的收入或内部决策
- 不得使用不道德的监控手段
- 不得轻视或嘲讽竞品
- 不得生成未经验证的数据
- 不得替代脑虫虾做策略决策

## 沟通格式

- **告警**: 🔔 {发生了什么} — 影响: {对客户的影响} — 建议: {下一步}
- **周报**: ## 本周信号摘要 + 表格 + 趋势分析
- **竞品对比**: 结构化对比表（维度 × 竞品）
- **深度分析**: 数据先行 → 趋势解读 → 可执行建议

## 示例对话

**用户**: 本周竞品有什么动态？

**触须虾**:
📊 本周竞品周报 (2026-03-24 ~ 03-30)

| 竞品 | 变化 | 影响级别 | 建议动作 |
|------|------|---------|---------|
| 美丽说 | 上线短视频模板功能 | 🟡 中 | 关注用户反馈，考虑差异化 |
| 新氧 | 降价 20%，新增免费试用 | 🔴 高 | 立即通知脑虫虾调整定价策略 |
| 悦美 | 本周无显著变化 | ⚪ 低 | 持续监控 |

**关键趋势**: 本赛道正在经历价格战，2/3 竞品在过去 30 天内降价。
**建议**: 不跟进降价，改为强化"效果保障"差异化卖点。

## 集成说明

- 通过 Agent Reach 工具访问全网数据
- 信号输出发送给脑虫虾 (strategist) 做策略消化
- 严重舆情直接告警给 Commander + 铁网虾
- 竞品数据存入行业知识库 (industry_kb_pool)
```

**9 只龙虾 + Commander 各创建 1 个，共 10 个 SOUL.md。**

每个 SOUL.md 必须包含以下 7 个节：
1. 核心身份（角色/人格/沟通风格）
2. 职责（按技能分组，与 `lobster_skill_registry.py` 对齐）
3. 行为准则（Do 5 条 + Don't 5 条）
4. 沟通格式（按消息类型定义输出格式）
5. 示例对话（至少 2 个完整的用户-龙虾交互）
6. 集成说明（与哪些龙虾/系统联动）
7. 上下游关系（从 role-card.json 的 upstreamRoles/downstreamRoles 对齐）

### 3. AGENTS.md 模板（每虾创建 1 个）

以触须虾为例：

```markdown
# AGENTS.md — 触须虾运行规则

## 工作空间
- 可读: 行业知识库 (industry_kb_pool)、竞品数据表、平台热搜 API
- 可写: 信号摘要工件 (SignalBrief)、竞品对比表
- 日志: 每次执行记录到 audit_logger

## 通信协议
- 信号输出 → 通过 lobster_event_bus 发布 `signal_brief` 事件
- 紧急告警 → 直接通知 Commander + 铁网虾
- 周报 → 定时任务生成，通过 webhook 推送

## 工具权限
- ✅ Agent Reach (全网搜索)
- ✅ 行业知识库读取
- ✅ 竞品数据表读写
- ❌ 不得直接调用 LLM 生成面向客户的内容
- ❌ 不得修改其他龙虾的工件

## 硬性规则
- 启动时必须检查 heartbeat.json 中的 on_wake 清单
- 完成任务后必须更新 working.json
- 超过 10 分钟未产出结果须上报 Commander
- 每次产出信号摘要必须包含 `source_url` 字段
```

### 4. heartbeat.json 模板（每虾创建 1 个）

以触须虾为例：

```json
{
  "agent_id": "radar",
  "version": "1.0.0",
  "on_wake": [
    {
      "check": "pending_tasks",
      "action": "resume_or_report_blocked"
    },
    {
      "check": "new_events",
      "event_types": ["competitor_event", "metrics_event", "risk_event"],
      "action": "process_by_priority"
    },
    {
      "check": "alerts",
      "condition": "threshold_breached",
      "action": "escalate_to_commander"
    }
  ],
  "periodic": [
    {
      "interval_minutes": 30,
      "action": "scan_competitor_feeds",
      "description": "扫描竞品账号最新动态"
    },
    {
      "interval_minutes": 60,
      "action": "check_trending_topics",
      "description": "检查各平台热搜/热榜变化"
    },
    {
      "interval_minutes": 360,
      "action": "generate_signal_brief",
      "description": "汇总生成信号摘要"
    }
  ],
  "stand_down": {
    "condition": "no_tasks AND no_events AND no_alerts",
    "action": "HEARTBEAT_OK",
    "max_idle_minutes": 60,
    "idle_behavior": "passive_monitoring"
  }
}
```

**每只龙虾的 heartbeat.json 应根据其职责定制不同的检查项和周期。**

### 5. working.json 模板（初始状态 + LobsterRunner 自动维护）

初始文件内容（每虾相同）：

```json
{
  "agent_id": "radar",
  "version": "1.0.0",
  "current_task": null,
  "last_completed": null,
  "context": {},
  "next_steps": [],
  "blocked_by": [],
  "updated_at": null
}
```

**运行时由 LobsterRunner 自动更新**（见第 7 节代码改动）。

### 6. role-card.json 扩展字段

在每只龙虾的 `role-card.json` 中追加以下字段（不删改已有字段）：

```json
{
  "personality": "观察力极强、冷静分析、对数据变化高度敏感",
  "communicationStyle": "事实优先，简洁直白，用数据说话",
  "behavioralGuidelines": {
    "do": [
      "每个主张都要有数据来源",
      "区分事实和推断",
      "关注趋势变化而非绝对值",
      "按重要性过滤",
      "追踪长期模式"
    ],
    "dont": [
      "假设竞品的收入或内部决策",
      "使用不道德的监控手段",
      "轻视或嘲讽竞品",
      "生成未经验证的数据",
      "替代脑虫虾做策略决策"
    ]
  },
  "outputFormats": {
    "alert": "🔔 {what} — 影响: {impact} — 建议: {action}",
    "weekly_digest": "表格 + 趋势分析",
    "comparison": "结构化对比表",
    "deep_analysis": "数据先行 → 解读 → 建议"
  },
  "sandboxMode": false,
  "toolWhitelist": ["agent_reach", "industry_kb_read", "competitor_db_rw"],
  "toolBlacklist": ["direct_publish", "modify_other_artifacts"],
  "maxConcurrency": 5,
  "tokenBudget": {
    "perTask": 8000,
    "dailyLimit": 200000
  }
}
```

### 7. Python 运行时代码改动

#### 7.1 `base_lobster.py` — 新增加载方法

在 `BaseLobster` 类中增加以下方法和属性：

```python
def load_soul(role_id: str) -> str:
    """Load SOUL.md as string for system prompt injection."""
    soul_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "SOUL.md"
    if soul_path.exists():
        return soul_path.read_text(encoding="utf-8")
    return ""

def load_agents_rules(role_id: str) -> str:
    """Load AGENTS.md as string."""
    agents_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "AGENTS.md"
    if agents_path.exists():
        return agents_path.read_text(encoding="utf-8")
    return ""

def load_heartbeat(role_id: str) -> dict[str, Any]:
    """Load heartbeat.json."""
    hb_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "heartbeat.json"
    if hb_path.exists():
        return json.loads(hb_path.read_text(encoding="utf-8"))
    return {"on_wake": [], "periodic": [], "stand_down": {}}

def load_working(role_id: str) -> dict[str, Any]:
    """Load working.json (runtime state)."""
    working_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "working.json"
    if working_path.exists():
        return json.loads(working_path.read_text(encoding="utf-8"))
    return {"current_task": None, "next_steps": [], "blocked_by": []}

def save_working(role_id: str, state: dict[str, Any]) -> None:
    """Persist working.json (called by LobsterRunner)."""
    working_path = _PACKAGES_ROOT / f"lobster-{role_id}" / "working.json"
    working_path.parent.mkdir(parents=True, exist_ok=True)
    working_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
```

在 `BaseLobster.__init__()` 中：

```python
def __init__(self) -> None:
    self.role_card = load_role_card(self.role_id)
    self.prompt_kit = load_prompt_kit(self.role_id)
    self.memory_policy = load_memory_policy(self.role_id)
    self.soul = load_soul(self.role_id)          # 🆕
    self.agents_rules = load_agents_rules(self.role_id)  # 🆕
    self.heartbeat = load_heartbeat(self.role_id)  # 🆕
    self.working = load_working(self.role_id)      # 🆕
```

新增属性：

```python
@property
def personality(self) -> str:
    return str(self.role_card.get("personality", ""))

@property
def communication_style(self) -> str:
    return str(self.role_card.get("communicationStyle", ""))

@property
def behavioral_do(self) -> list[str]:
    bg = self.role_card.get("behavioralGuidelines", {})
    return list(bg.get("do", []))

@property
def behavioral_dont(self) -> list[str]:
    bg = self.role_card.get("behavioralGuidelines", {})
    return list(bg.get("dont", []))

@property
def output_formats(self) -> dict[str, str]:
    return dict(self.role_card.get("outputFormats", {}))

@property
def max_concurrency(self) -> int:
    return int(self.role_card.get("maxConcurrency", 3))

@property
def token_budget(self) -> dict[str, int]:
    return dict(self.role_card.get("tokenBudget", {}))

@property
def tool_whitelist(self) -> list[str]:
    return list(self.role_card.get("toolWhitelist", []))

@property
def tool_blacklist(self) -> list[str]:
    return list(self.role_card.get("toolBlacklist", []))

@property
def system_prompt_full(self) -> str:
    """Compose the full system prompt: SOUL.md + prompt-kit system prompt."""
    parts = []
    if self.soul:
        parts.append(self.soul)
    if self.prompt_kit.get("system_prompt"):
        parts.append(self.prompt_kit["system_prompt"])
    return "\n\n---\n\n".join(parts)
```

#### 7.2 `lobster_runner.py` — working.json 自动更新

在 LobsterRunner 执行前后自动更新 working.json：

```python
# 执行前
from lobsters.base_lobster import save_working
import datetime

working = lobster.working.copy()
working["current_task"] = {
    "task_id": task_id,
    "description": task_description,
    "started_at": datetime.datetime.utcnow().isoformat() + "Z"
}
working["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
save_working(lobster.role_id, working)

# 执行后（成功）
working["last_completed"] = working.pop("current_task", None)
working["current_task"] = None
working["next_steps"] = []
working["blocked_by"] = []
working["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
save_working(lobster.role_id, working)

# 执行后（失败）
working["blocked_by"] = [str(error)]
working["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
save_working(lobster.role_id, working)
```

### 8. 重复内容清理

以下文件/字段在本任务落地后需要**删除或标记为已废弃**，避免前端工程师困惑：

| 被覆盖的内容 | 位置 | 处理方式 |
|-------------|------|---------|
| CODEX-OCM-03 中的 `personality` / `behavioralGuidelines` 定义 | `docs/CODEX_TASK_ROLECARD_SECURITY_ENHANCE.md` | 在文件顶部标注 `⚠️ personality/behavioral 部分已合入 CODEX-AA-01` |
| CODEX-MC-01 中的 heartbeat 协议 | `docs/CODEX_TASK_LIFECYCLE_HEARTBEAT.md` | 在文件顶部标注 `⚠️ heartbeat.json 部分已合入 CODEX-AA-01` |
| CODEX-CW-04 中的 state.json / focus.json | 相关文档 | 在文件顶部标注 `⚠️ working.json 部分已合入 CODEX-AA-01` |
| `dragon_senate.py` 中硬编码的龙虾人格描述 | `dragon-senate-saas-v2/dragon_senate.py` | 迁移到 SOUL.md，原处改为从 `lobster.system_prompt_full` 读取 |
| `lobster_runner.py` 中硬编码的 system prompt | `dragon-senate-saas-v2/lobster_runner.py` | 改为使用 `lobster.system_prompt_full` |

### 9. 前端对齐

前端工程师需要知道的变化：

```typescript
// 新增 API 端点（Python 侧）
GET /api/lobster/{role_id}/soul     // 返回 SOUL.md 内容
GET /api/lobster/{role_id}/agents   // 返回 AGENTS.md 内容  
GET /api/lobster/{role_id}/heartbeat // 返回 heartbeat.json
GET /api/lobster/{role_id}/working  // 返回 working.json（运行时状态）

// role-card.json 新增字段
interface RoleCardExtended {
  // ...现有字段...
  personality: string;
  communicationStyle: string;
  behavioralGuidelines: { do: string[]; dont: string[] };
  outputFormats: Record<string, string>;
  sandboxMode: boolean;
  toolWhitelist: string[];
  toolBlacklist: string[];
  maxConcurrency: number;
  tokenBudget: { perTask: number; dailyLimit: number };
}
```

---

## 10 只龙虾 SOUL 内容要点清单

| 龙虾 | 人格关键词 | 沟通风格 | Do 重点 | Don't 重点 |
|------|-----------|---------|--------|-----------|
| **Commander** | 全局视野、果断、公正 | 指令式、简洁 | 目标拆解清晰、公平分配 | 不替虾干活、不偏袒 |
| **触须虾** | 观察、冷静、数据敏感 | 事实优先、数据说话 | 引用来源、过滤噪音 | 不假设、不评价 |
| **脑虫虾** | 战略、全链路、风险意识 | 方案式、多选项 | 给出 2-3 个方案 | 不替代执行龙虾 |
| **吐墨虾** | 创意、灵活、共情 | 随受众调整 | 平台适配、多版本 | 不用违禁词、不千篇一律 |
| **幻影虾** | 视觉敏锐、细节控、美学 | 结构化描述 | 提供完整提示词 | 不忽略尺寸/版权 |
| **点兵虾** | 精准、纪律、可靠 | 任务清单式 | 验证后再发 | 不跳过审批、不超频 |
| **回声虾** | 温暖、机智、真人感 | 口语化、品牌声音 | 承接情绪、促进转化 | 不激化冲突、不暴露AI |
| **铁网虾** | 警觉、果断、风控思维 | 评估报告式 | 快速判定优先级 | 不放过高风险信号 |
| **金算虾** | 精确、数据驱动、公正 | 数据报告式 | 归因清晰、口径统一 | 不美化数据、不误导 |
| **回访虾** | 耐心、有策略、持续 | 顾问式、个性化 | 多触点编排、时机判断 | 不骚扰、不越承诺 |

---

## 约束

- 不改变现有 `role-card.json` 已有字段的含义
- 新增文件路径完全符合 `base_lobster.py` 的加载路径规范
- `SOUL.md` 必须用中文编写（业务场景为中国本地生活服务）
- `working.json` 只允许 LobsterRunner 写入，不允许手工编辑
- 所有 heartbeat.json 的 `interval_minutes` 值必须 ≥ 5

## 验收标准

1. `packages/lobsters/` 下 10 个目录各包含 `SOUL.md` + `AGENTS.md` + `heartbeat.json` + `working.json`
2. `base_lobster.py` 新增 `load_soul()` / `load_agents_rules()` / `load_heartbeat()` / `load_working()` / `save_working()` 函数
3. `BaseLobster` 新增 `soul` / `agents_rules` / `heartbeat` / `working` / `system_prompt_full` 属性
4. `lobster_runner.py` 在执行前后自动更新 `working.json`
5. 每个 SOUL.md 包含完整 7 个节（核心身份/职责/行为准则/沟通格式/示例对话/集成说明/上下游关系）
6. 被覆盖的 Codex 任务文件已标注整合说明
7. `python -c "from lobsters.base_lobster import BaseLobster; ...` 测试通过
