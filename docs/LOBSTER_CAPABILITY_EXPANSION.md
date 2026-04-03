# 🦞 龙虾能力边界扩展 — 实现全链路业务闭环

> **日期**: 2026-03-31
> **目的**: 补充每只龙虾缺失的能力，让 Commander + 9 龙虾覆盖从「信号发现 → 策略制定 → 内容生产 → 渠道分发 → 互动转化 → 成交跟进 → ROI 复盘」的完整业务闭环。

---

## 一、业务闭环全景图

一个完整的 AI 增长操作周期包含 **7 个阶段**：

```
═══════════════════ 完整业务闭环 ═══════════════════

  ① 信号发现     触须虾 🔍 扫描全网信号、竞品动态、行业趋势
       │
       ▼
  ② 策略制定     脑虫虾 🧠 目标拆解、打法设计、投放策略
       │
       ▼
  ③ 内容生产     吐墨虾 ✍️ 文案生产 + 幻影虾 🎬 视觉/视频生产
       │
       ▼
  ④ 渠道分发     点兵虾 📦 任务拆包 → 边缘执行器分发到各平台
       │
       ▼
  ⑤ 互动转化     回声虾 💬 评论/私信互动 + 铁网虾 🎣 线索识别
       │
       ▼
  ⑥ 成交跟进     回访虾 📋 跟进 SOP + 二次激活 + 推进成交
       │
       ▼
  ⑦ ROI 复盘     金算虾 💰 归因分析 + 策略反馈 → 回到①
       │
       └──────────→ 回到 ① 触须虾（永动闭环）
```

---

## 二、各龙虾能力扩展详解

### 🔍 ① 触须虾 (Radar) — 信号发现层

**当前能力**: 信号扫描、噪音过滤、趋势归纳

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **全网热点监控** | 监控微博/抖音/小红书/Twitter 热搜、热点话题 | 调用 Agent Reach API + 爬虫 | P0 |
| **竞品内容追踪** | 自动追踪指定竞品账号的新内容、新动态 | 边缘感知层 `competitor_event` | P0 |
| **行业关键词雷达** | 自定义关键词池，持续监听全网提及 | 搜索 API + 定时轮询 | P1 |
| **用户画像分析** | 分析目标平台用户画像（年龄/兴趣/活跃时段） | 数据采集 + LLM 分析 | P1 |
| **内容效果反馈接收** | 接收已发布内容的数据（播放量/互动率），反馈给脑虫虾 | `metrics_event` 上行 | P0 |
| **舆情风险预警** | 检测品牌相关负面舆情，触发风控流程 | 情感分析 + 关键词匹配 | P1 |

**闭环位置**: ① → ② (将信号包 `SignalBrief` 传给脑虫虾制定策略)

---

### 🧠 ② 脑虫虾 (Strategist) — 策略制定层

**当前能力**: 目标拆解、子行业打法、优先级排序

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多平台投放策略** | 根据预算和目标，分配各平台（抖音/小红书/微信/B站）的内容比例和节奏 | LLM 策略生成 + 行业知识库 | P0 |
| **内容日历排期** | 生成 7天/30天内容发布日历（几号发什么、什么时间发） | 模板驱动 + LLM 填充 | P0 |
| **A/B 测试设计** | 为同一主题设计 2-3 个不同角度的内容变体 | 策略路由 + 变体生成 | P1 |
| **预算分配建议** | 根据历史 ROI 数据，建议付费推广预算分配 | 金算虾反馈 + 优化模型 | P1 |
| **策略自适应调整** | 根据执行效果数据，自动调整策略参数（发布频率/内容类型/时间窗口） | policy_bandit + metrics_event | P0 |
| **竞品打法对标** | 分析竞品的内容策略，生成差异化打法建议 | 触须虾信号 + LLM 分析 | P1 |

**闭环位置**: ② → ③ (将策略路线 `StrategyRoute` 传给吐墨虾/幻影虾生产内容)

---

### ✍️ ③-A 吐墨虾 (Inkwriter) — 文案生产层

