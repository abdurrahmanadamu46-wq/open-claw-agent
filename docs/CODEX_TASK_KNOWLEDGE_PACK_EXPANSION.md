# CODEX-KP-01: 知识包扩展 — 对齐 46 技能全链路闭环

> **优先级**: P0 | **算力**: 中 | **来源**: `docs/LOBSTER_CAPABILITY_EXPANSION.md`
> **前置依赖**: CODEX-CAP-01 (龙虾能力扩展落地) 建议先完成
> **涉及文件**: `dragon-senate-saas-v2/rag_factory/rag_seed_catalog.json`

---

## 背景

当前 `rag_seed_catalog.json` 为 8+1 只龙虾各预置了 10 个知识包种子（共 90 个），这些知识包是基于**旧能力边界**设计的。

`LOBSTER_CAPABILITY_EXPANSION.md` 将龙虾技能从 10 个扩展到 **46 个**，新增了大量能力领域（数字人视频、AI图片生成、多平台分发、私信引流、跨平台去重、多触点归因等），但现有知识包**没有覆盖这些新能力的知识支撑需求**。

## 目标

1. 在 `rag_seed_catalog.json` 中为每只龙虾**新增知识包种子**，覆盖所有新增技能的知识需求
2. 更新现有知识包的 `seed_goal` 描述，使其与新能力边界对齐
3. 保持每虾约 **12-15 个**知识包（从 10 个扩展）
4. 确保批量生成脚本 `run_agent_rag_batch_generate.py` 无需改动即可工作

---

## 缺口分析

### 现有覆盖 vs 新能力缺口

| 龙虾 | 现有知识包(10) | 新技能需要但缺失的知识支撑 | 需新增 |
|------|---------------|--------------------------|--------|
| **触须虾** | 竞品版图、热点信号、高转化账号等 | ❌ 全网热搜数据结构、竞品账号追踪规则、舆情预警阈值、用户画像标签体系 | +4 |
| **脑虫虾** | 老板决策、漏斗断点、增长目标等 | ❌ 多平台投放比例基准、内容日历模板、A/B测试变量库、预算分配模型 | +4 |
| **吐墨虾** | 短视频钩子、成交口播、私信话术等 | ❌ 多平台格式规范(抖音/小红书/B站/微博)、违禁词库、SEO关键词植入规则、话题标签热度数据 | +4 |
| **幻影虾** | 分镜镜头、场景风格、封面版式等 | ❌ AI绘图提示词模板、数字人脚本格式、视频剪辑指令规范、字幕样式规范、多尺寸适配规则 | +5 |
| **点兵虾** | 任务拆包、路由规则、优先级等 | ❌ 各平台发布时间窗口、多账号轮转策略、发布后验证规则、紧急下架SOP | +4 |
| **回声虾** | 评论意图、信任建立、负评化解等 | ❌ 私信自动回复意图路由、微信引流合规话术、评论区管理策略(置顶/隐藏)、情绪升级阈值 | +3 |
| **铁网虾** | 高意向信号、风险过滤、预算信号等 | ❌ CRM字段映射(已在金算虾)、跨平台用户ID打通规则、线索衰减函数、竞品线索识别 | +3 |
| **金算虾** | 评分因子、归因来源、ROI基准等 | ❌ 多触点归因模型参数、渠道ROI对比基准、策略效果报告模板、预算消耗追踪规则 | +3 |
| **回访虾** | 跟进SOP、唤醒策略、逼单窗口等 | ❌ 多触点编排规则(私信→微信→电话→邮件)、复购/续费提醒规则、NPS问卷模板 | +2 |

**合计**: 现有 90 个 + 新增 **32 个** = **122 个**知识包

---

## 交付物

### 1. 更新 `rag_seed_catalog.json`

在每只龙虾的 `knowledge_targets` 数组中追加新知识包。以下是需要新增的完整列表：

#### 触须虾新增 4 个

