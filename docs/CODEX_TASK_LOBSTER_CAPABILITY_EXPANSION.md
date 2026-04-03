# CODEX-CAP-01: 龙虾能力边界扩展落地 — 46 技能全链路闭环

> **优先级**: P0 | **算力**: 高 | **来源**: `docs/LOBSTER_CAPABILITY_EXPANSION.md`
> **前置依赖**: CODEX-OCM-01 (LobsterSkillRegistry) 建议先完成

---

## 背景

`docs/LOBSTER_CAPABILITY_EXPANSION.md` 定义了 Commander + 9 只龙虾从 10 个基础技能扩展到 **46 个技能** 的完整蓝图，覆盖 7 阶段业务闭环：信号发现 → 策略制定 → 内容生产 → 渠道分发 → 互动转化 → 成交跟进 → ROI 复盘。

本任务负责将这些能力定义**落地到仓库代码中**，同时**覆盖/消除重复内容**，确保前端工程师能对齐。

## 目标

1. 将 36 个新增技能注册到 `LobsterSkillRegistry`
2. 更新 9 只龙虾的 `role-card.json`，扩展能力边界描述
3. 更新龙虾名册（`PROJECT_CONTROL_CENTER.md` 第二章）
4. 更新前端交接文档（`docs/FRONTEND_CODEX_HANDOFF.md`）
5. 覆盖/消除仓库中已有的重复或过时内容

---

## 交付物

### 1. 扩展 `lobster_skill_registry.py` 的 `register_builtin_skills()`

将 `docs/LOBSTER_CAPABILITY_EXPANSION.md` 第四章中的所有技能代码片段合并到 `dragon-senate-saas-v2/lobster_skill_registry.py` 的 `register_builtin_skills()` 函数中。

完整技能列表（46 个）：