**当前能力**: 成交导向文案、行业口吻、结构稳定性

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多平台文案适配** | 同一核心信息，适配不同平台格式（抖音标题/小红书笔记/微信推文/微博/B站） | 平台模板 + LLM 改写 | P0 |
| **SEO 关键词植入** | 在文案中自然植入目标关键词，提升搜索排名 | 关键词库 + 自然语言优化 | P1 |
| **话题标签生成** | 为每条内容生成最优 hashtag 组合 | 平台热门标签数据 + LLM | P0 |
| **评论区话术库** | 预生成品牌方自评论（暖场、引导互动、引导私信） | 模板 + LLM 变体生成 | P1 |
| **私信话术链** | 生成多轮私信跟进话术（破冰→兴趣探测→需求挖掘→促成交） | 多轮对话模板 + LLM | P0 |
| **文案 A/B 变体** | 同一主题生成 2-3 个不同风格变体供测试 | LLM 多次生成 + 去重 | P1 |
| **违禁词检测** | 文案发布前检测敏感词/广告法违禁词/平台违规词 | 违禁词库 + 正则 + LLM 校验 | P0 |

**闭环位置**: ③-A → ③-B (文案传给幻影虾制作配图/视频) 或 ③-A → ④ (纯文案直接分发)

---

### 🎬 ③-B 幻影虾 (Visualizer) — 视觉/视频生产层 ⭐ 最大扩展

**当前能力**: 分镜结构、首屏点击、证据感画面 (仅文字描述层面)

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **AI 绘图提示词生成** | 根据文案和分镜，生成 Midjourney/Stable Diffusion/DALL-E 提示词 | LLM prompt engineering | P0 |
| **AI 图片生成** | 调用图片生成 API，直接生成配图（产品图/场景图/对比图） | Midjourney API / SD WebUI / DALL-E API | P0 |
| **封面图设计** | 生成吸引点击的封面图（含文字排版建议） | Canva API / 模板引擎 + AI 生成 | P0 |
| **数字人视频脚本** | 根据文案生成数字人口播视频的脚本（含语速/表情/手势标注） | LLM + 数字人脚本模板 | P0 |
| **数字人视频生成** | 调用数字人平台 API 生成口播视频 | HeyGen / D-ID / 硅基智能 / 腾讯智影 API | P0 |
| **视频剪辑指令生成** | 生成剪辑指令（片段拼接/字幕/BGM/转场/特效标注） | FFmpeg 指令序列 + LLM 编排 | P1 |
| **自动剪辑执行** | 调用视频剪辑引擎执行剪辑操作 | FFmpeg / MoviePy / 剪映 API | P1 |
| **字幕生成** | 从视频/音频自动生成字幕（SRT/ASS） | Whisper API / 讯飞语音 | P1 |
| **BGM 匹配推荐** | 根据内容调性推荐合适的背景音乐 | 音乐库 + 情绪标签匹配 | P2 |
| **多尺寸适配** | 同一内容适配不同平台尺寸（9:16竖屏/16:9横屏/1:1正方形） | 裁剪 + 重排版 | P1 |
| **图文排版模板** | 小红书图文笔记排版（多图+文字覆盖层） | 模板引擎 + Pillow/Canvas | P1 |

**数字人视频生产流水线**:
```
文案(吐墨虾) → 口播脚本(幻影虾) → 数字人视频(幻影虾)
                                  → 字幕叠加(幻影虾)
                                  → BGM 合成(幻影虾)
                                  → 封面图生成(幻影虾)
                                  → 多尺寸导出(幻影虾)
                                  → 任务包(点兵虾)
```

**闭环位置**: ③-B → ④ (视觉素材 + 文案一起打包给点兵虾分发)

---

### 📦 ④ 点兵虾 (Dispatcher) — 分发调度层