```json
{
  "knowledge_pack_id": "hotspot_data_structure",
  "knowledge_pack_name": "全网热搜数据结构库",
  "seed_goal": "沉淀微博/抖音/小红书/B站/Twitter各平台热搜、热榜、趋势数据的采集字段、更新频率和结构化入库规范。"
},
{
  "knowledge_pack_id": "competitor_tracking_rule",
  "knowledge_pack_name": "竞品账号追踪规则库",
  "seed_goal": "沉淀竞品账号的发现方式、关注指标（发布频率/互动量/增粉速度）、对比维度和异动检测规则。"
},
{
  "knowledge_pack_id": "sentiment_alert_threshold",
  "knowledge_pack_name": "舆情预警阈值库",
  "seed_goal": "沉淀品牌相关负面舆情的关键词、情感分值阈值、告警等级和响应SOP。"
},
{
  "knowledge_pack_id": "user_portrait_label",
  "knowledge_pack_name": "用户画像标签体系库",
  "seed_goal": "沉淀各平台用户画像标签（年龄/性别/地域/兴趣/活跃时段/消费能力），用于精准触达和内容调优。"
}
```

#### 脑虫虾新增 4 个

```json
{
  "knowledge_pack_id": "platform_allocation_benchmark",
  "knowledge_pack_name": "多平台投放比例基准库",
  "seed_goal": "沉淀不同行业、不同预算量级下抖音/小红书/微信/B站/微博的推荐内容比例、投放节奏和ROI预期。"
},
{
  "knowledge_pack_id": "content_calendar_template",
  "knowledge_pack_name": "内容日历模板库",
  "seed_goal": "沉淀7天/30天内容排期模板，含平台差异化发布时间、内容类型轮转和节假日调整规则。"
},
{
  "knowledge_pack_id": "ab_test_variable",
  "knowledge_pack_name": "A/B测试变量库",
  "seed_goal": "沉淀标题/封面/开头钩子/CTA/发布时间等可测试变量的隔离方法、样本量和判定标准。"
},
{
  "knowledge_pack_id": "budget_optimization_model",
  "knowledge_pack_name": "预算分配优化模型库",
  "seed_goal": "沉淀基于历史ROI数据的预算再分配规则，含边际效益递减判断和渠道切换阈值。"
}
```

#### 吐墨虾新增 4 个

```json
{
  "knowledge_pack_id": "platform_format_spec",
  "knowledge_pack_name": "多平台内容格式规范库",
  "seed_goal": "沉淀抖音（标题限制/标签/文案长度）、小红书（图文笔记/标题/正文/标签）、微信公众号（推文结构/排版）、B站（视频描述/标签/分区）、微博（正文长度/话题/超话）的格式规范。"
},
{
  "knowledge_pack_id": "banned_word_dictionary",
  "knowledge_pack_name": "违禁词与敏感词库",
  "seed_goal": "沉淀广告法违禁词（极限用语/绝对化表述）、各平台敏感词（导流词/价格词/承诺词）、行业特定违规词及安全替代表达。"
},
{
  "knowledge_pack_id": "seo_keyword_insertion",
  "knowledge_pack_name": "SEO关键词植入规则库",
  "seed_goal": "沉淀各平台搜索排名规则、关键词自然植入技巧、标题/正文/标签的关键词密度和长尾词策略。"
},
{
  "knowledge_pack_id": "hashtag_strategy",
  "knowledge_pack_name": "话题标签策略库",
  "seed_goal": "沉淀各平台热门话题/超话/标签的选择策略，含大标签+垂直标签+长尾标签的组合公式和蹭热点时机。"
}
```

#### 幻影虾新增 5 个 ⭐

```json
{
  "knowledge_pack_id": "ai_image_prompt_template",
  "knowledge_pack_name": "AI绘图提示词模板库",
  "seed_goal": "沉淀Midjourney/Stable Diffusion/DALL-E/Flux的提示词结构、风格关键词、画面描述模板、负面提示词和参数设置（ar/style/quality）。"
},
{
  "knowledge_pack_id": "digital_human_script_format",
  "knowledge_pack_name": "数字人口播脚本格式库",
  "seed_goal": "沉淀数字人视频脚本的结构规范，含语速标注（正常/快/慢）、表情标签（微笑/严肃/惊喜）、手势指令、停顿标记和镜头切换点。"
},
{
  "knowledge_pack_id": "digital_human_platform_spec",
  "knowledge_pack_name": "数字人平台对接规范库",
  "seed_goal": "沉淀HeyGen/D-ID/硅基智能/腾讯智影的API参数、形象ID管理、音色选择、背景设置和渲染质量选项。"
},
{
  "knowledge_pack_id": "video_edit_instruction",
  "knowledge_pack_name": "视频剪辑指令规范库",
  "seed_goal": "沉淀FFmpeg/MoviePy的常用剪辑指令序列，含片段拼接、转场效果、字幕叠加（SRT/ASS）、BGM混音和多尺寸导出（9:16/16:9/1:1）的参数模板。"
},
{
  "knowledge_pack_id": "multi_size_adaptation",
  "knowledge_pack_name": "多尺寸适配规则库",
  "seed_goal": "沉淀抖音(9:16)、B站(16:9)、小红书(3:4/1:1)、微信(不定)等平台的尺寸要求，含裁剪策略、安全区标注和文字重排版规则。"
}
```

