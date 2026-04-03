# Dragon Senate — 10只龙虾权威编制表

> **本文档是整个项目龙虾定义的唯一权威来源**  
> 所有代码、文档、提示词、前端页面必须对齐此定义  
> 最后更新：2026-04-01  
> 数据来源：`f:/openclaw-agent/PROJECT_CONTROL_CENTER.md` 第二节

---

## 一、完整编制表

| # | canonical_id | 中文名 | 主职责 | 核心工件 | Python 文件 | TS 包路径 |
|---|-------------|--------|--------|---------|------------|---------|
| 0 | **commander** | 元老院总脑 | 编排、仲裁、异常处理、复盘 | MissionPlan | `commander_router.py` + `commander_graph_builder.py` | `packages/lobsters/lobster-commander/` |
| 1 | **radar** | 触须虾 | 信号发现、热点、竞品、舆情 | SignalBrief | `lobsters/radar.py` | `packages/lobsters/lobster-radar/` |
| 2 | **strategist** | 脑虫虾 | 策略规划、排期、预算、实验 | StrategyRoute | `lobsters/strategist.py` | `packages/lobsters/lobster-strategist/` |
| 3 | **inkwriter** | 吐墨虾 | 文案、话术、合规改写 | CopyPack | `lobsters/inkwriter.py` | `packages/lobsters/lobster-inkwriter/` |
| 4 | **visualizer** | 幻影虾 | 分镜、图片、视频、字幕 | StoryboardPack | `lobsters/visualizer.py` | `packages/lobsters/lobster-visualizer/` |
| 5 | **dispatcher** | 点兵虾 | 分发、调度、发布时间窗 | ExecutionPlan | `lobsters/dispatcher.py` | `packages/lobsters/lobster-dispatcher/` |
| 6 | **echoer** | 回声虾 | 评论、私信、互动承接 | EngagementReplyPack | `lobsters/echoer.py` | `packages/lobsters/lobster-echoer/` |
| 7 | **catcher** | 铁网虾 | 线索评分、CRM 入库、去重 | LeadAssessment | `lobsters/catcher.py` | `packages/lobsters/lobster-catcher/` |
| 8 | **abacus** | 金算虾 | 归因、ROI、报告、反馈回写 | ValueScoreCard | `lobsters/abacus.py` | `packages/lobsters/lobster-abacus/` |
| 9 | **followup** | 回访虾 | 多触点跟进、唤醒、成交回写 | FollowUpActionPlan | `lobsters/followup.py` | `packages/lobsters/lobster-followup/` |

---

## 二、协作拓扑

```
用户/SaaS前端
    ↓ 任务意图
commander（元老院总脑）← 编排所有龙虾，异常处理，最终复盘
    │
    ├─→ radar（触须虾）      [发现信号 → SignalBrief]
    │       ↓
    ├─→ strategist（脑虫虾） [制定策略 → StrategyRoute]
    │       ↓
    ├─→ inkwriter（吐墨虾）  [生成文案 → CopyPack]
    │       ↓
    ├─→ visualizer（幻影虾） [生成图文 → StoryboardPack]
    │       ↓
    ├─→ dispatcher（点兵虾） [分发执行 → ExecutionPlan → 边缘节点]
    │       ↓（执行完成后）
    ├─→ echoer（回声虾）     [互动承接 → EngagementReplyPack]
    │       ↓
    ├─→ catcher（铁网虾）    [线索捕获 → LeadAssessment]
    │       ↓
    ├─→ abacus（金算虾）     [效果归因 → ValueScoreCard]
    │       ↓
    └─→ followup（回访虾）   [跟进成交 → FollowUpActionPlan]
```

---

## 三、各龙虾详细定义

### 0. commander — 元老院总脑

| 属性 | 值 |
|------|---|
| **主职责** | 编排整个多虾工作流、仲裁冲突、处理异常、总结复盘 |
| **核心工件** | `MissionPlan`（任务分解计划） |
| **上游** | 用户/SaaS 直接输入 |
| **下游** | 所有9只业务龙虾 |
| **禁止行为** | 替龙虾干具体业务活、直接操作浏览器 |
| **Python** | `commander_router.py`、`commander_graph_builder.py`、`dragon_senate.py` |
| **特殊说明** | 是 DragonState 主图的入口和出口，使用 LangGraph 编排 |

### 1. radar — 触须虾