**当前能力**: 拆包、依赖、灰度、止损

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多平台发布编排** | 将内容包按日历排期分发到各平台（抖音/小红书/微信/B站/微博） | 任务队列 + 平台适配器 | P0 |
| **定时发布** | 按最佳发布时间窗口定时发布（不同平台最佳时间不同） | cron 调度 + 时区处理 | P0 |
| **多账号轮转** | 同一平台多个账号轮转发布，避免单账号限流 | 账号池管理 + 轮转策略 | P0 |
| **发布后验证** | 发布后自动检查是否成功（是否被限流/删除/屏蔽） | 边缘执行器回查 | P1 |
| **灰度发布** | 先在小号/测试号发布，观察数据后再铺量 | 灰度策略 + 效果判断 | P1 |
| **素材上传管理** | 将图片/视频上传到各平台的素材库 | 平台 API / 边缘执行器 | P0 |
| **跨平台内容同步** | 一个内容同时/间隔发布到多个平台 | 任务编排 + 内容适配 | P0 |
| **紧急下架** | 检测到风险时，自动下架/隐藏已发布内容 | 边缘执行器 + 平台 API | P0 |

**闭环位置**: ④ → ⑤ (发布后进入互动阶段，边缘感知层开始监控评论/私信)

---

### 💬 ⑤-A 回声虾 (Echoer) — 互动转化层

**当前能力**: 真人感回复、情绪承接、互动转化

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **评论区管理** | 置顶优质评论、隐藏负面评论、回复热门评论 | 边缘执行器 + 策略判断 | P0 |
| **私信自动回复** | 根据用户意图，自动回复私信（分流：咨询/投诉/意向） | LLM 意图识别 + 多轮话术 | P0 |
| **私信→微信引流** | 在私信中引导用户添加微信（合规话术 + 时机判断） | 引流话术模板 + 风控 | P0 |
| **粉丝互动维护** | 主动点赞/收藏粉丝内容，增强粉丝粘性 | 边缘执行器定时任务 | P1 |
| **社群运营** | 群聊中的自动回复、话题引导、活动提醒 | 群聊适配器 + LLM | P1 |
| **直播间互动** | 直播间自动回复弹幕、引导关注/点赞/购买 | 直播平台适配器 | P2 |
| **多语言回复** | 根据用户语言自动切换回复语言 | 语言检测 + 多语言 LLM | P2 |
| **情绪升级处理** | 检测用户情绪恶化，自动转人工客服 | 情感分析 + 转接机制 | P1 |

**闭环位置**: ⑤-A → ⑤-B (将互动中发现的高意向用户传给铁网虾评估)

---

### 🎣 ⑤-B 铁网虾 (Catcher) — 线索识别层

**当前能力**: 高意向识别、风险过滤、预算判断

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多维度线索评分** | 从互动频率/内容关键词/用户画像/行为序列多维度评分 | xai-scorer + 特征工程 | P0 |
| **线索去重合并** | 同一用户在多个平台的线索合并为一个（跨平台用户打通） | 手机号/微信号/邮箱去重 | P0 |
| **线索自动入 CRM** | 高分线索自动写入超级海港 CRM，创建线索卡 | CRM API 对接 | P0 |
| **线索分级分配** | 按线索质量分配给不同销售人员/客服团队 | 评分阈值 + 分配规则 | P1 |
| **竞品线索拦截** | 识别正在考虑竞品的用户，优先触达 | 关键词检测 + 优先级提升 | P1 |
| **线索衰减检测** | 检测线索热度下降（不再互动），触发回访虾跟进 | 时间衰减函数 + 告警 | P1 |

**闭环位置**: ⑤-B → ⑥ (高意向线索传给回访虾跟进) + ⑤-B → ⑦ (线索数据传给金算虾统计)

---

### 📋 ⑥ 回访虾 (Followup) — 成交跟进层