| # | 技能 ID | 名称 | 归属龙虾 | 分类 |
|---|---------|------|---------|------|
| 1 | `radar_web_search` | 全网信号搜索 | 触须虾 | 信号采集 |
| 2 | `radar_trend_analysis` | 趋势归纳分析 | 触须虾 | 信号采集 |
| 3 | `radar_hotspot_monitor` | 全网热点监控 | 触须虾 | 信号采集 |
| 4 | `radar_competitor_track` | 竞品内容追踪 | 触须虾 | 信号采集 |
| 5 | `radar_keyword_radar` | 行业关键词雷达 | 触须虾 | 信号采集 |
| 6 | `radar_user_profiling` | 用户画像分析 | 触须虾 | 信号采集 |
| 7 | `radar_metrics_feedback` | 内容效果反馈接收 | 触须虾 | 信号采集 |
| 8 | `radar_sentiment_alert` | 舆情风险预警 | 触须虾 | 信号采集 |
| 9 | `strategist_goal_decompose` | 目标拆解 | 脑虫虾 | 策略规划 |
| 10 | `strategist_platform_allocation` | 多平台投放策略 | 脑虫虾 | 策略规划 |
| 11 | `strategist_content_calendar` | 内容日历排期 | 脑虫虾 | 策略规划 |
| 12 | `strategist_ab_test_design` | A/B 测试设计 | 脑虫虾 | 策略规划 |
| 13 | `strategist_budget_suggestion` | 预算分配建议 | 脑虫虾 | 策略规划 |
| 14 | `strategist_adaptive_adjust` | 策略自适应调整 | 脑虫虾 | 策略规划 |
| 15 | `strategist_competitor_playbook` | 竞品打法对标 | 脑虫虾 | 策略规划 |
| 16 | `inkwriter_copy_generate` | 成交文案生成 | 吐墨虾 | 内容生产 |
| 17 | `inkwriter_multiplatform_adapt` | 多平台文案适配 | 吐墨虾 | 内容生产 |
| 18 | `inkwriter_hashtag_gen` | 话题标签生成 | 吐墨虾 | 内容生产 |
| 19 | `inkwriter_banned_word_check` | 违禁词检测 | 吐墨虾 | 风控 |
| 20 | `inkwriter_dm_script` | 私信话术链 | 吐墨虾 | 互动 |
| 21 | `visualizer_storyboard` | 分镜脚本生成 | 幻影虾 | 内容生产 |
| 22 | `visualizer_ai_prompt` | AI 绘图提示词生成 | 幻影虾 | 视觉生产 |
| 23 | `visualizer_image_gen` | AI 图片生成 | 幻影虾 | 视觉生产 |
| 24 | `visualizer_cover_design` | 封面图设计 | 幻影虾 | 视觉生产 |
| 25 | `visualizer_digital_human_script` | 数字人视频脚本 | 幻影虾 | 视频生产 |
| 26 | `visualizer_digital_human_video` | 数字人视频生成 | 幻影虾 | 视频生产 |
| 27 | `visualizer_video_edit` | 视频剪辑 | 幻影虾 | 视频生产 |
| 28 | `visualizer_subtitle_gen` | 字幕生成 | 幻影虾 | 视频生产 |
| 29 | `dispatcher_task_split` | 任务拆包分发 | 点兵虾 | 调度执行 |
| 30 | `dispatcher_scheduled_publish` | 定时发布 | 点兵虾 | 调度执行 |
| 31 | `dispatcher_multi_account_rotate` | 多账号轮转 | 点兵虾 | 调度执行 |
| 32 | `dispatcher_emergency_takedown` | 紧急下架 | 点兵虾 | 风控 |
| 33 | `echoer_reply_generate` | 真人感互动回复 | 回声虾 | 互动 |
| 34 | `echoer_comment_manage` | 评论区管理 | 回声虾 | 互动 |
| 35 | `echoer_dm_auto_reply` | 私信自动回复 | 回声虾 | 互动 |
| 36 | `echoer_wechat_funnel` | 私信→微信引流 | 回声虾 | 转化 |
| 37 | `catcher_lead_score` | 高意向线索识别 | 铁网虾 | 线索管理 |
| 38 | `catcher_crm_push` | 线索自动入 CRM | 铁网虾 | 线索管理 |
| 39 | `catcher_cross_platform_dedup` | 跨平台线索去重 | 铁网虾 | 线索管理 |
| 40 | `abacus_roi_calc` | ROI 归因计算 | 金算虾 | 数据分析 |
| 41 | `abacus_multi_touch_attribution` | 多触点归因分析 | 金算虾 | 数据分析 |
| 42 | `abacus_strategy_report` | 策略效果报告 | 金算虾 | 数据分析 |
| 43 | `abacus_feedback_loop` | 策略反馈闭环 | 金算虾 | 闭环优化 |
| 44 | `followup_sop_generate` | 跟进 SOP 生成 | 回访虾 | 客户跟进 |
| 45 | `followup_multi_touch` | 多触点跟进编排 | 回访虾 | 客户跟进 |
| 46 | `followup_dormant_wake` | 沉默用户唤醒 | 回访虾 | 客户跟进 |

每个技能的 `config_fields` 详细定义请参考 `docs/LOBSTER_CAPABILITY_EXPANSION.md` 第四章。

### 2. 更新 9 只龙虾的 `role-card.json`

路径: `packages/lobsters/lobster-{id}/role-card.json`

为每只龙虾更新 `skills` 字段和 `capability_boundary` 描述：

#### 触须虾 (radar)
```json
{
  "skills": ["radar_web_search", "radar_trend_analysis", "radar_hotspot_monitor", "radar_competitor_track", "radar_keyword_radar", "radar_user_profiling", "radar_metrics_feedback", "radar_sentiment_alert"],
  "capability_boundary": "信号发现层：全网热点监控、竞品追踪、关键词雷达、用户画像、内容效果反馈接收、舆情预警。闭环位置：① → ② 将 SignalBrief 传给脑虫虾",
  "business_stage": "① 信号发现"
}
```