| 属性 | 值 |
|------|---|
| **主职责** | 信号发现（热点话题、竞品动态、行业舆情） |
| **核心工件** | `SignalBrief`（信号简报） |
| **上游** | commander |
| **下游** | strategist |
| **禁止行为** | 制定策略、输出内容 |
| **Python** | `lobsters/radar.py` |
| **关联** | `research_radar_fetchers.py`、`research_radar_ranker.py`、`research_radar_store.py` |

### 2. strategist — 脑虫虾

| 属性 | 值 |
|------|---|
| **主职责** | 策略规划（内容方向、发布节奏、预算分配、A/B 实验） |
| **核心工件** | `StrategyRoute`（策略路线图） |
| **上游** | radar（SignalBrief） |
| **下游** | inkwriter、visualizer、dispatcher |
| **禁止行为** | 直接生成文案、直接发布内容 |
| **Python** | `lobsters/strategist.py` |

### 3. inkwriter — 吐墨虾

| 属性 | 值 |
|------|---|
| **主职责** | 文案创作（小红书/抖音/快手文案）、话术设计、合规改写 |
| **核心工件** | `CopyPack`（文案包：标题+正文+话题标签+备选版本） |
| **上游** | strategist（StrategyRoute） |
| **下游** | visualizer、dispatcher |
| **禁止行为** | 生成图片、直接发布 |
| **Python** | `lobsters/inkwriter.py` |

### 4. visualizer — 幻影虾

| 属性 | 值 |
|------|---|
| **主职责** | 视觉创作（分镜脚本、图片提示词、视频字幕、封面设计） |
| **核心工件** | `StoryboardPack`（分镜包） |
| **上游** | inkwriter（CopyPack） |
| **下游** | dispatcher |
| **禁止行为** | 直接调用图像 API（通过 comfyui_adapter 委托）、撰写文案 |
| **Python** | `lobsters/visualizer.py` |
| **关联** | `comfyui_adapter.py`、`comfyui_capability_matrix.py` |

### 5. dispatcher — 点兵虾

| 属性 | 值 |
|------|---|
| **主职责** | 分发调度（将内容包分发到边缘节点执行，计算最优发布时间窗） |
| **核心工件** | `ExecutionPlan`（执行计划：账号×内容×时间窗 映射表） |
| **上游** | inkwriter（CopyPack）+ visualizer（StoryboardPack） |
| **下游** | 边缘执行层（edge-runtime） |
| **禁止行为** | 生成内容、直接操作浏览器 |
| **Python** | `lobsters/dispatcher.py` |
| **关联** | `media_post_pipeline.py`、`channel_account_manager.py` |

### 6. echoer — 回声虾

| 属性 | 值 |
|------|---|
| **主职责** | 互动承接（自动回复评论、私信、@提及，维护社区热度） |
| **核心工件** | `EngagementReplyPack`（互动回复包） |
| **上游** | dispatcher（执行完成信号） |
| **下游** | catcher（将高意向互动转线索） |
| **禁止行为** | 直接发帖、生成主动内容 |
| **Python** | `lobsters/echoer.py` |
| **关联** | `clawteam_inbox.py` |

### 7. catcher — 铁网虾

| 属性 | 值 |
|------|---|
| **主职责** | 线索捕获（评分、CRM 入库、去重、意向分级） |
| **核心工件** | `LeadAssessment`（线索评估报告） |
| **上游** | echoer（EngagementReplyPack） |
| **下游** | followup |
| **禁止行为** | 直接联系客户、生成内容 |
| **Python** | `lobsters/catcher.py` |

### 8. abacus — 金算虾

| 属性 | 值 |
|------|---|
| **主职责** | 效果归因（ROI 计算、转化漏斗分析、报告生成、反馈回写策略层） |
| **核心工件** | `ValueScoreCard`（价值评分卡） |
| **上游** | catcher（LeadAssessment）+ 执行数据 |
| **下游** | commander（复盘反馈）、strategist（策略优化） |
| **禁止行为** | 生成内容、联系客户 |
| **Python** | `lobsters/abacus.py` |
| **关联** | `edge_rewards.py`、`finetune_data_export.py` |

### 9. followup — 回访虾

| 属性 | 值 |
|------|---|
| **主职责** | 多触点跟进（唤醒沉默线索、推进成交、成交结果回写） |
| **核心工件** | `FollowUpActionPlan`（跟进行动计划） |
| **上游** | catcher（LeadAssessment） |
| **下游** | abacus（成交数据回写） |
| **禁止行为** | 直接发内容、评分线索 |
| **Python** | `lobsters/followup.py` |
| **关联** | `followup_subagent_store.py` |