**当前能力**: 推进成交、二次激活、跟进 SOP

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多触点跟进编排** | 跨渠道跟进（私信→微信→电话→邮件），按 SOP 步骤推进 | 任务编排 + 渠道适配 | P0 |
| **跟进话术个性化** | 根据用户之前的互动记录，个性化生成跟进内容 | lobster-memory 召回 + LLM | P0 |
| **定时提醒** | 到达跟进时间点自动提醒销售/触发自动跟进 | cron 调度 + 消息推送 | P0 |
| **沉默用户唤醒** | 对长时间沉默的潜在客户，发送唤醒内容（新优惠/新案例/节日问候） | 时间触发 + 唤醒话术模板 | P1 |
| **成交标记回写** | 成交后标记线索状态为"已成交"，回写到 CRM 和金算虾 | CRM API + 状态机 | P0 |
| **复购/续费提醒** | 对已成交客户，到期前触发续费/复购提醒 | CRM 数据 + cron | P1 |
| **NPS/满意度收集** | 成交后自动发送满意度调查 | 问卷模板 + 自动发送 | P2 |

**闭环位置**: ⑥ → ⑦ (成交/跟进数据传给金算虾做 ROI 计算)

---

### 💰 ⑦ 金算虾 (Abacus) — ROI 复盘层

**当前能力**: 评分、ROI、归因、反馈回写

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **多触点归因分析** | 首触归因/末触归因/线性归因/时间衰减归因 | 归因模型 + 数据链路 | P0 |
| **内容 ROI 排行** | 每条内容的获客成本/转化率/GMV 贡献排行 | 数据聚合 + 可视化 | P0 |
| **渠道 ROI 对比** | 各平台的获客成本/转化率对比 | 跨渠道数据汇总 | P0 |
| **策略效果报告** | 每周/每月自动生成策略效果报告（含建议调整） | LLM 总结 + 数据图表 | P0 |
| **预算消耗追踪** | 追踪 AI 调用成本 + 付费推广成本 | Token 计量 + 广告 API | P1 |
| **策略反馈闭环** | 将效果数据反馈给脑虫虾，自动调整下一轮策略参数 | policy_bandit 更新 | P0 |
| **异常指标告警** | 关键指标（转化率/获客成本/互动率）异常波动时告警 | 基线检测 + 告警推送 | P1 |
| **竞品效果对标** | 对比我方 vs 竞品的内容效果（互动量/增粉速度） | 触须虾数据 + 对比分析 | P2 |

**闭环位置**: ⑦ → ① (效果报告 + 策略调整建议反馈给触须虾和脑虫虾，开启下一轮循环)

---

### 🧠 Commander (指挥官) — 全局调度层

**当前能力**: 目标解释、阵容选择、工作分配、审批控制、结果合并

**需要补充的能力**:

| 新技能 | 说明 | 实现方式 | 优先级 |
|--------|------|---------|--------|
| **全链路编排** | 根据策略类型，自动编排 ①→②→③→④→⑤→⑥→⑦ 的完整链路 | 动态图构建器增强 | P0 |
| **异常中断处理** | 链路中任一环节失败/超时时，自动决定重试/跳过/降级 | 状态机 + 决策树 | P0 |
| **资源竞争仲裁** | 多个策略同时竞争同一批边缘执行器时，按优先级分配 | 优先级队列 + 资源锁 | P1 |
| **跨客户隔离** | SaaS 多租户场景下，确保不同客户的龙虾实例互不干扰 | 租户隔离 + 上下文注入 | P0 |
| **全局仪表盘数据** | 汇总所有龙虾的运行状态、任务进度、成功率，供 Web 展示 | 数据聚合 + API | P1 |
| **自动复盘触发** | 每个策略执行周期结束后，自动触发金算虾的复盘流程 | cron + 事件触发 | P0 |

---

## 三、完整闭环中的关键数据流