#### 点兵虾新增 4 个

```json
{
  "knowledge_pack_id": "platform_publish_window",
  "knowledge_pack_name": "各平台最佳发布时间库",
  "seed_goal": "沉淀抖音/小红书/微信/B站/微博各平台不同行业、不同内容类型的最佳发布时间窗口和流量高峰规律。"
},
{
  "knowledge_pack_id": "multi_account_rotation",
  "knowledge_pack_name": "多账号轮转策略库",
  "seed_goal": "沉淀单平台多账号轮转的频率控制、IP隔离、设备指纹差异化和限流恢复周期规则。"
},
{
  "knowledge_pack_id": "post_publish_verification",
  "knowledge_pack_name": "发布后验证规则库",
  "seed_goal": "沉淀发布后检查内容是否被限流/屏蔽/删除的判定指标（播放量/推荐量/搜索可见性），含异常阈值和应对SOP。"
},
{
  "knowledge_pack_id": "emergency_takedown_sop",
  "knowledge_pack_name": "紧急下架SOP库",
  "seed_goal": "沉淀检测到风险（违规/舆情/竞品举报）时的紧急下架流程，含触发条件、操作步骤、通知链和事后复盘。"
}
```

#### 回声虾新增 3 个

```json
{
  "knowledge_pack_id": "dm_intent_routing",
  "knowledge_pack_name": "私信意图路由库",
  "seed_goal": "沉淀私信消息的意图分类（咨询/投诉/意向/闲聊/广告/骚扰），每种意图的回复策略和是否转人工的判定规则。"
},
{
  "knowledge_pack_id": "wechat_funnel_compliance",
  "knowledge_pack_name": "微信引流合规话术库",
  "seed_goal": "沉淀从平台私信引导添加微信的合规表达方式，含时机判断（几轮对话后引导）、话术变体（避免重复被检测）和平台风控规避。"
},
{
  "knowledge_pack_id": "comment_management_strategy",
  "knowledge_pack_name": "评论区管理策略库",
  "seed_goal": "沉淀评论置顶选择标准、负面评论隐藏/回复策略、品牌自评论暖场话术和互动率提升技巧。"
}
```

#### 铁网虾新增 3 个

```json
{
  "knowledge_pack_id": "cross_platform_id_matching",
  "knowledge_pack_name": "跨平台用户打通规则库",
  "seed_goal": "沉淀通过手机号/微信号/邮箱/昵称/头像等信息进行跨平台用户去重和身份合并的规则和置信度阈值。"
},
{
  "knowledge_pack_id": "lead_decay_function",
  "knowledge_pack_name": "线索衰减函数库",
  "seed_goal": "沉淀线索热度随时间衰减的计算模型，含衰减系数、唤醒信号（重新互动/二次访问）和从热到冷的阶段判定。"
},
{
  "knowledge_pack_id": "competitor_lead_intercept",
  "knowledge_pack_name": "竞品线索拦截库",
  "seed_goal": "沉淀识别正在考虑竞品用户的信号词（提到竞品名/比价/犹豫），优先触达策略和差异化卖点话术。"
}
```

#### 金算虾新增 3 个