#### 脑虫虾 (strategist)
```json
{
  "skills": ["strategist_goal_decompose", "strategist_platform_allocation", "strategist_content_calendar", "strategist_ab_test_design", "strategist_budget_suggestion", "strategist_adaptive_adjust", "strategist_competitor_playbook"],
  "capability_boundary": "策略制定层：目标拆解、多平台投放策略、内容日历排期、A/B测试设计、预算分配、策略自适应调整、竞品打法对标。闭环位置：② → ③ 将 StrategyRoute 传给吐墨虾/幻影虾",
  "business_stage": "② 策略制定"
}
```

#### 吐墨虾 (inkwriter)
```json
{
  "skills": ["inkwriter_copy_generate", "inkwriter_multiplatform_adapt", "inkwriter_hashtag_gen", "inkwriter_banned_word_check", "inkwriter_dm_script"],
  "capability_boundary": "文案生产层：成交文案生成、多平台适配(抖音/小红书/微信/B站)、话题标签、违禁词检测、私信话术链。闭环位置：③-A → ③-B 或 ④",
  "business_stage": "③-A 内容生产(文案)"
}
```

#### 幻影虾 (visualizer)
```json
{
  "skills": ["visualizer_storyboard", "visualizer_ai_prompt", "visualizer_image_gen", "visualizer_cover_design", "visualizer_digital_human_script", "visualizer_digital_human_video", "visualizer_video_edit", "visualizer_subtitle_gen"],
  "capability_boundary": "视觉/视频生产层：分镜脚本、AI绘图提示词、AI图片生成、封面图设计、数字人视频脚本+生成、视频剪辑、字幕生成。闭环位置：③-B → ④ 素材打包给点兵虾",
  "business_stage": "③-B 内容生产(视觉/视频)"
}
```

#### 点兵虾 (dispatcher)
```json
{
  "skills": ["dispatcher_task_split", "dispatcher_scheduled_publish", "dispatcher_multi_account_rotate", "dispatcher_emergency_takedown"],
  "capability_boundary": "分发调度层：任务拆包、定时发布、多账号轮转、紧急下架。闭环位置：④ → ⑤ 发布后进入互动阶段",
  "business_stage": "④ 渠道分发"
}
```

#### 回声虾 (echoer)
```json
{
  "skills": ["echoer_reply_generate", "echoer_comment_manage", "echoer_dm_auto_reply", "echoer_wechat_funnel"],
  "capability_boundary": "互动转化层：真人感回复、评论区管理、私信自动回复、私信→微信引流。闭环位置：⑤-A → ⑤-B 高意向用户传给铁网虾",
  "business_stage": "⑤-A 互动转化"
}
```

#### 铁网虾 (catcher)
```json
{
  "skills": ["catcher_lead_score", "catcher_crm_push", "catcher_cross_platform_dedup"],
  "capability_boundary": "线索识别层：高意向识别+评分、线索自动入CRM、跨平台去重。闭环位置：⑤-B → ⑥ 高意向线索传给回访虾 + ⑤-B → ⑦ 数据传给金算虾",
  "business_stage": "⑤-B 线索识别"
}
```

#### 金算虾 (abacus)
```json
{
  "skills": ["abacus_roi_calc", "abacus_multi_touch_attribution", "abacus_strategy_report", "abacus_feedback_loop"],
  "capability_boundary": "ROI复盘层：ROI归因、多触点归因分析、策略效果报告、策略反馈闭环。闭环位置：⑦ → ① 反馈给触须虾+脑虫虾开启下轮循环",
  "business_stage": "⑦ ROI 复盘"
}
```

#### 回访虾 (followup)
```json
{
  "skills": ["followup_sop_generate", "followup_multi_touch", "followup_dormant_wake"],
  "capability_boundary": "成交跟进层：跟进SOP生成、多触点跟进编排(私信→微信→电话→邮件)、沉默用户唤醒。闭环位置：⑥ → ⑦ 成交数据传给金算虾",
  "business_stage": "⑥ 成交跟进"
}
```