---

## 四、核心工件类型定义（TypeScript）

```typescript
// 所有龙虾的核心工件类型（供前端和 TS 设计时使用）

/** commander → 任务分解计划 */
interface MissionPlan {
  mission_id: string;
  user_intent: string;
  steps: Array<{ lobster: string; task: string; depends_on?: string[] }>;
  priority: 'urgent' | 'normal' | 'low';
  created_at: string;
}

/** radar → 信号简报 */
interface SignalBrief {
  signals: Array<{ topic: string; heat_score: number; source: string; summary: string }>;
  competitor_moves: Array<{ brand: string; action: string; risk_level: string }>;
  recommended_angles: string[];
  generated_at: string;
}

/** strategist → 策略路线图 */
interface StrategyRoute {
  content_pillars: string[];
  publishing_rhythm: { platforms: string[]; frequency: string; time_windows: string[] };
  budget_allocation: Record<string, number>;
  experiments: Array<{ name: string; hypothesis: string; kpi: string }>;
}

/** inkwriter → 文案包 */
interface CopyPack {
  platform: string;
  title: string;
  body: string;
  hashtags: string[];
  alternatives: Array<{ title: string; body: string }>;
  compliance_check: 'passed' | 'needs_revision';
}

/** visualizer → 分镜包 */
interface StoryboardPack {
  platform: string;
  cover_prompt: string;
  frames: Array<{ index: number; visual_prompt: string; caption: string; duration_sec?: number }>;
  style_guide: string;
}

/** dispatcher → 执行计划 */
interface ExecutionPlan {
  items: Array<{
    account_id: string;
    platform: string;
    content_ref: string;
    scheduled_at: string;
    edge_node_id?: string;
  }>;
  total_count: number;
}

/** echoer → 互动回复包 */
interface EngagementReplyPack {
  replies: Array<{ comment_id: string; reply_text: string; intent_signal: string }>;
  high_intent_leads: string[];   // comment_id 列表
}

/** catcher → 线索评估报告 */
interface LeadAssessment {
  leads: Array<{
    lead_id: string;
    source_comment_id: string;
    intent_score: number;          // 0-100
    tier: 'hot' | 'warm' | 'cold';
    recommended_action: string;
  }>;
  crm_synced: boolean;
}

/** abacus → 价值评分卡 */
interface ValueScoreCard {
  period: string;
  roi: number;
  conversion_funnel: Record<string, number>;
  top_performing_content: string[];
  strategy_feedback: string[];    // 回写给 strategist
}

/** followup → 跟进行动计划 */
interface FollowUpActionPlan {
  lead_id: string;
  touchpoints: Array<{ channel: string; message: string; send_at: string }>;
  deal_closed: boolean;
  deal_value?: number;
}
```

---

## 五、与旧文档的对照表（废弃名称 → 正确名称）

> 以下旧名称来自早期分析文档，**已废弃，禁止使用**

| 废弃名称 | 正确 canonical_id | 说明 |
|---------|-----------------|------|
| content_writer | inkwriter | 吐墨虾 |
| risk_guard | ❌ 不存在独立龙虾 | 合规检查在 inkwriter 内完成 |
| scheduler | ❌ 不存在独立龙虾 | 排期在 dispatcher 内完成 |
| data_analyst | abacus | 金算虾 |
| account_guard | ❌ 不存在独立龙虾 | 账号健康在 edge-runtime 内完成 |
| 龙虾5 | echoer | 回声虾 |
| 龙虾6 | catcher | 铁网虾 |
| 龙虾7 | abacus | 金算虾 |
| 龙虾8 | ❌ 已合并 | — |
| 龙虾9 | followup | 回访虾（原定义不变） |

---

## 六、龙虾注册表对齐检查

以下文件必须包含全部10只龙虾（每次新增/改名后执行检查）：

```bash
# 检查 lobsters-registry.json
python -c "
import json
reg = json.load(open('f:/openclaw-agent/dragon-senate-saas-v2/lobsters-registry.json'))
expected = {'commander','radar','strategist','inkwriter','visualizer','dispatcher','echoer','catcher','abacus','followup'}
actual = {r['roleId'] for r in reg.get('lobsters', reg if isinstance(reg, list) else [])}
missing = expected - actual
print('Missing:', missing if missing else 'None — all 10 registered!')
"
```

---

*最后更新：2026-04-01 | 维护者：Dragon Senate 团队*  
*权威来源：`f:/openclaw-agent/PROJECT_CONTROL_CENTER.md`*