```json
{
  "knowledge_pack_id": "multi_touch_attribution_model",
  "knowledge_pack_name": "多触点归因模型库",
  "seed_goal": "沉淀首触/末触/线性/时间衰减/U型归因等模型的适用场景、计算公式和数据链路要求。"
},
{
  "knowledge_pack_id": "channel_roi_comparison",
  "knowledge_pack_name": "渠道ROI对比基准库",
  "seed_goal": "沉淀各渠道（抖音/小红书/微信/B站/微博/私域）的获客成本/转化率/客单价行业基准，含对比维度和异常偏差判定。"
},
{
  "knowledge_pack_id": "strategy_report_template",
  "knowledge_pack_name": "策略效果报告模板库",
  "seed_goal": "沉淀周报/月报的结构模板，含关键指标呈现、趋势图表、归因分析、策略调整建议和下期计划的标准格式。"
}
```

#### 回访虾新增 2 个

```json
{
  "knowledge_pack_id": "multi_touch_orchestration",
  "knowledge_pack_name": "多触点跟进编排库",
  "seed_goal": "沉淀跨渠道跟进的编排规则，含私信→微信→电话→邮件的切换条件、间隔时长、内容差异化和触点优先级。"
},
{
  "knowledge_pack_id": "renewal_reminder_rule",
  "knowledge_pack_name": "复购续费提醒规则库",
  "seed_goal": "沉淀已成交客户的复购/续费提醒节点（到期前30天/15天/7天/3天/1天），含提醒话术、优惠策略和流失预警。"
}
```

### 2. 更新现有知识包描述

以下现有知识包的 `seed_goal` 需要扩展，使其包含新能力边界的内容：

| 龙虾 | 知识包 ID | 现有目标 | 更新后目标 |
|------|-----------|---------|-----------|
| 触须虾 | `hot_topic_signal` | 追踪热门话题...用于选题和投流预警 | 追踪**微博/抖音/小红书/B站/Twitter**热门话题、热搜、爆款切口与赛道热度漂移，**支撑全网热点监控技能**，用于选题、投流预警和**内容日历排期输入**。 |
| 触须虾 | `competitor_landscape` | 沉淀竞品定位、报价... | 沉淀竞品的定位、报价、套餐、渠道动作与内容打法，**含竞品账号列表管理、内容更新追踪和差异化策略生成输入**。 |
| 幻影虾 | `cover_thumbnail` | 沉淀高识别度封面构图... | 沉淀高识别度封面构图、标题层级、对比元素与视觉锚点，**含AI生成封面图的提示词模板和多平台尺寸适配方案**。 |
| 吐墨虾 | `comment_reply` | 沉淀评论区分层回复... | 沉淀评论区分层回复、转预约、转私信、转留资的话术模板，**含品牌自评论暖场话术和评论区管理策略（置顶/隐藏/回复优先级）**。 |
| 吐墨虾 | `private_message` | 沉淀私信首轮响应... | 沉淀私信首轮响应、需求确认、预约推进和风险规避表达，**含多轮私信话术链（破冰→兴趣→需求→促成交→微信引流）和平台合规边界**。 |
| 吐墨虾 | `risk_rewrite` | 把高风险表达改写... | 把高风险表达改写成更稳妥的说法，**含广告法违禁词替代、各平台敏感词规避和违禁词自动检测规则**。 |
| 金算虾 | `attribution_source` | 沉淀归因来源规则... | 沉淀自然流量、广告、直播、评论、私信等来源归因规则，**扩展支持首触/末触/线性/时间衰减多种归因模型**。 |
| 金算虾 | `closed_loop_feedback` | 把成交/丢单结果反哺... | 把成交/丢单结果反哺到评分、归因和策略优化，**含策略反馈闭环数据流：金算虾→脑虫虾→下轮策略参数自动调整**。 |

### 3. 更新 `agent_rag_pack_factory.py` 的 `summary` 字段

更新每只龙虾的 `summary` 描述，对齐新能力边界：