### 3. 更新 `PROJECT_CONTROL_CENTER.md` 第二章龙虾名册

将现有名册从简单的 "核心工件 + 职责" 扩展为包含 **业务阶段 + 技能数量 + 闭环位置**：

```markdown
| # | canonical_id | 中文名 | 业务阶段 | 技能数 | 核心工件 | 职责 + 闭环位置 |
|---|-------------|--------|---------|--------|---------|----------------|
| 0 | commander | 元老院总脑 | 全局 | 6 | MissionPlan | 全链路编排+异常中断+资源仲裁+自动复盘 |
| 1 | radar | 触须虾 | ① 信号发现 | 8 | SignalBrief | 全网热点+竞品追踪+舆情预警 → ②脑虫虾 |
| 2 | strategist | 脑虫虾 | ② 策略制定 | 7 | StrategyRoute | 投放策略+日历排期+自适应 → ③吐墨虾/幻影虾 |
| 3 | inkwriter | 吐墨虾 | ③-A 文案 | 5 | CopyPack | 多平台文案+违禁词+私信话术 → ③-B/④ |
| 4 | visualizer | 幻影虾 | ③-B 视觉 | 8 | StoryboardPack | AI图片+数字人视频+剪辑+字幕 → ④点兵虾 |
| 5 | dispatcher | 点兵虾 | ④ 分发 | 4 | ExecutionPlan | 定时发布+多账号轮转+紧急下架 → ⑤边缘执行 |
| 6 | echoer | 回声虾 | ⑤-A 互动 | 4 | EngagementReplyPack | 评论管理+私信回复+微信引流 → ⑤-B铁网虾 |
| 7 | catcher | 铁网虾 | ⑤-B 线索 | 3 | LeadAssessment | 线索评分+CRM入库+去重 → ⑥回访虾+⑦金算虾 |
| 8 | abacus | 金算虾 | ⑦ 复盘 | 4 | ValueScoreCard | 多触点归因+报告+反馈闭环 → ①触须虾 |
| 9 | followup | 回访虾 | ⑥ 跟进 | 3 | FollowUpActionPlan | 多触点跟进+唤醒+成交回写 → ⑦金算虾 |
```

### 4. 更新 `docs/FRONTEND_CODEX_HANDOFF.md`

新增以下章节，供前端工程师了解技能系统和闭环流程：

```markdown
## 龙虾技能系统

### API 端点
- `GET /api/skills` — 获取所有 46 个技能
- `GET /api/skills?lobster_id=visualizer` — 获取幻影虾的 8 个技能
- `GET /api/skills/{skill_id}` — 获取单个技能详情（含 config_fields 表单定义）

### 前端页面需求
1. **技能总览页**: 按龙虾分组展示所有技能（卡片式，含图标/名称/描述/启用状态）
2. **技能配置弹窗**: 点击技能卡片弹出配置表单（由 config_fields 驱动动态渲染）
3. **业务闭环可视化**: 7 阶段环形图，每个阶段展示对应龙虾和技能数

### 业务闭环 7 阶段
| 阶段 | 龙虾 | 技能数 | 代表性技能 |
|------|------|--------|-----------|
| ① 信号发现 | 触须虾 | 8 | 全网热点监控、竞品追踪 |
| ② 策略制定 | 脑虫虾 | 7 | 内容日历排期、A/B测试设计 |
| ③-A 文案 | 吐墨虾 | 5 | 多平台文案适配、违禁词检测 |
| ③-B 视觉 | 幻影虾 | 8 | AI图片生成、数字人视频 |
| ④ 分发 | 点兵虾 | 4 | 定时发布、多账号轮转 |
| ⑤ 互动+线索 | 回声虾+铁网虾 | 7 | 私信回复、微信引流、CRM入库 |
| ⑥ 跟进 | 回访虾 | 3 | 多触点跟进、沉默用户唤醒 |
| ⑦ 复盘 | 金算虾 | 4 | 多触点归因、策略反馈闭环 |
```