```
┌────────────────────────────────────────────────────────────────────┐
│                    Commander 全局编排                              │
│                                                                    │
│  ┌──────┐  SignalBrief  ┌──────────┐  StrategyRoute  ┌────────┐ │
│  │触须虾 │─────────────→│ 脑虫虾   │────────────────→│吐墨虾  │ │
│  │Radar │←─────────────│Strategist│                  │Inkwrite│ │
│  └──┬───┘  效果反馈     └──────────┘                  └───┬────┘ │
│     │                                                      │      │
│     │ metrics                                    CopyPack  │      │
│     │                                                      ▼      │
│  ┌──┴───┐               ┌──────────┐  素材包    ┌────────┐      │
│  │金算虾 │               │ 点兵虾   │←──────────│幻影虾  │      │
│  │Abacus│               │Dispatcher│            │Visual. │      │
│  └──┬───┘               └──┬───────┘            └────────┘      │
│     │                       │                                     │
│     │ ROI报告          任务下发 (WSS)                             │
│     │                       │                                     │
│     │                  ═════╪═════════════════ 边缘层 ═══════     │
│     │                       ▼                                     │
│     │              ┌──────────────────┐                           │
│     │              │ 边缘执行器 × N   │                           │
│     │              │ (发布/互动/采集)  │                           │
│     │              └────────┬─────────┘                           │
│     │                       │ 事件上报                            │
│     │                  ═════╪═════════════════ 云端层 ═══════     │
│     │                       ▼                                     │
│     │  ┌──────┐  线索评估  ┌──────┐  高意向   ┌──────┐          │
│     │  │回声虾 │──────────→│铁网虾│─────────→│回访虾│          │
│     │  │Echoer│           │Catch.│          │Follow│          │
│     │  └──────┘           └──┬───┘          └──┬───┘          │
│     │                        │                  │               │
│     │← ─ ─ ─ ─ 线索数据 ─ ─ ┘   成交数据 ─ ─ ─┘               │
│     │                                                            │
└─────┴────────────────────────────────────────────────────────────┘
```

---

## 四、技能注册表更新（补充到 CODEX-OCM-01）

以下新技能需要补充注册到 `LobsterSkillRegistry`：

### 触须虾新技能 (6个)
```python
registry.register(LobsterSkill(
    id="radar_hotspot_monitor", name="全网热点监控",
    description="监控微博/抖音/小红书热搜和热点话题",
    bound_lobsters=["radar"], category="信号采集",
    config_fields=[
        SkillConfigField(key="platforms", label="监控平台", field_type=SkillFieldType.TEXT,
                        default_value="weibo,douyin,xiaohongshu"),
        SkillConfigField(key="refresh_interval", label="刷新间隔(分钟)", field_type=SkillFieldType.NUMBER,
                        default_value="30"),
    ],
))
registry.register(LobsterSkill(
    id="radar_competitor_track", name="竞品内容追踪",
    description="自动追踪指定竞品账号的新内容动态",
    bound_lobsters=["radar"], category="信号采集",
    config_fields=[
        SkillConfigField(key="competitor_accounts", label="竞品账号列表", field_type=SkillFieldType.TEXTAREA,
                        placeholder="每行一个账号ID"),
    ],
))
```

### 吐墨虾新技能 (4个)
```python
registry.register(LobsterSkill(
    id="inkwriter_multiplatform_adapt", name="多平台文案适配",
    description="同一核心信息适配抖音/小红书/微信/B站等不同平台格式",
    bound_lobsters=["inkwriter"], category="内容生产",
    config_fields=[
        SkillConfigField(key="target_platforms", label="目标平台", field_type=SkillFieldType.TEXT,
                        default_value="douyin,xiaohongshu,wechat"),
    ],
))
registry.register(LobsterSkill(
    id="inkwriter_banned_word_check", name="违禁词检测",
    description="文案发布前检测敏感词/广告法违禁词/平台违规词",
    bound_lobsters=["inkwriter"], category="风控",
))
registry.register(LobsterSkill(
    id="inkwriter_dm_script", name="私信话术链",
    description="生成多轮私信跟进话术（破冰→兴趣探测→需求挖掘→促成交）",
    bound_lobsters=["inkwriter"], category="互动",
))
```