```python
# 触须虾
"summary": "全网信号发现层；负责热点监控、竞品追踪、关键词雷达、用户画像分析、内容效果反馈接收和舆情预警。"

# 脑虫虾
"summary": "策略制定层；负责目标拆解、多平台投放策略、内容日历排期、A/B测试设计、预算分配和策略自适应调整。"

# 吐墨虾
"summary": "文案生产层；负责多平台文案适配、话题标签生成、违禁词检测、私信话术链和SEO关键词植入。"

# 幻影虾
"summary": "视觉/视频生产层；负责AI绘图提示词、AI图片生成、数字人视频脚本与生成、视频剪辑、字幕生成和封面设计。"

# 点兵虾
"summary": "分发调度层；负责任务拆包、定时发布、多账号轮转、跨平台同步和紧急下架。"

# 回声虾
"summary": "互动转化层；负责评论区管理、私信自动回复、微信引流和情绪升级处理。"

# 铁网虾
"summary": "线索识别层；负责多维度线索评分、跨平台去重合并、CRM自动入库和竞品线索拦截。"

# 金算虾
"summary": "ROI复盘层；负责多触点归因分析、渠道ROI对比、策略效果报告和策略反馈闭环。"

# 回访虾 (followup variant)
"summary": "成交跟进层；负责多触点跟进编排、个性化话术、沉默用户唤醒和复购续费提醒。"
```

### 4. 测试

确保更新后：

```python
def test_catalog_total_packs():
    """验证知识包总数从 90 扩展到 122"""
    import json
    with open("rag_factory/rag_seed_catalog.json") as f:
        catalog = json.load(f)
    total = 0
    for agent in catalog["base_agents"]:
        total += len(agent["knowledge_targets"])
    for variant in catalog["ninth_agent_variants"].values():
        total += len(variant["knowledge_targets"])
    assert total == 122  # 90 原有 + 32 新增

def test_visualizer_has_15_packs():
    """幻影虾应该有 15 个知识包（10 原有 + 5 新增）"""
    ...

def test_batch_generator_compatible():
    """批量生成脚本 run_agent_rag_batch_generate.py 无需改动即可运行"""
    from agent_rag_pack_factory import list_targets
    targets = list_targets(profile="feedback")
    assert len(targets) >= 112  # 8 虾 × 14avg + followup 12
```

---

## 知识包总量统计

| 龙虾 | 原有 | 新增 | 合计 | 覆盖新技能 |
|------|------|------|------|-----------|
| 触须虾 | 10 | 4 | **14** | 全网热点监控、竞品追踪、舆情预警、用户画像 |
| 脑虫虾 | 10 | 4 | **14** | 多平台投放、内容日历、A/B测试、预算分配 |
| 吐墨虾 | 10 | 4 | **14** | 多平台格式、违禁词、SEO、话题标签 |
| 幻影虾 | 10 | 5 | **15** ⭐ | AI提示词、数字人脚本/平台、剪辑指令、多尺寸 |
| 点兵虾 | 10 | 4 | **14** | 发布时间窗口、多账号、发布验证、紧急下架 |
| 回声虾 | 10 | 3 | **13** | 私信意图路由、微信引流合规、评论管理 |
| 铁网虾 | 10 | 3 | **13** | 跨平台打通、线索衰减、竞品线索拦截 |
| 金算虾 | 10 | 3 | **13** | 多触点归因、渠道ROI对比、报告模板 |
| 反馈虾 | 10 | 0 | **10** | (保持不变) |
| 回访虾 | 10 | 2 | **12** | 多触点编排、复购续费提醒 |
| **合计** | **100** | **32** | **132** | |

---

## 约束

- **不改动** `run_agent_rag_batch_generate.py` 脚本逻辑
- **不改动** `agent_rag_pack_factory.py` 核心代码（只改 catalog JSON + summary 字符串）
- 新增知识包的 JSON 结构与现有结构完全一致（`knowledge_pack_id` / `knowledge_pack_name` / `seed_goal`）
- 保持 `knowledge_pack_id` 命名风格一致（小写、下划线分隔、可读）
- 每个 `seed_goal` 必须是一句话描述清楚**沉淀什么 + 用于什么**

## 验收标准

1. `rag_seed_catalog.json` 解析无错误
2. `list_targets(profile="feedback")` 返回 122+ 条目标
3. 每只龙虾的知识包数量符合上表
4. 所有新增知识包的 `seed_goal` 与 `LOBSTER_CAPABILITY_EXPANSION.md` 中对应技能的知识需求对齐
5. `run_agent_rag_batch_generate.py --include-agent visualizer` 可以生成幻影虾全部 15 个知识包
6. 现有已生成的知识包 JSON 文件不受影响（向后兼容）