### 5. 覆盖/消除重复内容

以下位置可能存在与新技能定义重复或冲突的旧内容，需要检查并覆盖：

| 文件 | 检查内容 | 操作 |
|------|---------|------|
| `dragon-senate-saas-v2/lobsters/shared.py` | `SKILL_BINDINGS` 字典 | 标记为 `@deprecated`，改为从 `LobsterSkillRegistry` 读取 |
| `packages/lobsters/lobster-operating-model.json` | 旧的 skills/KB/workflow 定义 | 更新 skills 列表为 46 个新技能 ID |
| `packages/lobsters/baseline-agent-manifest.json` | 9 虾基线定义 | 更新每虾的 `skills` 数组和 `capability_boundary` |
| `PROJECT_CONTROL_CENTER.md` 第二章 | 旧的龙虾名册 | 替换为新的含业务阶段+技能数量的名册 |
| `docs/CODEX_TASK_EXTRACT_REMAINING_LOBSTERS.md` | 可能有旧技能描述 | 检查是否有冲突，有则更新 |
| `dragon-senate-saas-v2/dragon_senate.py` | 硬编码的龙虾能力描述 | 检查注释/文档字符串是否需要更新 |

### 6. 测试

`dragon-senate-saas-v2/tests/test_lobster_skill_registry.py` 更新验收：

```python
def test_total_skill_count():
    """验证所有 46 个技能已注册"""
    registry = get_skill_registry()
    assert len(registry.get_all()) == 46

def test_visualizer_has_8_skills():
    """幻影虾应该有 8 个技能（含数字人视频等）"""
    registry = get_skill_registry()
    skills = registry.get_by_lobster("visualizer")
    assert len(skills) == 8
    skill_ids = [s.id for s in skills]
    assert "visualizer_digital_human_video" in skill_ids
    assert "visualizer_ai_prompt" in skill_ids

def test_radar_has_8_skills():
    """触须虾应该有 8 个技能"""
    registry = get_skill_registry()
    skills = registry.get_by_lobster("radar")
    assert len(skills) == 8

def test_business_loop_coverage():
    """验证 7 个业务阶段都有对应龙虾技能覆盖"""
    registry = get_skill_registry()
    categories = set(s.category for s in registry.get_all())
    required = {"信号采集", "策略规划", "内容生产", "视觉生产", "视频生产",
                "调度执行", "互动", "转化", "线索管理", "数据分析", 
                "客户跟进", "闭环优化", "风控"}
    assert required.issubset(categories)
```

---

## 约束

- **不改动**龙虾核心执行逻辑（`lobsters/*.py` 的 `run()` 方法）
- 技能注册是**元数据层**，不包含技能的实际实现代码（实现在后续 Codex 任务中逐步填充）
- 每个技能的 `execute_fn` 暂时为 `None`，预留运行时注入接口
- `config_fields` 中的 `PASSWORD` 类型字段在 API 返回时必须脱敏
- 所有变更对现有测试保持向后兼容

## 验收标准

1. `GET /api/skills` 返回 **46** 个技能
2. `GET /api/skills?lobster_id=visualizer` 返回 **8** 个技能（含数字人视频）
3. 每只龙虾的 `role-card.json` 包含 `skills` / `capability_boundary` / `business_stage` 字段
4. `PROJECT_CONTROL_CENTER.md` 第二章已更新为含闭环位置的名册
5. `docs/FRONTEND_CODEX_HANDOFF.md` 包含技能系统和闭环流程说明
6. `SKILL_BINDINGS` 已标记为 deprecated
7. `python -m pytest dragon-senate-saas-v2/tests/test_lobster_skill_registry.py` 全部通过
8. 无重复/冲突的旧内容残留