### 幻影虾新技能 (7个) ⭐
```python
registry.register(LobsterSkill(
    id="visualizer_ai_prompt", name="AI 绘图提示词生成",
    description="根据文案和分镜生成 Midjourney/SD/DALL-E 提示词",
    bound_lobsters=["visualizer"], category="视觉生产",
))
registry.register(LobsterSkill(
    id="visualizer_image_gen", name="AI 图片生成",
    description="调用图片生成 API 直接生成配图",
    bound_lobsters=["visualizer"], category="视觉生产",
    config_fields=[
        SkillConfigField(key="image_provider", label="图片生成服务", field_type=SkillFieldType.SELECT,
                        options=[
                            SkillSelectOption("midjourney", "Midjourney"),
                            SkillSelectOption("stable_diffusion", "Stable Diffusion"),
                            SkillSelectOption("dalle", "DALL-E"),
                            SkillSelectOption("flux", "Flux"),
                        ]),
        SkillConfigField(key="image_api_key", label="API Key", field_type=SkillFieldType.PASSWORD),
    ],
))
registry.register(LobsterSkill(
    id="visualizer_digital_human_script", name="数字人视频脚本",
    description="根据文案生成数字人口播视频脚本（含语速/表情/手势标注）",
    bound_lobsters=["visualizer"], category="视频生产",
))
registry.register(LobsterSkill(
    id="visualizer_digital_human_video", name="数字人视频生成",
    description="调用数字人平台 API 生成口播视频",
    bound_lobsters=["visualizer"], category="视频生产",
    config_fields=[
        SkillConfigField(key="dh_provider", label="数字人平台", field_type=SkillFieldType.SELECT,
                        options=[
                            SkillSelectOption("heygen", "HeyGen"),
                            SkillSelectOption("did", "D-ID"),
                            SkillSelectOption("silicon", "硅基智能"),
                            SkillSelectOption("tencent_zhiying", "腾讯智影"),
                        ]),
        SkillConfigField(key="dh_api_key", label="API Key", field_type=SkillFieldType.PASSWORD),
        SkillConfigField(key="avatar_id", label="数字人形象 ID", field_type=SkillFieldType.TEXT),
    ],
))
registry.register(LobsterSkill(
    id="visualizer_video_edit", name="视频剪辑",
    description="生成剪辑指令并调用剪辑引擎执行（字幕/BGM/转场/特效）",
    bound_lobsters=["visualizer"], category="视频生产",
))
registry.register(LobsterSkill(
    id="visualizer_subtitle_gen", name="字幕生成",
    description="从视频/音频自动生成字幕（SRT/ASS）",
    bound_lobsters=["visualizer"], category="视频生产",
    config_fields=[
        SkillConfigField(key="stt_provider", label="语音识别服务", field_type=SkillFieldType.SELECT,
                        options=[
                            SkillSelectOption("whisper", "OpenAI Whisper"),
                            SkillSelectOption("xunfei", "讯飞语音"),
                        ]),
    ],
))
registry.register(LobsterSkill(
    id="visualizer_cover_design", name="封面图设计",
    description="生成吸引点击的封面图（含文字排版建议）",
    bound_lobsters=["visualizer"], category="视觉生产",
))
```

### 点兵虾新技能 (3个)
```python
registry.register(LobsterSkill(
    id="dispatcher_scheduled_publish", name="定时发布",
    description="按最佳发布时间窗口定时发布到各平台",
    bound_lobsters=["dispatcher"], category="调度执行",
))
registry.register(LobsterSkill(
    id="dispatcher_multi_account_rotate", name="多账号轮转",
    description="同一平台多个账号轮转发布，避免单账号限流",
    bound_lobsters=["dispatcher"], category="调度执行",
))
registry.register(LobsterSkill(
    id="dispatcher_emergency_takedown", name="紧急下架",
    description="检测到风险时自动下架/隐藏已发布内容",
    bound_lobsters=["dispatcher"], category="风控",
))
```

### 回声虾新技能 (3个)
```python
registry.register(LobsterSkill(
    id="echoer_comment_manage", name="评论区管理",
    description="置顶优质评论、隐藏负面评论、回复热门评论",
    bound_lobsters=["echoer"], category="互动",
))
registry.register(LobsterSkill(
    id="echoer_dm_auto_reply", name="私信自动回复",
    description="根据用户意图自动回复私信（分流：咨询/投诉/意向）",
    bound_lobsters=["echoer"], category="互动",
))
registry.register(LobsterSkill(
    id="echoer_wechat_funnel", name="私信→微信引流",
    description="在私信中引导用户添加微信（合规话术+时机判断）",
    bound_lobsters=["echoer"], category="转化",
))
```

### 铁网虾新技能 (2个)
```python
registry.register(LobsterSkill(
    id="catcher_crm_push", name="线索自动入 CRM",
    description="高分线索自动写入超级海港 CRM 创建线索卡",
    bound_lobsters=["catcher"], category="线索管理",
))
registry.register(LobsterSkill(
    id="catcher_cross_platform_dedup", name="跨平台线索去重",
    description="同一用户在多个平台的线索合并为一个",
    bound_lobsters=["catcher"], category="线索管理",
))
```

### 回访虾新技能 (2个)
```python
registry.register(LobsterSkill(
    id="followup_multi_touch", name="多触点跟进编排",
    description="跨渠道跟进（私信→微信→电话→邮件），按SOP步骤推进",
    bound_lobsters=["followup"], category="客户跟进",
))
registry.register(LobsterSkill(
    id="followup_dormant_wake", name="沉默用户唤醒",
    description="对长时间沉默的潜在客户发送唤醒内容",
    bound_lobsters=["followup"], category="客户跟进",
))
```

### 金算虾新技能 (3个)
```python
registry.register(LobsterSkill(
    id="abacus_multi_touch_attribution", name="多触点归因分析",
    description="首触/末触/线性/时间衰减多种归因模型",
    bound_lobsters=["abacus"], category="数据分析",
))
registry.register(LobsterSkill(
    id="abacus_strategy_report", name="策略效果报告",
    description="每周/每月自动生成策略效果报告（含调整建议）",
    bound_lobsters=["abacus"], category="数据分析",
))
registry.register(LobsterSkill(
    id="abacus_feedback_loop", name="策略反馈闭环",
    description="将效果数据反馈给脑虫虾，自动调整下一轮策略参数",
    bound_lobsters=["abacus"], category="闭环优化",
))
```

---

## 五、总技能数量统计

| 龙虾 | 已有基础技能 | 新增技能 | 合计 |
|------|------------|---------|------|
| 触须虾 | 2 | 6 | 8 |
| 脑虫虾 | 1 | 6 | 7 |
| 吐墨虾 | 1 | 4 | 5 |
| 幻影虾 | 1 | 7 | **8** ⭐ |
| 点兵虾 | 1 | 3 | 4 |
| 回声虾 | 1 | 3 | 4 |
| 铁网虾 | 1 | 2 | 3 |
| 金算虾 | 1 | 3 | 4 |
| 回访虾 | 1 | 2 | 3 |
| **合计** | **10** | **36** | **46** |

---

## 六、实施优先级

### P0 — 必须有（闭环最小集）
1. 幻影虾：AI 提示词生成 + AI 图片生成 + 数字人视频脚本 + 数字人视频生成
2. 吐墨虾：多平台文案适配 + 违禁词检测 + 私信话术链
3. 点兵虾：定时发布 + 多账号轮转 + 跨平台内容同步
4. 回声虾：评论区管理 + 私信自动回复 + 私信→微信引流
5. 铁网虾：线索自动入 CRM + 跨平台线索去重
6. 触须虾：全网热点监控 + 竞品内容追踪 + 内容效果反馈接收
7. 脑虫虾：多平台投放策略 + 内容日历排期 + 策略自适应调整
8. 回访虾：多触点跟进编排 + 成交标记回写
9. 金算虾：多触点归因 + 策略效果报告 + 策略反馈闭环
10. Commander：全链路编排 + 异常中断处理 + 自动复盘触发

### P1 — 增强（提升竞争力）
- 幻影虾：视频剪辑 + 字幕生成 + 多尺寸适配
- 其他龙虾 P1 技能

### P2 — 远期
- 直播间互动、多语言、BGM 匹配等
