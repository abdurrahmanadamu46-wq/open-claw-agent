# PROJECT_CONTROL_CENTER

> Last Updated: 2026-04-03 skills backfill 已执行、PostHog 埋点链路已验证、lobster-memory 压缩服务独立验证通过、industry_workflow_context runtime 消费补齐（`1a111e2`）、管理员 TOTP MFA + OIDC + SCIM + 企业 IdP orchestration 上线；前端 /operations/prompts 真实结构页上线，`prompt-registry.ts` / `module-registry.ts` / `file-loader.ts` / `customer-mind-map.ts` 已补齐，等 NestJS 代理解锁 (Asia/Shanghai)
> Purpose: 任何新进入的 AI 或人类在 10 分钟内理解项目现状，并知道代码、API、前端页面该对齐到哪里。

### 状态图例

| 标记 | 含义 |
| --- | --- |
| ✅ | 已合并到 `main@0633224`（主线稳定） |
| 🔵 | 工作区已完成，待合并到主线（workspace-complete, not in main@0633224） |
| 🟡 | 部分完成 / 设计存在但实现不完整 |
| ❌ | 未开始 |

## 一、项目定位

**龙虾池 v2 = 单核运行时 + 共享记忆底座 + 角色化执行协议**

> 一个统一运行时、一个共享组织记忆底座、一个统一治理与进化中枢，在任务执行时按严格角色协议实例化为不同龙虾身份的 AI 增长操作系统。

**三层架构**：底层统一运行时 → 中层共享记忆与治理底座 → 上层 1 个 Commander + 9 个稳定角色化执行身份

### ⚠️ 龙虾本质定义（红线级，所有文档/代码/AI须严格遵守）

**龙虾不是独立 Agent，龙虾是统一运行时按角色协议实例化的岗位身份。**

| 维度 | 独立 Agent 模式（已放弃） | 龙虾池 v2（统一运行时 + 角色协议）|
|------|--------------------------|----------------------------------|
| 定位 | 多个平级独立 agent | 单一运行时，按角色协议实例化的稳定岗位身份 |
| 记忆 | 各自局部记忆，存在信息孤岛 | **共享记忆底座**，角色切换不丢失上下文 |
| 驱动方式 | 各自自主感知-规划-行动 | Commander 编排优先，统一运行时按协议实例化执行 |
| 服务模式 | 单任务独占 | **同时服务多个客户/租户**，按优先级并发处理 |
| 角色切换 | 不适用（各自独立） | 协议化实例化，不是随意换提示词 |
| 治理 | 角色漂移、责任模糊 | 审计先于自治，每次执行可追踪、可回放 |
| 进化 | 各自独立学习，数据碎片化 | 统一 battle log → skills_v3 → 全角色受益 |

> 任何将龙虾描述为"独立 Agent"、设计"各自独立记忆"、"多 OpenClaw 部署"或"随意换 prompt 的角色切换"的方案，均违反本项目核心架构原则。

- TS / JSON 设计时真相源：`packages/lobsters/`、`packages/usecase-templates/`
- Python 运行时：`dragon-senate-saas-v2/`
- NestJS 控制面代理：`backend/src/ai-subservice/`
- Next.js 运营控制台：`web/src/app/operations/`

## 二、10 个角色详解（OpenClaw 统一运行时角色协议库）

> 角色链路闭环：`radar → strategist → inkwriter → visualizer → dispatcher → echoer → catcher → followup → abacus → strategist`（循环进化）
> Commander 在全链路上方做编排与仲裁，任何角色异常都可升级至 Commander。

---

### 0. Commander — 元老院总脑（编排中枢）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `commander` |
| **主工件** | `MissionPlan`（任务链 + 依赖关系 + 验收标准） |
| **角色定位** | 全局编排与仲裁，不执行业务，只调度角色 |
| **核心能力** | 目标拆解 / 阵容编排 / 风险仲裁 / 结果合并 / 自动复盘 |
| **工具权限** | `workflow_catalog` / `approval_gate` / `lobster_event_bus` |
| **禁止行为** | 不替下游角色直接产出内容 / 不跳过审批 / 不偏袒单一路线 |
| **触发条件** | 任何角色遇到高风险、冲突、阻塞超 15 分钟 → 自动升级至 Commander |
| **实现文件** | `dragon-senate-saas-v2/commander_router.py` / `commander_graph_builder.py` |
| **配置文件** | `packages/lobsters/lobster-commander/SOUL.md` / `AGENTS.md` |

**闭环验证**：Commander 是唯一能感知全链路状态的角色，`MissionPlan` 里的任务链必须覆盖从 radar 到 abacus 的所有步骤，并在 `working.json` 里持续更新状态。

---

### 1. Radar — 触须虾（信号发现层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `radar` |
| **主工件** | `SignalBrief`（事实/推断/建议分层 + 来源可信度 + 影响等级） |
| **角色定位** | 全网信号采集、噪音过滤、竞品观察、舆情预警 |
| **核心能力** | 热点趋势监测 / 竞品动态追踪 / 风险舆情预警 / 用户画像反馈 |
| **工具权限** | `agent_reach` / `industry_kb_read` / `competitor_db_rw` |
| **禁止行为** | 不做策略拍板 / 不猜测竞品内部数据 / 不用不道德手段获取信息 |
| **前置角色** | 无（全链路起点，由定时任务或 Commander 触发） |
| **后继角色** | `strategist`（SignalBrief 触发） / 高风险 → `commander` |
| **降级策略** | 数据源超时 → 用 24h 内缓存，标 `signal_status: degraded` |
| **实现文件** | `dragon-senate-saas-v2/research_radar_fetchers.py` / `research_radar_ranker.py` / `research_radar_store.py` |
| **配置文件** | `packages/lobsters/lobster-radar/SOUL.md` / `AGENTS.md` |

**输出质检要求**：`signal_summary` 必须区分事实/推断/建议；`source_reliability` 标注 high/medium/low；`impact_level=high` 时必须触发事件总线通知 Commander。

---

### 2. Strategist — 脑虫虾（策略制定层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `strategist` |
| **主工件** | `StrategyRoute`（主路线 + 备选路线 + 风险等级 + 停止条件） |
| **角色定位** | 把信号变成可执行战略方案，为下游创作角色输出明确任务语言 |
| **核心能力** | 目标拆解 / 渠道资源配置 / A/B 实验设计 / 风险控制 / 撤退条件 |
| **工具权限** | `workflow_catalog` / `industry_kb_read` / `policy_bandit` |
| **禁止行为** | 不替 inkwriter/visualizer 做落地内容 / 不把猜测当结论 |
| **前置角色** | `commander`（任务目标） + `radar`（SignalBrief） |
| **后继角色** | `inkwriter`（文案任务） + `visualizer`（视觉方向） |
| **进化闭环** | `abacus` ROI 连续 2 轮低于预期 → 自动触发 Strategist 修订 |
| **降级策略** | 无行业 KB → 通用框架降级，注明 `kb_fallback: true` |
| **实现文件** | `dragon-senate-saas-v2/growth_strategy_engine.py` / `policy_bandit.py` / `experiment_registry.py` |
| **配置文件** | `packages/lobsters/lobster-strategist/SOUL.md` / `AGENTS.md` |

**输出质检要求**：`StrategyRoute` 必须包含主路线 + 至少 1 个备选；每条路线有适用条件和停止条件；风险等级显式标注。

---

### 3. InkWriter — 吐墨虾（文案生产层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `inkwriter` |
| **主工件** | `CopyPack`（稳妥版 + 加压版 × 平台适配 + 合规检测结果） |
| **角色定位** | 把策略翻译成人会停下来读、会回应、会行动的内容 |
| **核心能力** | 多平台文案 / 风格人群适配 / 违禁词检测与改写 / SEO 标签 / CTA 设计 |
| **工具权限** | `copy_generator` / `policy_lexicon` / `hashtag_engine` / `compliance_checker` / `industry_kb_read` |
| **禁止行为** | 不直接发布 / 不用违禁词绝对化承诺 / 不把所有人当同一受众 |
| **前置角色** | `strategist`（StrategyRoute） |
| **后继角色** | `visualizer`（配图场景文案） + `dispatcher`（含发布 hint） |
| **状态机** | IDLE → DRAFTING → CHECKING → DONE / REWRITING → ESCALATING |
| **降级策略** | 无 StrategyRoute → task_description 直接生成，注明"主题降级" |
| **实现文件** | `dragon-senate-saas-v2/lobster_runner.py`（执行层）+ `prompt_registry.py` / `prompt_asset_loader.py` |
| **配置文件** | `packages/lobsters/lobster-inkwriter/SOUL.md` / `AGENTS.md` |

**输出质检要求**：`CopyPack` 必须含稳妥版 + 加压版两套；每套含场景文案/钩子句/CTA；合规检测结果记录在 `compliance_flag`；包含给 visualizer 的配图方向关键词。

---

### 4. Visualizer — 幻影虾（视觉/视频生产层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `visualizer` |
| **主工件** | `StoryboardPack`（镜头清单 + 封面方向 + 素材依赖清单） |
| **角色定位** | 把文字变成能被看懂、能被信任、能被执行的视觉与分镜方案 |
| **核心能力** | 分镜设计 / 视觉方向 / AI 图片/视频生成 / 素材生产约束控制 / 证据密度把控 |
| **工具权限** | `comfyui` / `image_api` / `subtitle_engine` / `video_editor` / `industry_kb_read` |
| **禁止行为** | 不用虚假素材冒充实拍证据 / 不忽略平台安全区 / 不输出无法落地的分镜 |
| **前置角色** | `inkwriter`（CopyPack + 配图关键词） + `strategist`（平台风格指导） |
| **后继角色** | `dispatcher`（StoryboardPack + 素材依赖表） |
| **状态机** | IDLE → STORYBOARDING → ASSET_CHECK → DONE / PARTIAL → ESCALATING |
| **降级策略** | 实拍素材不足 → AI 生成方案，标注 `asset_source: ai_generated` |
| **实现文件** | `dragon-senate-saas-v2/video_composer.py` / `comfyui_adapter.py` / `im_media_pipeline.py` / `media_cost_optimizer.py` |
| **配置文件** | `packages/lobsters/lobster-visualizer/SOUL.md` / `AGENTS.md` |

**输出质检要求**：`shot_list` 每条包含镜头功能/内容描述/建议时长；`cover_direction` 确认平台尺寸安全区；AI 生成素材标注来源；素材依赖缺口清单列出。

---

### 5. Dispatcher — 点兵虾（分发调度层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `dispatcher` |
| **主工件** | `ExecutionPlan`（账号 × 时间 × 素材 × 平台 一一对应的发布队列） |
| **角色定位** | 把准备好的内容变成稳定执行，让每一步按时按号按规则发生 |
| **核心能力** | 任务拆包 / 定时排期 / 执行验证 / 风险控制 / 异常止损与回滚 |
| **工具权限** | `scheduler` / `edge_gateway` / `account_router` / `industry_kb_read` |
| **禁止行为** | 不跳过审批直接发 / 不同时把所有账号推上去 / 不伪装失败为成功 |
| **前置角色** | `inkwriter`（CopyPack） + `visualizer`（StoryboardPack） |
| **后继角色** | `echoer`（已发布内容通知）+ `catcher`（新内容线索触发） |
| **状态机** | IDLE → VALIDATING → SCHEDULING → EXECUTING → VERIFYING → DONE / ROLLBACK → ESCALATING |
| **执行架构** | **云端 Dispatcher 只负责调度决策**，把 ExecutionPlan 通过 `edge_outbox` 下发给客户设备上的轻量 Edge 客户端；**实际发布动作由 Edge 客户端用客户设备本地 IP 执行**（`content_publisher.py` + `browser_engine.py`），云端永远不直接操作账号 |
| **实现文件** | 云端：`dragon-senate-saas-v2/media_post_pipeline.py` / `publish_scheduler.py` / `channel_account_manager.py` / `edge_outbox.py`<br>边缘：`edge-runtime/content_publisher.py` / `edge-runtime/browser_engine.py` / `edge-runtime/wss_receiver.py` / `edge-runtime/platform_adapters/` |
| **配置文件** | `packages/lobsters/lobster-dispatcher/SOUL.md` / `AGENTS.md` |

**输出质检要求**：每个发布动作账号+时间+素材+平台一一对应；合规审核已通过；异常处理路径已预定义；`working.json` 已更新。

---

### 6. Echoer — 回声虾（互动转化层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `echoer` |
| **主工件** | `EngagementReplyPack`（情绪判断 + 回复内容 + 意向路由标记） |
| **角色定位** | 把冷内容变成热互动，把评论区和私信里的犹豫变成真实对话 |
| **核心能力** | 评论区承接 / 私信自动回复 / 情绪降温 / 互动到线索桥接 / 品牌声音维护 |
| **工具权限** | `humanizer` / `trend_context` / `dm_router` / `industry_kb_read` |
| **禁止行为** | 不和用户硬杠 / 不暴露"我是 AI" / 不群发复制粘贴 / 不承诺价格效果 |
| **前置角色** | `dispatcher`（事件总线通知：已发布内容） |
| **后继角色** | `catcher`（`lead_intent: high`） / `followup`（`needs_followup: true`） / 高风险舆情 → `commander` |
| **状态机** | IDLE → MONITORING → REPLYING → ROUTING → DONE / LEAD_PASS / FOLLOWUP_PASS / ESCALATING |
| **实现文件** | `dragon-senate-saas-v2/lobster_auto_responder.py` / `lobster_im_channel.py` / `clawteam_inbox.py` |
| **配置文件** | `packages/lobsters/lobster-echoer/SOUL.md` / `AGENTS.md` |

**输出质检要求**：每条回复明确情绪判断；高意向互动已标记并路由给 catcher；公开场合未展开复杂细节；行业语气符合 `industry_kb_context` 规范。

---

### 7. Catcher — 铁网虾（线索识别层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `catcher` |
| **主工件** | `LeadAssessment`（线索评分 + 入库建议 + 去重结果 + 风险标签） |
| **角色定位** | 把互动里的"热空气"筛掉，把真正值得追的人捞出来 |
| **核心能力** | 线索识别 / 多维度评分 / 跨平台去重合并 / 高风险过滤 / CRM 入库 |
| **工具权限** | `lead_scoring` / `crm_bridge` / `dedup_engine` |
| **禁止行为** | 不把围观当成交线索 / 不为好看数据抬高评分 / 不批量导出线索 |
| **前置角色** | `echoer`（高意向互动） |
| **后继角色** | `followup`（高潜线索） + `abacus`（价值数据同步） |
| **实现文件** | `dragon-senate-saas-v2/lead_conversion_fsm.py` / `customer_mind_map.py` / `followup_subagent_store.py` |
| **配置文件** | `packages/lobsters/lobster-catcher/SOUL.md` / `AGENTS.md` |

**输出质检要求**：未完成关键信息采集不得判高分；去重结果可追溯；高风险线索单独标记；CRM 写入执行去重。

---

### 8. FollowUp — 回访虾（成交跟进层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `followup` |
| **主工件** | `FollowUpActionPlan`（多触点跟进计划 + 节奏 + 阶段状态 + 成交回写） |
| **角色定位** | 把"已接住的人"持续往前推，会看时机、控节奏、长期陪跑 |
| **核心能力** | 多触点跟进（私信/评论/电话/邮件）/ 沉默线索唤醒 / 节奏管理 / 成交记录 / 长期关系维护 |
| **工具权限** | `followup_scheduler` / `voice_call` / `dm_followup` |
| **禁止行为** | 不高压逼单 / 不连续轰炸 / 不伪造紧迫感 / 不越权承诺条件 |
| **前置角色** | `catcher`（LeadAssessment 高潜线索） + 人工审批口 |
| **后继角色** | `abacus`（成交结果 + 阶段状态回写） |
| **实现文件** | `dragon-senate-saas-v2/followup_subagent_store.py` / `escalation_manager.py` / `lobster_trigger_rules.py` |
| **配置文件** | `packages/lobsters/lobster-followup/SOUL.md` / `AGENTS.md` |

**输出质检要求**：每次跟进有明确理由和目标；沉默线索优先轻提醒；成交和流失都要回写原因。

---

### 9. Abacus — 金算虾（ROI 复盘层）

| 属性 | 内容 |
|------|------|
| **canonical_id** | `abacus` |
| **主工件** | `ValueScoreCard`（渠道归因 + ROI 分析 + 复盘报告 + 反馈建议） |
| **角色定位** | 把结果、成本、转化算清楚，让整个系统知道赚在哪、漏在哪、下一轮该修哪 |
| **核心能力** | 价值评估 / 多触点归因 / 周报/阶段复盘 / 口径治理 / 反馈闭环 |
| **工具权限** | `roi_engine` / `attribution_model` / `report_builder` |
| **禁止行为** | 不美化数据 / 不硬做因果 / 不偷换指标定义 / 不删改原始数据 |
| **前置角色** | `catcher`（线索数据） + `followup`（成交数据） |
| **后继角色** | `strategist`（反馈修订策略）+ `radar`（信号重新定向）← **这里完成闭环** |
| **进化触发** | ROI 连续 2 轮低于预期 → 自动触发 `strategist` 修订 `StrategyRoute` |
| **实现文件** | `dragon-senate-saas-v2/attribution_engine.py` / `funnel_analyzer.py` / `lobster_cost_api.py` / `lobster_metrics_history.py` |
| **配置文件** | `packages/lobsters/lobster-abacus/SOUL.md` / `AGENTS.md` |

**输出质检要求**：所有结论对得上口径；好看和真实冲突时选真实；短期价值和长期价值分开看；报告必须落到下一步动作。

---

### 角色链路总图

```
                    ┌─────────────────────────────────────────┐
                    │           Commander（编排中枢）            │
                    │  MissionPlan / 仲裁 / 异常接管 / 复盘      │
                    └──────────┬──────────────────────────────┘
                               │ 编排下发 / 异常升级
          ┌────────────────────▼──────────────────────┐
          │              信号与策略层                    │
          │  Radar ──SignalBrief──▶ Strategist          │
          │  (触须虾)               (脑虫虾)             │
          │                         │ StrategyRoute      │
          └─────────────────────────┼──────────────────┘
                                    │
          ┌─────────────────────────▼──────────────────┐
          │              内容生产层                      │
          │  InkWriter ──CopyPack──▶ Visualizer         │
          │  (吐墨虾)                (幻影虾)            │
          │                         │ StoryboardPack     │
          └─────────────────────────┼──────────────────┘
                                    │
          ┌─────────────────────────▼──────────────────┐
          │              执行与互动层                    │
          │  Dispatcher ──发布──▶ Echoer                │
          │  (点兵虾)              (回声虾)              │
          │                         │ 高意向互动         │
          └─────────────────────────┼──────────────────┘
                                    │
          ┌─────────────────────────▼──────────────────┐
          │              线索与成交层                    │
          │  Catcher ──LeadAssessment──▶ FollowUp       │
          │  (铁网虾)                    (回访虾)        │
          │                              │ 成交数据       │
          └──────────────────────────────┼─────────────┘
                                         │
          ┌──────────────────────────────▼─────────────┐
          │              复盘与进化层                    │
          │  Abacus (金算虾) — ValueScoreCard           │
          │  ROI归因 / 渠道复盘 / 口径治理               │
          └──────┬──────────────┬───────────────────────┘
                 │              │
                 ▼              ▼
           Strategist        Radar
         （修订策略）      （调整扫描方向）
              ← ← ← ← ← ← 闭环完成 ← ← ← ← ← ←
```

**闭环说明**：
1. Radar 发现信号 → Strategist 制定策略 → InkWriter/Visualizer 生产内容 → **云端 Dispatcher 排期调度** → **Edge 客户端用本地 IP 真实发布** → Echoer 承接互动 → Catcher 识别线索 → FollowUp 跟进成交 → Abacus 复盘归因 → 结果反馈回 Strategist 和 Radar → **下一轮更优**
2. 任意环节异常 → Commander 介入仲裁
3. BattleLog 自动记录每次执行 → quality_score EMA 驱动角色技能持续进化

## 三、当前成熟能力

### Python Runtime

- ✅ `dragon_senate.py` / `commander_router.py` / `commander_graph_builder.py`
- ✅ `lobster_runner.py` 统一执行引擎
- ✅ `lobster_skill_registry.py` / `prompt_asset_loader.py`
- ✅ `workflow_engine.py` + `workflows/content-campaign.yaml` + `workflows/account-health-check.yaml`
- ✅ `workflow_webhook.py` + `official_workflow_templates.py` + `workflow_admin.py`
- ✅ `workflow_realtime.py` + `tenant_concurrency.py` + `workflow_idempotency.py`
- ✅ `event_subjects.py` + `webhook_event_bus.py` Subject 层级化命名
- ✅ `event_bus_metrics.py` Event Bus subject 流量统计
- ✅ `workflow_loader.py` + `workflows/default_mission.yaml`
- ✅ `conversation_compactor_v2.py`
- ✅ `lobster_memory_tools.py`
- ✅ `vector_snapshot_manager.py`
- ✅ `scripts/skills_backfill_runner.py`
- ✅ `mcp_gateway.py`
- ✅ `mcp_tool_policy.py` + `mcp_tool_monitor.py`
- ✅ `tool_marketplace.py`
- ✅ `lifecycle_manager.py`
- ✅ `mobile_pairing.py` 移动端配对码 / 设备登记 / push outbox
- ✅ `auth_mfa.py` 管理员 TOTP MFA（setup / enable / disable / verify / login gate）
- ✅ `auth_oidc.py` OIDC discovery / JWKS / password grant token / userinfo / introspect
- ✅ `auth_scim.py` SCIM ServiceProviderConfig / Schemas / ResourceTypes / Users + Groups CRUD + mappedRoles
- ✅ `auth_federation.py` 外部 OIDC IdP 配置 / token exchange / authorize+callback / discover+start / provider test / 外部 subject 绑定 / 本地用户同步
- ✅ `search_api.py`
- ✅ `lobster_bootstrap.py`
- ✅ `query_expander.py`
- ✅ `lobster_config_center.py`
- ✅ `connector_credential_store.py`
- ✅ `content_citation.py`
- ✅ `artifact_classifier.py`
- ✅ `lobster_feedback_collector.py`
- ✅ `lobster_pipeline_middleware.py`
- ✅ `lobster_post_task_processor.py`
- ✅ `knowledge_base_manager.py`
- ✅ `lobster_rule_engine.py`
- ✅ `policy_engine.py` + `decision_logger.py` + `policy_bundle_manager.py`
- ✅ `lobster_auto_responder.py`
- ✅ `attribution_engine.py`
- ✅ `funnel_analyzer.py`
- ✅ `survey_engine.py`
- ✅ `nl_query_engine.py`
- ✅ `activity_stream.py` 结构化活动流（Webhook 推送 + 时间线查询）
- ✅ `cron_scheduler.py`
- ✅ `job_registry.py` Fleet 风格 Job 注册中心
- ✅ `task_scheduler.py` + `task_state_machine.py` + `rhythm_controller.py`
- ✅ `bridge_pipeline.py` 云边消息 5 层处理管道（normalize / policy / throttle / reliability / dispatch）
- ✅ `edge_outbox.py` 持久化边缘发件箱（batch delivery / ACK / exponential backoff）
- ✅ `api_snapshot_audit.py` + `edge-runtime/execution_snapshot.py` 边缘执行快照审计链路
- ✅ `session_manager.py` + `ws_connection_manager.py`
- ✅ `memory_compressor.py`
- ✅ `token_budget.py`
- ✅ `usecase_registry.py`
- ✅ `autonomy_policy.py`
- ✅ `skill_loader.py`
- ✅ `smart_routing.py`
- ✅ `failover_provider.py`
- ✅ `escalation_manager.py`
- ✅ `provider_registry.py` 热重载 + `config/providers.json` 持久化
- ✅ `tenant_context.py` 请求级租户上下文注入
- ✅ `resource_guard.py` + `rbac_permission.py` 资源粒度 RBAC
- ✅ `tenant_audit_log.py` 标准审计事件类型 + 保留策略
- ✅ `white_label_config.py` 白标品牌配置
- ✅ `feature_flags.py` Feature Flag 系统（热开关 + 渐进发布 + 本地缓存）
- ✅ `prompt_registry.py` Prompt A/B 实验支持
- ✅ `edge-runtime/feature_flag_proxy.py` 边缘 Flag 本地代理
- ✅ `intent_predictor.py`
- ✅ `restore_event.py`
- ✅ `lobsters/lobster_security.py`
- ✅ `heartbeat_engine.py` 主动巡检扩展
- ✅ `edge_scheduler.py` + `edge-runtime/jobs/`
- ✅ `edge-runtime/security_audit.py`
- ✅ `edge-runtime/edge_mcp_server.py`
- ✅ `edge-runtime/widget_server.py`
- ✅ `edge-runtime/edge_guardian.py`
- ✅ `edge-runtime/edge_auth.py`
- ✅ `edge-runtime/edge_telemetry.py`
- ✅ `edge-runtime/protocol_adapter.py`
- ✅ `edge-runtime/edge_meta_cache.py`
- ✅ `edge_device_twin.py`
- ✅ `backup_manager.py` + `edge-runtime/scripts/backup.sh` / `restore.sh`
- ✅ `langfuse_tracer.py` + `observability_api.py`（Trace / Span / Generation）
- ✅ `alert_engine.py`（质量 / 错误率 / 边缘离线告警）
- ✅ `chart_annotation.py` + `annotation_sync.py`
- ✅ `edge_telemetry_store.py` + `api_edge_telemetry.py`
- ✅ `edge-runtime/telemetry_buffer.py`
- ✅ Agent OS 文件体系：`SOUL.md / AGENTS.md / BOOTSTRAP.md / heartbeat.json / working.json`
- ✅ 10 只龙虾首次激活协议：`packages/lobsters/lobster-*/BOOTSTRAP.md`
- ✅ `provider_registry.py` / `finetune_data_export.py`
- ✅ `lobster_pool_manager.py` (per-step reward / RL trace 部分)
- ✅ `channel_account_manager.py` / `config_generator.py`
- ✅ `base_lobster.py` 增加 `mcp_call()` 方法
- ✅ `llm_call_logger.py` LLM 调用全量日志记录（token/cost/latency/status）
- ✅ `prompt_registry.py` Prompt 版本管理 + A/B 实验 + Diff 视图
- ✅ `dataset_store.py` 微调数据集管理
- ✅ `llm_quality_judge.py` LLM 输出质量自动评判
- ✅ `experiment_registry.py` 通用实验注册表 + 多版本对比
- ✅ `hallucination_metric.py` 上下文幻觉指标
- ✅ `online_eval_sampler.py` 生产流量在线采样评测
- ✅ `answer_relevance_metric.py` 答案切题度指标
- ✅ `retrieval_quality_metric.py` 检索质量指标（context precision / recall）
- ✅ `rag_testset_generator.py` + `scripts/generate_rag_testset.py` RAG 测试集生成
- ✅ `log_enrich_pipeline.py` 结构化日志 enrich 管道
- ✅ `log_query_api.py` SQL 日志查询 API
- ✅ `edge_node_group.py` 边缘节点分组/树结构
- ✅ `lobster_trigger_rules.py` 条件触发规则引擎
- ✅ `lobster_metrics_history.py` 龙虾历史时序指标
- ✅ `intake_form.py` 公开需求收集表单
- ✅ `lobster_doc_store.py` 龙虾文档库（Markdown + 版本）
- ✅ `quota_middleware.py` 租户配额中间件
- ✅ `batch_export.py` 批量数据导出
- ✅ `observability_api.py` 可观测性 API
- ✅ `filter_utils.py` 统一过滤工具
- ✅ `task_queue.py` 异步任务队列
- ✅ `module_registry.py` 能力 Module 注册表
- ✅ `lobster_task_dag.py` 龙虾任务 DAG 编排
- ✅ `lobster_mailbox.py` 龙虾间消息邮箱
- ✅ `lobster_circuit_breaker.py` 熔断器（CircuitBreaker）
- ✅ `ssrf_guard.py` SSRF 防护
- ✅ `lobster_task_waiter.py` 任务等待/阻塞机制
- ✅ `lobster_session.py` 龙虾会话管理
- ✅ `lobster_clone_manager.py` 龙虾克隆管理
- ✅ `lobster_evolution_engine.py` 龙虾进化引擎（技能成长）
- ✅ `workflow_event_log.py` 工作流事件日志
- ✅ `dynamic_config.py` 动态配置中心
- ✅ `enterprise_memory.py` 企业记忆存储
- ✅ `context_engine.py` 龙虾上下文引擎（精选上下文 + token 预算）
- ✅ `customer_mind_map.py` 客户知识地图（已知/未知维度追踪）
- ✅ `file_loader.py` 多格式文件加载器（PDF/Word/Excel/Text）
- ✅ `memory_extractor.py` + `memory_conflict_resolver.py` 自动事实提取与记忆冲突更新
- ✅ `graph_namespace.py` + `temporal_knowledge_graph.py` 时序知识图谱与租户命名空间
- ✅ `services/lobster-memory/` Hybrid Search（Dense + Sparse + RRF）
- ✅ `lead_conversion_fsm.py` 线索转化状态机
- ✅ `lobster_failure_reason.py` 龙虾失败原因精确分类
- ✅ `lobster_cost_api.py` 龙虾维度成本分析 API
- ✅ `enterprise_onboarding.py` 企业入驻流程
- ✅ `growth_strategy_engine.py` 增长策略引擎
- ✅ `lobster_im_channel.py` 龙虾 IM 渠道适配
- ✅ `campaign_lifecycle_manager.py` 营销活动生命周期管理
- ✅ `lobster_voice_style.py` 龙虾声音/风格管理
- ✅ `industry_insight_store.py` 行业洞察存储
- ✅ `regional_agent_system.py` 区域代理商系统
- ✅ `saas_pricing_model.py` SaaS 定价模型
- ✅ `video_composer.py` 视频合成器
- ✅ `artifact_store.py` 产物存储（龙虾输出物）
- ✅ `api_governance_routes.py` API 治理路由
- ✅ `tenant_audit_log.py` 租户审计日志（标准事件类型）
- ✅ `platform_governance.py` 平台治理
- ✅ `bridge_protocol.py` 云边桥接协议
- ✅ `tenant_memory_sync.py` 租户记忆同步
- ✅ `webhook_event_bus.py` Webhook 事件总线
- ✅ `saas_billing.py` SaaS 计费系统
- ✅ `lobster_pool_manager.py` 龙虾池并发管理
- ✅ `conversation_compactor.py` 对话压缩器
- ✅ `commander_graph_builder.py` Commander 图构建
- ✅ `api_lobster_realtime.py` 龙虾实时 API（SSE/WebSocket）
- ✅ `api_lobster_realtime.py` 执行步骤摘要（`action_summary` / `why`）
- ✅ `skill_frontmatter.py` 技能前置条件管理
- ✅ `rbac_permission.py` RBAC 权限系统
- ✅ `sdk/__init__.py` Python SDK 入口
- ✅ `edge-runtime/edge_heartbeat.py` 边缘心跳
- ✅ `edge-runtime/task_schema.py` 边缘任务 Schema
- ✅ `dragon_dashboard.html` 龙虾运营控制台（含任务看板 Tab）
- ✅ `workflows/content-campaign-14step.yaml` 14步内容营销工作流
- ✅ `workflows/system_error_notifier.yaml` 通用错误通知工作流

### TS Design-Time

- ✅ `packages/lobsters/lobster-*/role-card.json`
- ✅ `packages/lobsters/lobster-*/SOUL.md`
- ✅ `packages/lobsters/lobster-*/AGENTS.md`
- ✅ `packages/lobsters/lobster-*/BOOTSTRAP.md`
- ✅ `packages/lobsters/strategy-intensity-framework.json`
- ✅ `packages/usecase-templates/schema.json` + 15 个 `uc-*.json`
- 🟡 `packages/lobsters/lobster-*/prompts/`
  目录基础已存在，但 9 只业务虾尚未完成全量统一标准化

### 控制面

- ✅ `/operations/skills-pool`
- ✅ `/operations/strategy`
- ✅ `/operations/scheduler`
- ✅ `/operations/workflows`
- ✅ `/operations/workflows/[id]/executions`
- ✅ `/operations/workflows/[id]/triggers`
- ✅ `/operations/workflows/[id]/edit`
- ✅ `/operations/workflows/templates`
- ✅ `/operations/mcp`
- ✅ `/operations/knowledge-base`
- ✅ `/operations/lobster-config`
- ✅ `/operations/memory`
- ✅ `/operations/usecases`
- ✅ `/operations/sessions`
- ✅ `/operations/channels`
- ✅ `/lobsters`
- ✅ `/lobsters/runs`
- ✅ `/lobsters/[id]` Backstage 风格实体详情页
- ✅ 全局搜索 `Cmd/Ctrl + K`（`GlobalSearch.tsx`）
- ✅ `DangerActionGuard.tsx` 统一危险操作确认
- ✅ `entity-menus/*` 右键快捷操作菜单
- ✅ `AppSidebar.tsx` 统一 Blocks 风格侧边栏骨架
- ✅ `EntityListPage.tsx` 统一列表页骨架
- ✅ `ui/chart.tsx` + `components/charts/*` 图表组件层
- ✅ `ui/Form.tsx` + `react-hook-form` + `zod` 统一表单验证体系
- ✅ `components/data-table/DataTable.tsx` + `hooks/useServerDataTable.ts`
- ✅ `/operations/alerts`
- ✅ `/operations/traces`
- ✅ `/analytics/attribution`
- ✅ `/analytics/funnel`
- ✅ `/fleet` 内嵌边缘调试终端
- ✅ `/settings/widget`
- ✅ 前端 i18n 国际化（`next-intl`，中英双语，默认中文）
- ✅ `backend/src/common/` 安全中间件：operation audit / RSA decrypt / rate limit
- ✅ `web/src/lib/rsa-crypto.ts` 前端敏感字段加密工具

## 三·五、工作区已完成但未合并到 main@0633224 的模块（🔵）

> 后端工程师 gap 分析报告（2026-04-03）确认：Batch 1-6 已全部合并（commits 3ce3959 → eae7425）。  
> 截至本次同步，原遗留的 `skills_backfill_runner.py` 生产回填已执行，`_record_posthog_analytics_run()` 端到端链路已验证，当前无新的 workspace-only 后端遗留项。

## 四、当前 API 状态

### 已完成

- ✅ `GET /api/skills`
- ✅ `GET /api/skills/{skill_id}`
- ✅ `POST /api/mobile/pair/code`
- ✅ `POST /api/mobile/pair`
- ✅ `POST /api/notify/push`
- ✅ `GET /api/v1/auth/mfa/status`
- ✅ `POST /api/v1/auth/mfa/setup`
- ✅ `POST /api/v1/auth/mfa/enable`
- ✅ `POST /api/v1/auth/mfa/disable`
- ✅ `POST /api/v1/auth/mfa/verify`
- ✅ `GET /.well-known/openid-configuration`
- ✅ `GET /oauth2/jwks`
- ✅ `GET /oauth2/authorize`（显式返回 password grant only）
- ✅ `POST /oauth2/token`
- ✅ `GET /oauth2/userinfo`
- ✅ `POST /oauth2/introspect`
- ✅ `GET/POST/PUT/DELETE /api/v1/auth/sso/providers`
- ✅ `POST /api/v1/auth/sso/providers/{provider_id}/test`
- ✅ `GET /api/v1/auth/sso/discover`
- ✅ `POST /auth/sso/exchange`
- ✅ `GET /auth/sso/start`
- ✅ `GET /auth/sso/providers/{provider_id}/authorize`
- ✅ `GET /auth/sso/callback`
- ✅ `GET /scim/v2/ServiceProviderConfig`
- ✅ `GET /scim/v2/Schemas`
- ✅ `GET /scim/v2/ResourceTypes`
- ✅ `GET/POST /scim/v2/Users`
- ✅ `GET/PUT/PATCH/DELETE /scim/v2/Users/{id}`
- ✅ `GET/POST /scim/v2/Groups`
- ✅ `GET/PUT/PATCH/DELETE /scim/v2/Groups/{id}`
- ✅ `GET /api/usecases`
- ✅ `GET /api/usecases/categories`
- ✅ `GET /api/usecases/{usecase_id}`
- ✅ `GET /api/scheduler/tasks`
- ✅ `POST /api/scheduler/tasks`
- ✅ `DELETE /api/scheduler/tasks/{task_id}`
- ✅ `GET /api/scheduler/tasks/{task_id}/history`
- ✅ `GET /api/workflow/list`
- ✅ `POST /api/workflow/run`
- ✅ `GET /api/workflow/run/{run_id}`
- ✅ `POST /api/workflow/run/{run_id}/resume`
- ✅ `POST /api/workflow/run/{run_id}/pause`
- ✅ `GET /api/workflow/runs`
- ✅ `GET /api/v1/workflows`
- ✅ `GET /api/v1/workflows/{workflow_id}`
- ✅ `PUT /api/v1/workflows/{workflow_id}`
- ✅ `GET /api/v1/workflows/{workflow_id}/lifecycle`
- ✅ `PUT /api/v1/workflows/{workflow_id}/lifecycle`
- ✅ `GET /api/v1/workflows/{workflow_id}/executions`
- ✅ `GET /api/v1/workflows/executions/{execution_id}`
- ✅ `GET /api/v1/workflows/executions/{execution_id}/stream`
- ✅ `POST /api/v1/workflows/executions/{execution_id}/replay`
- ✅ `GET /api/v1/workflows/{workflow_id}/webhooks`
- ✅ `POST /api/v1/workflows/{workflow_id}/webhooks`
- ✅ `DELETE /api/v1/workflows/{workflow_id}/webhooks/{webhook_id}`
- ✅ `GET /api/v1/workflow-templates`
- ✅ `POST /api/v1/workflow-templates/{template_id}/use`
- ✅ `GET/POST /webhook/workflows/{webhook_id}`
- ✅ `GET /api/v1/tenant/concurrency-stats`
- ✅ `GET /api/v1/admin/concurrency-overview`
- ✅ `GET /api/v1/edges/{edge_id}/twin`
- ✅ `PATCH /api/v1/edges/{edge_id}/twin/desired`
- ✅ `GET /api/v1/edges/twin-overview`
- ✅ `GET /api/v1/search`
- ✅ `GET /api/v1/lobsters`
- ✅ `GET /api/v1/lobsters/runs`
- ✅ `GET /api/v1/lobsters/{id}`
- ✅ `GET /api/v1/lobsters/{id}/stats`
- ✅ `GET /api/v1/lobsters/{id}/runs`
- ✅ `GET /api/v1/lobsters/{id}/skills`
- ✅ `GET /api/v1/lobsters/{id}/docs`
- ✅ `GET /api/v1/lobsters/{id}/lifecycle`
- ✅ `PUT /api/v1/lobsters/{id}/lifecycle`
- ✅ `POST /api/v1/lobsters/{id}/execute`
- ✅ `GET /api/v1/lobsters/{id}/quality-stats`
- ✅ `GET /edge/pull/{edge_id}`
- ✅ `POST /edge/ack/{outbox_id}`
- ✅ `POST /edge/snapshots/report`
- ✅ `GET /api/v1/snapshots`
- ✅ `GET /api/v1/snapshots/{snapshot_id}`
- ✅ `GET /api/v1/snapshots/{snapshot_id}/replay`
- ✅ `GET /api/v1/lobster-config`
- ✅ `GET /api/v1/lobster-config/{lobster_id}`
- ✅ `PATCH /api/v1/lobster-config/{lobster_id}`
- ✅ `POST /api/v1/query-expander/expand`
- ✅ `GET /api/v1/widget/config`
- ✅ `PUT /api/v1/widget/config`
- ✅ `GET /api/v1/widget/script/{widget_id}`
- ✅ `POST /api/v1/widget/message`
- ✅ `POST /api/v1/widget/{session_id}/close`
- ✅ `GET /api/v1/connectors/credentials`
- ✅ `GET /api/v1/connectors/credentials/{connector}`
- ✅ `PUT /api/v1/connectors/credentials/{connector}`
- ✅ `DELETE /api/v1/connectors/credentials/{connector}`
- ✅ `POST /api/v1/feedbacks`
- ✅ `GET /api/v1/feedbacks/{task_id}`
- ✅ `GET /api/v1/feedbacks/export`
- ✅ `GET /api/lobster/notifications`
- ✅ `GET /api/lobster/steps`
- ✅ `GET /api/v1/knowledge-bases`
- ✅ `POST /api/v1/knowledge-bases`
- ✅ `GET /api/v1/knowledge-bases/{kb_id}`
- ✅ `POST /api/v1/knowledge-bases/{kb_id}/documents`
- ✅ `POST /api/v1/knowledge-bases/{kb_id}/bind/{lobster_id}`
- ✅ `GET /api/v1/knowledge-bases/{kb_id}/search`
- ✅ `POST /api/v1/artifacts/classify`
- ✅ `GET /api/v1/artifacts/{artifact_id}/render`
- ✅ `GET /api/v1/rule-engine/rules`
- ✅ `POST /api/v1/rule-engine/rules`
- ✅ `DELETE /api/v1/rule-engine/rules/{rule_id}`
- ✅ `POST /api/v1/rule-engine/evaluate`
- ✅ `GET /api/v1/policies`
- ✅ `POST /api/v1/policies`
- ✅ `PUT /api/v1/policies/{rule_id}`
- ✅ `DELETE /api/v1/policies/{rule_id}`
- ✅ `POST /api/v1/policies/evaluate`
- ✅ `GET /api/v1/policies/bundle/current`
- ✅ `POST /api/v1/policies/bundle/publish`
- ✅ `GET /api/v1/audit/decisions`
- ✅ `GET /api/v1/audit/decisions/stats`
- ✅ `GET /api/v1/audit/decisions/{log_id}`
- ✅ `GET /api/v1/analytics/attribution`
- ✅ `GET /api/v1/analytics/funnel`
- ✅ `POST /api/v1/analytics/nl-query`
- ✅ `GET /api/v1/cost/lobsters`
- ✅ `GET /api/v1/cost/lobsters/{lobster_id}`
- ✅ `GET /api/v1/cost/lobsters/{lobster_id}/timeseries`
- ✅ `GET /api/v1/surveys`
- ✅ `POST /api/v1/surveys`
- ✅ `GET /api/v1/surveys/{survey_id}/results`
- ✅ `POST /api/v1/surveys/respond`
- ✅ `POST /api/v1/edge/telemetry/batch`
- ✅ `GET /api/v1/edge/telemetry/runs`
- ✅ `GET /api/v1/alerts/rules`
- ✅ `POST /api/v1/alerts/rules`
- ✅ `PUT /api/v1/alerts/rules/{rule_id}`
- ✅ `POST /api/v1/alerts/evaluate`
- ✅ `GET /api/v1/alerts/events`
- ✅ `GET /api/v1/alerts/channels`
- ✅ `POST /api/v1/alerts/channels`
- ✅ `GET /api/observability/traces`
- ✅ `GET /api/observability/traces/{trace_id}`
- ✅ `GET /api/observability/chart/annotations`
- ✅ `POST /api/v1/logs/query`
- ✅ `GET /api/v1/logs/templates`
- ✅ `GET /api/v1/edge/groups/tree`
- ✅ `GET /api/v1/edge/groups/node-map`
- ✅ `GET /api/v1/edge/groups/{group_id}/nodes`
- ✅ `POST /api/v1/edge/groups`
- ✅ `POST /api/v1/edge/groups/{group_id}/nodes/{node_id}`
- ✅ `DELETE /api/v1/edge/groups/{group_id}/nodes/{node_id}`
- ✅ `GET /api/v1/lobster-trigger-rules`
- ✅ `POST /api/v1/lobster-trigger-rules`
- ✅ `PUT /api/v1/lobster-trigger-rules/{rule_id}`
- ✅ `DELETE /api/v1/lobster-trigger-rules/{rule_id}`
- ✅ `POST /api/v1/lobster-trigger-rules/evaluate`
- ✅ `GET /api/v1/activities`
- ✅ `GET /api/v1/activities/{activity_id}`
- ✅ `GET /api/v1/jobs/registry`
- ✅ `GET /api/v1/modules`
- ✅ `GET /api/v1/leads/{tenant_id}/{lead_id}/conversion-status`
- ✅ `GET /api/v1/leads/{tenant_id}/{lead_id}/conversion-history`
- ✅ `POST /api/v1/files/parse`
- ✅ `POST /api/v1/files/extract-business-card`
- ✅ `GET /api/v1/mind-map/{tenant_id}/{lead_id}`
- ✅ `GET /api/v1/mind-map/{tenant_id}/{lead_id}/questions`
- ✅ `GET /api/v1/mind-map/{tenant_id}/{lead_id}/briefing`
- ✅ `POST /api/v1/mind-map/{tenant_id}/{lead_id}/nodes/{dimension}`
- ✅ `GET /api/v1/graph/{tenant_id}/snapshot`
- ✅ `GET /api/v1/graph/{tenant_id}/timeline`
- ✅ `GET /api/v1/metrics/lobster/{lobster_name}/history`
- ✅ `GET /intake/{tenant_slug}`
- ✅ `POST /intake/{tenant_slug}`
- ✅ `GET /api/v1/intake/list`
- ✅ `POST /api/v1/intake/{intake_id}/accept`
- ✅ `POST /api/v1/intake/{intake_id}/reject`
- ✅ `GET /api/v1/tasks/kanban`
- ✅ `GET /api/v1/docs`
- ✅ `GET /api/v1/docs/{doc_id}`
- ✅ `PUT /api/v1/docs/{doc_id}`
- ✅ `GET /api/v1/docs/{doc_id}/versions`
- ✅ `GET /api/memory/wisdoms`
- ✅ `GET /api/memory/reports`
- ✅ `GET /api/memory/stats`
- ✅ `POST /api/v1/memory/hybrid-search`
- ✅ `POST /api/v1/vector-backup/trigger`
- ✅ `GET /api/v1/vector-backup/snapshots/{collection_name}`
- ✅ `GET /api/v1/vector-backup/history`
- ✅ `GET /api/sessions`
- ✅ `GET /api/sessions/{session_id}/history`
- ✅ `DELETE /api/sessions/{session_id}`
- ✅ `GET /api/strategy/intensity`
- ✅ `POST /api/strategy/intensity/escalate`
- ✅ `POST /api/strategy/intensity/deescalate`
- ✅ `GET /api/autonomy/policy`
- ✅ `PUT /api/autonomy/policy`
- ✅ `GET /api/v1/crypto/public-key`
- ✅ `GET /api/v1/audit/logs`
- ✅ `GET /api/v1/providers/health`
- ✅ `GET /api/v1/providers`
- ✅ `POST /api/v1/providers`
- ✅ `PUT /api/v1/providers/{id}`
- ✅ `DELETE /api/v1/providers/{id}`
- ✅ `POST /api/v1/providers/{id}/reload`
- ✅ `POST /api/v1/providers/{id}/smoke`
- ✅ `GET /api/v1/providers/{id}/metrics`
- ✅ `GET /api/v1/bootstrap/{session_id}/{lobster_id}`
- ✅ `POST /api/v1/bootstrap/{session_id}/{lobster_id}/reset`
- ✅ `GET /api/v1/rbac/permissions`
- ✅ `POST /api/v1/rbac/permissions`
- ✅ `DELETE /api/v1/rbac/permissions/{id}`
- ✅ `GET /api/v1/rbac/users/{user_id}/permissions`
- ✅ `POST /api/v1/rbac/check`
- ✅ `GET /api/v1/rbac/matrix`
- ✅ `GET /api/v1/audit/event-types`
- ✅ `GET /api/v1/audit/events`
- ✅ `POST /api/v1/audit/cleanup`
- ✅ `GET /api/v1/feature-flags`
- ✅ `POST /api/v1/feature-flags`
- ✅ `GET /api/v1/feature-flags/{name}`
- ✅ `PUT /api/v1/feature-flags/{name}`
- ✅ `DELETE /api/v1/feature-flags/{name}`
- ✅ `POST /api/v1/feature-flags/{name}/enable`
- ✅ `POST /api/v1/feature-flags/{name}/disable`
- ✅ `POST /api/v1/feature-flags/{name}/strategies`
- ✅ `POST /api/v1/feature-flags/{name}/variants`
- ✅ `POST /api/v1/feature-flags/check`
- ✅ `GET /api/v1/feature-flags/changelog`
- ✅ `POST /api/v1/feature-flags/export`
- ✅ `POST /api/v1/feature-flags/import`
- ✅ `GET /api/v1/feature-flags/edge`
- ✅ `WS /api/v1/feature-flags/ws`
- ✅ `GET /api/v1/prompt-experiments`
- ✅ `POST /api/v1/prompt-experiments`
- ✅ `GET /api/v1/prompt-experiments/{flag_name}/report`
- ✅ `POST /api/v1/prompt-experiments/{flag_name}/promote`
- ✅ `POST /api/v1/prompt-experiments/{flag_name}/stop`
- ✅ `GET /api/v1/experiments`
- ✅ `POST /api/v1/experiments`
- ✅ `GET /api/v1/experiments/{experiment_id}`
- ✅ `GET /api/v1/experiments/compare`
- ✅ `POST /api/v1/experiments/{experiment_id}/run`
- ✅ `GET /api/v1/prompts`
- ✅ `GET /api/v1/prompts/{prompt_name}/versions`
- ✅ `GET /api/v1/prompts/{prompt_name}/diff`
- ✅ `POST /api/v1/rag/testsets/generate`
- ✅ `GET /api/v1/white-label/resolve`
- ✅ `GET /api/v1/white-label/{tenant_id}`
- ✅ `GET /api/v1/white-label/{tenant_id}/preview`
- ✅ `PUT /api/v1/white-label/{tenant_id}`
- ✅ `POST /api/v1/white-label/{tenant_id}/logo`
- ✅ `DELETE /api/v1/white-label/{tenant_id}`
- ✅ `GET /api/v1/escalations`
- ✅ `POST /api/v1/escalations/{id}/resolve`
- ✅ `GET /api/v1/heartbeat/active-check`
- ✅ `GET /api/v1/heartbeat/active-check/history`
- ✅ `GET /api/v1/commander/suggested-intents`
- ✅ `GET /api/v1/restore-events`
- ✅ `GET /api/v1/security/dlp-alerts`
- ✅ `POST /api/v1/security/dlp-alerts`
- ✅ `GET /api/v1/mcp/servers`
- ✅ `POST /api/v1/mcp/servers`
- ✅ `DELETE /api/v1/mcp/servers/{id}`
- ✅ `PUT /api/v1/mcp/servers/{id}`
- ✅ `GET /api/v1/mcp/servers/{id}/tools`
- ✅ `POST /api/v1/mcp/servers/{id}/ping`
- ✅ `POST /api/v1/mcp/call`
- ✅ `GET /api/v1/mcp/call/history`
- ✅ `GET /api/v1/mcp/policies`
- ✅ `PUT /api/v1/mcp/policies/{lobster_name}`
- ✅ `GET /api/v1/monitor/tools/top`
- ✅ `GET /api/v1/monitor/tools/heatmap`
- ✅ `GET /api/v1/monitor/tools/failures`
- ✅ `GET /api/v1/monitor/tools/recent`
- ✅ `GET /api/v1/tools/marketplace`
- ✅ `POST /api/v1/tools/marketplace`
- ✅ `GET /api/v1/tools/subscriptions`
- ✅ `POST /api/v1/tools/subscribe`
- ✅ `POST /api/v1/tools/unsubscribe`
- ✅ `GET /api/security/reports`
- ✅ `POST /api/security/audit/trigger`
- ✅ `POST /api/security/baseline/rebuild`
- ✅ `GET /llm/router/status` / `GET /llm/router/metrics` / `POST /llm/router/smoke`

### 部分完成

- 🟡 技能效力校准 API
  已有种子评级和展示基础，自动校准器待补
- 🟡 Prompt 管理 API
  已有 loader 和部分目录，尚未形成完整的在线管理面

## 五、当前风险与阻塞

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| `dragon_senate.py` 仍是固定 DAG 主图 | ✅ | `commander_router.py` + `commander_graph_builder.py` + `dragon_senate.py` 已并入主线，主图支持按 RoutePlan 动态组装，fallback 图的龙虾节点也改为从 `lobster_pool_manager` 注入 |
| `industry_workflow_context` 消费不完整 | ✅ | `/api/workflow/run` 已接顶层 `industry_workflow_context`，`workflow_engine.start_run()` 会归一化出 `account_info / account_config / merchant_profile / workflow_request / workflow_blueprint` 供 step 模板直接消费 |
| Prompt 资产未覆盖 9 只业务虾 | ✅ | 全部 9 只业务虾已完成 `prompt-catalog.json` 标准化 |
| Agent OS 文档仍需继续深化 | 🟡 | `BOOTSTRAP.md` 已补齐，后续主要剩 `SOUL.md / AGENTS.md` 进一步增强 |
| `skill_effectiveness_calibrator.py` 未落地 | 🟡 | `/api/v1/skills/calibrate` 已接通，后续主要剩生产 reward history 正式回灌 |
| 历史 battle_log 回填仍需正式批量执行 | ✅ | `scripts/skills_backfill_runner.py --all --apply` 已执行，当前统计 `pending_backfill = 0` |
| `services/lobster-memory/` 仍是单层服务 | ✅ | `compression_pipeline.py` 在服务目录内自带 `MemoryCompressor` 实现，不依赖 `dragon-senate-saas-v2/memory_compressor.py`；`/healthz`、`/compress/l0-to-l1`、`/compress/stats` 已独立 smoke 通过 |
| 边缘容器生命周期管理缺失 | ✅ | `edge-runtime/lifecycle_manager.py` 已补齐，边缘节点本地启动/在线/忙碌/错误/离线状态机已具备 |
| 执行监控室缺失 | ✅ | `/api/v1/workflows/executions/{id}/stream` + `/ws/execution-logs` 已落地，前端监控室可同时消费快照和实时事件 |
| 私有技能注册表网关缺失 | ✅ | `services/skill-registry-service/` Dockerfile + docker-compose 已接入，端口 8050 |
| OIDC / MFA / SCIM 认证增强未落地 | 🟡 | 管理员 TOTP MFA、OIDC 最小兼容层、SCIM Users/Groups + mappedRoles，以及企业 IdP orchestration（discover / test / start / authorize / callback）已落地；后续主要剩 SAML |
| F-P1-01 Lobster Kanban 前端接线暂停 | ✅ 阻塞已解除 | 路由实际为 `GET /api/v1/tasks/kanban`（无需传 tenantId，JWT 自动取），前端可立即接线 |
| F-P1-03 Onboarding Flow 前端接线暂停 | ✅ 阻塞已解除 | `POST /api/onboarding/complete` + `/api/v1/onboarding/complete` 已注册，前端可接线企业入驻完成流程 |
| Feature Flag 指标与导入导出仍偏基础 | 🟡 | 已有热开关、灰度、Prompt 实验和边缘代理，但可视化统计/迁移能力还可继续增强 |
| NestJS 代理层缺 leads + activities controller | ✅ | `c1a0f98` 已补 leads + activities 透传，`e182ab6` 已补 tasks/cost/policies/graph 代理，前端无需再直连 Python |

## 六、路线图状态

### P0

- [x] 会话隔离：`session_manager.py`
- [x] 用例模板系统：`packages/usecase-templates/` + `usecase_registry.py`
- [x] 定时调度基础：`cron_scheduler.py`
- [x] Layer 2 兼容外观：`task_scheduler.py` + `task_state_machine.py` + `rhythm_controller.py`
- [x] 工作流引擎：`workflow_engine.py` + `workflows/*.yaml`
- [x] Failover Provider：`failover_provider.py`
- [x] Expects Validation + Retry & Escalate：`lobster_runner.py` + `escalation_manager.py`
- [x] 主动心跳巡检：`heartbeat_engine.py` active checker
- [x] 主动意图预测：`intent_predictor.py`
- [x] Restore 完成事件：`restore_event.py`
- [x] Lossless 风格分层对话压缩：`conversation_compactor_v2.py`
- [x] Lossless 风格 KB 检索工具：`lobster_memory_tools.py`
- [x] Lossless 风格 battle log backfill 脚本：`scripts/skills_backfill_runner.py`
- [x] 技能按需加载：`skill_loader.py`
- [x] 技能 gotchas 设计时文档：`packages/lobsters/lobster-*/skills/GOTCHAS.md`
- [x] Agent OS 内容深化：10 只龙虾 `BOOTSTRAP.md` 完成
- [ ] Agent OS 进一步深化：10 只龙虾 `SOUL.md / AGENTS.md` 继续增强
- [x] 9 只业务虾 Prompt 资产全量标准化

### P1

- [x] 知识三层压缩基础：`memory_compressor.py`
- [x] 自主决策基础：`autonomy_policy.py` + API
- [x] 用例市场前端：`/operations/usecases`
- [x] 工作流控制页：`/operations/workflows`
- [x] Workflow Webhook Trigger：`workflow_webhook.py` + `/operations/workflows/[id]/triggers`
- [x] Workflow Execution Replay：`workflow_engine.py` + `/operations/workflows/[id]/executions`
- [x] Workflow Error Compensation：`workflow_engine.py` + `workflows/system_error_notifier.yaml`
- [x] Workflow Template Gallery：`official_workflow_templates.py` + `/operations/workflows/templates`
- [x] Workflow Realtime Stream：`workflow_realtime.py` + `/api/v1/workflows/executions/{id}/stream`
- [x] Tenant Concurrency Control：`tenant_concurrency.py` + `/api/v1/tenant/concurrency-stats`
- [x] Workflow Idempotency Keys：`workflow_idempotency.py` + `/api/workflow/run`
- [x] Edge Meta Cache：`edge-runtime/edge_meta_cache.py` + `edge-runtime/wss_receiver.py`
- [x] Edge Device Twin：`edge_device_twin.py` + `/api/v1/edges/*/twin`
- [x] 会话隔离前端：`/operations/sessions` + `/operations/channels`
- [x] Backstage 实体生命周期治理：`lifecycle_manager.py` + `lobsters-registry.json`
- [x] Backstage 全局搜索：`search_api.py` + `GlobalSearch.tsx`
- [x] Backstage 龙虾 EntityPage：`/lobsters/[id]`
- [x] shadcn/ui Blocks 骨架：`AppSidebar.tsx` + `EntityListPage.tsx`
- [x] shadcn/ui Charts 图表层：`ui/chart.tsx` + `components/charts/*`
- [x] shadcn/ui Form 体系：`ui/Form.tsx` + `LobsterConfigForm` + `FeatureFlagForm` + `OnboardingStep1Form`
- [x] TanStack Table 服务端模式：审计事件 + 龙虾执行记录
- [x] TanStack Table 展开 / 批量操作：执行记录展开、审计 diff 展开、工作流/渠道批量工具栏
- [x] Grafana/SigNoz 借鉴：Alert Engine
- [x] Grafana/SigNoz 借鉴：Chart Annotations
- [x] Grafana/SigNoz 借鉴：Distributed Tracing
- [x] Grafana/SigNoz 借鉴：Edge Telemetry Buffer
- [x] 策略强度历史 API
- [x] `services/lobster-memory/compression_pipeline.py` 对齐服务层

### P2

- [x] `skill_effectiveness_calibrator.py`（路由已接通，待生产 reward history 回灌）
- [x] `edge-runtime/lifecycle_manager.py`
- [x] `ws://.../ws/execution-logs` + `/operations/monitor`（前端快照已接，WS 待后端）
- [x] `services/skill-registry-service/`（Dockerfile + docker-compose 已接入）

## 七、已落地借鉴清单

| 来源 | 落地点 | 状态 | 核心文件 |
| --- | --- | --- | --- |
| Awesome Agents | Agent OS 文件体系 | 🟡 | `packages/lobsters/*/SOUL.md`, `AGENTS.md`, `BOOTSTRAP.md`, `heartbeat.json`, `working.json` |
| HiClaw | Skill gotchas / autonomy / lifecycle 思路 | 🟡 | `skill_loader.py`, `autonomy_policy.py` |
| PUAClaw | Prompt 资产 / 强度框架 / 技能评级 | 🟡 | `prompt_asset_loader.py`, `strategy-intensity-framework.json`, `lobster_skill_registry.py` |
| awesome-usecases-zh | Scheduler / memory compression / usecases / session isolation | ✅ | `cron_scheduler.py`, `task_scheduler.py`, `memory_compressor.py`, `usecase_registry.py`, `session_manager.py` |
| AntFarm | 确定性工作流引擎 | ✅ | `workflow_engine.py`, `workflows/*.yaml`, `/operations/workflows` |
| openclaw-master-skills | 结构化技能资产借鉴 | 🟡 | `skill_loader.py`、`GOTCHAS.md`、用例模板与隔离会话 |
| n8n | Workflow Webhook Trigger | ✅ | `workflow_webhook.py`, `/operations/workflows/[id]/triggers` |
| n8n | Workflow Execution Replay | ✅ | `workflow_engine.py`, `/operations/workflows/[id]/executions` |
| n8n | Error Workflow Compensation | ✅ | `workflow_engine.py`, `workflows/system_error_notifier.yaml`, `/operations/workflows/[id]/edit` |
| n8n | Workflow Template Gallery | ✅ | `official_workflow_templates.py`, `/operations/workflows/templates` |
| Trigger.dev | Workflow Realtime Stream | ✅ | `workflow_realtime.py`, `/api/v1/workflows/executions/{id}/stream`, `/operations/workflows/[id]/executions` |
| Trigger.dev | Tenant Concurrency Control | ✅ | `tenant_concurrency.py`, `/api/v1/tenant/concurrency-stats`, `ConcurrencyStatusBar.tsx` |
| Trigger.dev | Workflow Idempotency Keys | ✅ | `workflow_idempotency.py`, `/api/workflow/run`, `/webhook/workflows/{id}` |
| Fleet | 结构化 Activity Stream + JobRegistry | ✅ | `activity_stream.py`, `job_registry.py`, `/api/v1/activities`, `/api/v1/jobs/registry` |
| ZeroLeaks | 线索转化状态机 + 失败原因精确分类 | ✅ | `lead_conversion_fsm.py`, `lobster_failure_reason.py`, `lobster_runner.py` |
| LobeHub | 上下文引擎 + 文件加载器 | ✅ | `context_engine.py`, `file_loader.py`, `knowledge_base_manager.py` |
| Stanford STORM | 客户 Mind Map（知识地图） | ✅ | `customer_mind_map.py`, `/api/v1/mind-map/*` |
| KubeEdge | Edge Meta Cache（离线元数据本地缓存） | ✅ | `edge-runtime/edge_meta_cache.py`, `edge-runtime/wss_receiver.py` |
| KubeEdge | Edge Device Twin（desired vs actual 自动对齐） | ✅ | `edge_device_twin.py`, `/api/v1/edges/{edge_id}/twin`, `/fleet` |
| NATS | Event Subject 层级化命名 | ✅ | `event_subjects.py`, `webhook_event_bus.py`, `artifact_store.py` |
| EMQX | Event Bus Subject Traffic（主题流量监控） | ✅ | `event_bus_metrics.py`, `observability_api.py`, `/operations/monitor` |
| Qdrant | Hybrid Memory Search（Dense + Sparse + RRF） | ✅ | `services/lobster-memory/engine.py`, `/api/v1/memory/hybrid-search`, `/operations/memory` |
| Qdrant | Vector Snapshot Backup（定期快照备份） | ✅ | `vector_snapshot_manager.py`, `/api/v1/vector-backup/*`, `/operations/memory` |
| mem0 + graphiti | 自动事实提取 / 记忆冲突更新 / 时序知识图谱 | ✅ | `memory_extractor.py`, `memory_conflict_resolver.py`, `temporal_knowledge_graph.py` |
| Aurogen | MCP Gateway — 龙虾接入 MCP 工具生态 | ✅ | `mcp_gateway.py`, `/operations/mcp` |
| Aurogen | 前端 i18n 国际化（`next-intl`，中英双语） | ✅ | `web/src/locales/` |
| Aurogen | BOOTSTRAP 冷启动协议（2-3 轮建立工作关系） | ✅ | `lobster_bootstrap.py`, `packages/lobsters/*/BOOTSTRAP.md` |
| Aurogen | Provider 热重载（无需重启新增/更新/删除 Provider） | ✅ | `provider_registry.py`, `/settings/model-providers` |
| Onyx | Query Expander + Lobster Config Center + Embed Widget + Connector Credentials + Content Citation | ✅ | `query_expander.py`, `lobster_config_center.py`, `edge-runtime/widget_server.py`, `connector_credential_store.py`, `content_citation.py` |
| Open WebUI | Artifact Renderer + Human Feedback + Pipeline Middleware + Post Task Processor + Knowledge Base UI | ✅ | `artifact_classifier.py`, `lobster_feedback_collector.py`, `lobster_pipeline_middleware.py`, `lobster_post_task_processor.py`, `/operations/knowledge-base` |
| System Prompts & AI Tools | 执行步骤摘要 + 能力 Module 注册表 | ✅ | `api_lobster_realtime.py`, `module_registry.py`, `lobster_runner.py` |
| Wazuh | Rule Engine + Auto Response + Edge Guardian + 双向认证 | ✅ | `lobster_rule_engine.py`, `lobster_auto_responder.py`, `edge-runtime/edge_guardian.py`, `edge-runtime/edge_auth.py` |
| OPA | PolicyEngine + DecisionLogger + PolicyBundleManager | ✅ | `policy_engine.py`, `decision_logger.py`, `policy_bundle_manager.py`, `/api/v1/policies*` |
| PostHog | Attribution + Funnel + Surveys + Natural-Language Analytics Query | ✅ | `attribution_engine.py`, `funnel_analyzer.py`, `survey_engine.py`, `nl_query_engine.py`, `/analytics/*` |
| PostHog | 前端埋点 SDK（posthog-js）| ✅ F-P1-06 已接线 | `providers.tsx` 统一初始化；strategy 页埋点：页面访问、行业选择、策略提交、强度调整；`NEXT_PUBLIC_POSTHOG_KEY` 未配置时自动降级为 no-op |
| Opik | Experiment Registry（多版本评测与对比） | ✅ | `experiment_registry.py`, `/operations/experiments` |
| Opik | Hallucination Metric（基于上下文的幻觉检测） | ✅ | `hallucination_metric.py`, `llm_quality_judge.py` |
| Opik | Online Eval Sampling（生产流量采样评测） | ✅ | `online_eval_sampler.py`, `lobster_runner.py` |
| Opik | Prompt Diff View（Prompt 版本差异视图） | ✅ | `prompt_registry.py`, `/api/v1/prompts/*/diff`, `/operations/experiments` |
| RAGAS | RAG Testset Generator（自动构建 RAG 评测集） | ✅ | `rag_testset_generator.py`, `scripts/generate_rag_testset.py`, `dataset_store.py` |
| RAGAS | Retrieval Quality Metric（Context Precision / Recall） | ✅ | `retrieval_quality_metric.py`, `experiment_registry.py` |
| RAGAS | Answer Relevance Metric（答案切题度） | ✅ | `answer_relevance_metric.py`, `llm_quality_judge.py` |
| RAGAS | Parallel Eval Pipeline（并发实验评测） | ✅ | `experiment_registry.py`, `app.py` |
| ToolHive | MCP Tool Permission Policy（龙虾工具白名单 + 频率限制） | ✅ | `mcp_tool_policy.py`, `mcp_gateway.py` |
| ToolHive | MCP Tool Monitor（调用热力 / 失败率 / 最近调用） | ✅ | `mcp_tool_monitor.py`, `mcp_gateway.py`, `dragon_dashboard.html` |
| ToolHive | Tool Marketplace（工具目录 + 租户订阅） | ✅ | `tool_marketplace.py`, `/operations/mcp` |
| ToolHive | Edge Local MCP Server（边缘本地工具通过 WSS 暴露） | ✅ | `edge-runtime/edge_mcp_server.py`, `edge-runtime/wss_receiver.py`, `backend/src/gateway/fleet-websocket.gateway.ts` |
| OpenObserve | Log Enrich Pipeline（统一日志字段 + 派生字段） | ✅ | `log_enrich_pipeline.py`, `llm_call_logger.py` |
| OpenObserve | Log Query API（安全 SQL 日志查询） | ✅ | `log_query_api.py`, `/api/v1/logs/*`, `dragon_dashboard.html` |
| OpenObserve | Dashboard 视图模板 + Edge OTel Span | ✅ | `dragon_dashboard.html`, `edge-runtime/edge_telemetry.py`, `marionette_executor.py` |
| OpenRemote | Edge Node Group（边缘节点树形分组与批量操作） | ✅ | `edge_node_group.py`, `backend/src/ai-subservice/openremote.controller.ts`, `/fleet` |
| OpenRemote | Lobster Trigger Rules（When/If/Then 触发引擎） | ✅ | `lobster_trigger_rules.py`, `app.py` |
| OpenRemote | Lobster Metrics History + Protocol Adapter | ✅ | `lobster_metrics_history.py`, `edge-runtime/protocol_adapter.py`, `client_main.py` |
| Plane | Intake Form（公开需求收集 + catcher 队列） | ✅ | `intake_form.py`, `/intake/{tenant_slug}` |
| Plane | Lobster Kanban（任务看板） | ✅ | `dragon_dashboard.html`, `task_queue.py`, `/api/v1/tasks/kanban` |
| Plane | Priority Queue + Lobster Doc Store | ✅ | `task_queue.py`, `lobster_doc_store.py`, `/api/v1/docs*` |
| Keycloak | 资源粒度 RBAC（Resource × Scope × Subject） | ✅ | `rbac_permission.py`, `resource_guard.py`, `/settings/permissions` |
| Keycloak | 租户上下文中间件（Realm 隔离轻量实现） | ✅ | `tenant_context.py` |
| Keycloak | 审计事件标准化（EventType + retention） | ✅ | `tenant_audit_log.py`, `/settings/audit` |
| Keycloak | 白标主题系统（代理商品牌化） | ✅ | `white_label_config.py`, `/settings/white-label`, `/login` |
| Unleash | Feature Flag 系统（龙虾行为热开关 + 灰度发布） | ✅ | `feature_flags.py`, `/operations/feature-flags` |
| Unleash | Prompt A/B 实验（Variants + rollout） | ✅ | `prompt_registry.py`, `/operations/experiments` |
| Unleash | Edge Flag Proxy（本地缓存 + 断网自愈） | ✅ | `edge-runtime/feature_flag_proxy.py` |
| Backstage | 实体生命周期治理（experimental / production / deprecated） | ✅ | `lifecycle_manager.py`, `lobsters-registry.json` |
| Backstage | 全局搜索 Cmd/Ctrl+K | ✅ | `search_api.py`, `web/src/components/GlobalSearch.tsx` |
| Backstage | Lobster EntityPage 标签页详情页 | ✅ | `web/src/app/lobsters/[id]/page.tsx`, `web/src/components/lobster/*` |
| Radix UI Primitives | DangerActionGuard 统一危险操作确认 | ✅ | `web/src/components/DangerActionGuard.tsx`, `web/src/components/ui/AlertDialog.tsx` |
| Radix UI Primitives | ContextMenu 列表页右键快捷操作 | ✅ | `web/src/components/entity-menus/*`, `web/src/components/ui/ContextMenu.tsx` |
| shadcn/ui | Blocks 布局骨架（侧边栏 / 列表页统一框架） | ✅ | `web/src/components/layout/AppSidebar.tsx`（F-任务二：补全 feature-flags/experiments/traces/alerts/sessions/audit/permissions/white-label 导航项），`EntityListPage.tsx` |
| shadcn/ui | Charts 图表组件层（Area / Line / Radar / Bar / Pie） | ✅ | `web/src/components/ui/chart.tsx`, `web/src/components/charts/*` |
| shadcn/ui | Form 统一验证体系（zod + react-hook-form） | ✅ | `web/src/components/ui/Form.tsx`, `web/src/components/lobster/forms/LobsterConfigForm.tsx`, `web/src/components/feature-flags/FeatureFlagForm.tsx`, `web/src/components/onboarding/OnboardingStep1Form.tsx` |
| TanStack Table | DataTable 服务端模式（manual pagination / sorting） | ✅ | `web/src/components/data-table/DataTable.tsx`, `web/src/hooks/useServerDataTable.ts`, `/settings/audit`, `/lobsters/runs` |
| TanStack Table | 行展开 + 批量操作工具栏 | ✅ | `web/src/components/audit/ConfigDiffPanel.tsx`, `web/src/components/lobster/RunDetailPanel.tsx`, `/operations/workflows`, `/operations/channels` |
| Grafana + SigNoz | 告警规则引擎（Alert Engine） | ✅ | `alert_engine.py`, `/operations/alerts` |
| Grafana + SigNoz | 图表事件标注（Annotations） | ✅ | `chart_annotation.py`, `annotation_sync.py`, `ChartAnnotations.tsx` |
| Grafana + SigNoz | 分布式链路追踪（复用 Langfuse 风格 Trace/Span） | ✅ | `langfuse_tracer.py`, `observability_api.py`, `/operations/traces` |
| Grafana + SigNoz | 边缘遥测批量上报（EdgeTelemetryBuffer） | ✅ | `edge-runtime/telemetry_buffer.py`, `api_edge_telemetry.py` |
| Golutra | 边缘消息 5 层 Pipeline（normalize / policy / throttle / reliability / dispatch） | ✅ | `bridge_pipeline.py`, `bridge_protocol.py` |
| Golutra | Durable Edge Outbox（批量投递 / ACK / backoff） | ✅ | `edge_outbox.py`, `app.py`, `edge-runtime/wss_receiver.py` |
| Golutra | Execution Snapshot Audit（边缘执行快照 / 回放审计） | ✅ | `edge-runtime/execution_snapshot.py`, `api_snapshot_audit.py`, `marionette_executor.py` |
| Stanford STORM | **客户 Mind Map**（知识地图，7维度知识树，追踪已知/未知） | 🆕 P1 | `dragon-senate-saas-v2/customer_mind_map.py`（新建）|
| Stanford STORM | **苏思多视角分析**（4视角：销售/竞品/时机/风险）| 🆕 P1 | 升级 `docs/lobster-kb/strategist-susi-kb.md` |
| Stanford STORM | **运营插话 API**（运营随时注入信息，龙虾实时调整）| 🆕 P1 | `dragon-senate-saas-v2/lobster_inject_context_api.py`（新建）|
| Stanford STORM | **雷达并发多路搜索**（串行→并发，速度 3x）| 🆕 P1 | `dragon-senate-saas-v2/radar_concurrent_search.py`（新建）|
| **Manifest** | **智能 LLM 路由（Quality Score，Economy/Standard/Premium 三档）** | 🆕 P1 | `dragon-senate-saas-v2/smart_router.py`（新建）|
| **Manifest** | **龙虾预算通知系统**（每小时检查，超80%预警，超100%阻断） | 🆕 P1 | `dragon-senate-saas-v2/lobster_budget_alert.py`（新建）|
| **Manifest** | **API Key AES-256-GCM 加密金库**（商业化法律合规） | 🆕 P1 | `dragon-senate-saas-v2/api_key_vault.py`（新建）|
| **Manifest** | **龙虾维度成本分析 API**（每只龙虾 token/cost/趋势） | ✅ | `dragon-senate-saas-v2/lobster_cost_api.py` |

## 八、关键文件索引

### 运行时

- `dragon-senate-saas-v2/app.py`
- `dragon-senate-saas-v2/lobster_runner.py`
- `dragon-senate-saas-v2/workflow_engine.py`
- `dragon-senate-saas-v2/lifecycle_manager.py`
- `dragon-senate-saas-v2/search_api.py`
- `dragon-senate-saas-v2/lobster_skill_registry.py`
- `dragon-senate-saas-v2/skill_loader.py`
- `dragon-senate-saas-v2/session_manager.py`
- `dragon-senate-saas-v2/cron_scheduler.py`
- `dragon-senate-saas-v2/task_scheduler.py`
- `dragon-senate-saas-v2/task_state_machine.py`
- `dragon-senate-saas-v2/rhythm_controller.py`
- `dragon-senate-saas-v2/autonomy_policy.py`
- `dragon-senate-saas-v2/memory_compressor.py`
- `dragon-senate-saas-v2/usecase_registry.py`

### 设计时

- `packages/lobsters/`
- `packages/usecase-templates/`
- `src/agent/commander/`

### 控制面

- `web/src/app/operations/`
- `web/src/app/lobsters/[id]/page.tsx`
- `web/src/components/GlobalSearch.tsx`
- `web/src/components/layout/AppSidebar.tsx`
- `web/src/components/layout/EntityListPage.tsx`
- `web/src/components/ui/chart.tsx`
- `web/src/components/ui/Form.tsx`
- `web/src/components/data-table/DataTable.tsx`
- `web/src/hooks/useServerDataTable.ts`
- `dragon-senate-saas-v2/alert_engine.py`
- `dragon-senate-saas-v2/observability_api.py`
- `edge-runtime/telemetry_buffer.py`
- `backend/src/ai-subservice/`
- `web/src/services/endpoints/ai-subservice.ts`

## 九、红线

1. HITL 默认仍是项目红线；新增 autonomy 只是治理维度，不是无限放权。
2. 边缘只执行，不做业务决策。
3. Commander 只编排，不替龙虾干具体业务活。
4. 审计优先于性能。
5. 未验证 provider 不进主生产链。

## 十、前端对齐索引

| 功能模块 | 后端 API | 前端类型文件 | 前端页面 | 状态 |
| --- | --- | --- | --- | --- |
| 技能市场 | `GET /api/skills` | 待补统一 skill types | `/operations/skills-pool` | ✅ |
| 技能效力 | 待补自动校准详情 API | 待补 `skill-effectiveness.ts` | `/operations/skills-pool` | 🟡 |
| 策略强度 | `GET /api/strategy/intensity` | `web/src/types/strategy-intensity.ts` | `/operations/strategy` | 🟡 |
| 自主决策 | `GET/PUT /api/autonomy/policy` | `web/src/types/autonomy-policy.ts` | `/operations/strategy` 内嵌 | 🟡 |
| 定时调度 | `POST/GET /api/scheduler/tasks` | 已在 endpoint 中定义 | `/operations/scheduler` | ✅ |
| 工作流引擎 | `GET /api/workflow/*` | `web/src/types/workflow-engine.ts` | `/operations/workflows` | ✅ |
| 工作流生命周期 | `GET/PUT /api/v1/workflows/{workflow_id}/lifecycle` | `web/src/types/workflow-engine.ts` | `/operations/workflows` | ✅ |
| 工作流模板库 | `GET /api/v1/workflow-templates` + `POST /api/v1/workflow-templates/{template_id}/use` | `web/src/types/workflow-engine.ts` | `/operations/workflows/templates` | ✅ |
| 工作流执行历史/回放 | `GET /api/v1/workflows/{workflow_id}/executions` + `GET/POST /api/v1/workflows/executions/*` | `web/src/types/workflow-engine.ts` | `/operations/workflows/[id]/executions` | ✅ |
| 工作流实时流 | `GET /api/v1/workflows/executions/{execution_id}/stream` | `web/src/types/workflow-engine.ts` | `/operations/workflows/[id]/executions` | ✅ |
| Event Bus Subject 流量 | `GET /api/observability/event-bus/subjects` + `/prefix-summary` | `web/src/types/event-bus-traffic.ts` | `/operations/monitor` | ✅ |
| Hybrid Memory Search | `POST /api/v1/memory/hybrid-search` | `web/src/types/hybrid-memory-search.ts` | `/operations/memory` | ✅ |
| Vector Snapshot Backup | `POST /api/v1/vector-backup/trigger` + `GET /api/v1/vector-backup/*` | `web/src/types/vector-snapshot-backup.ts` | `/operations/memory` | ✅ |
| 工作流 Webhook 触发器 | `GET/POST/DELETE /api/v1/workflows/{workflow_id}/webhooks*` + `GET/POST /webhook/workflows/{webhook_id}` | `web/src/types/workflow-engine.ts` | `/operations/workflows/[id]/triggers` | ✅ |
| 工作流失败补偿配置 | `GET/PUT /api/v1/workflows/{workflow_id}` | `web/src/types/workflow-engine.ts` | `/operations/workflows/[id]/edit` | ✅ |
| 租户并发控制 | `GET /api/v1/tenant/concurrency-stats` | `web/src/types/tenant-concurrency.ts` | `/operations/workflows` 顶部状态条 | ✅ |
| 工作流幂等键 | `POST /api/workflow/run` + `GET/POST /webhook/workflows/{id}` | `web/src/types/workflow-engine.ts` | `/operations/workflows` 触发链路内建 | ✅ |
| Edge Meta Cache | `POST /edge/heartbeat`（actual state 携带 cache snapshot） | 复用 `RemoteNode` / `FleetNodeRecord` | `/fleet` 摘要区块 | ✅ |
| Edge Device Twin | `GET/PATCH /api/v1/edges/*/twin` + `GET /api/v1/edges/twin-overview` | 复用 `RemoteNode` / `FleetNodeRecord` | `/fleet` | ✅ |
| 全局搜索 | `GET /api/v1/search` | `web/src/types/search.ts` | 全局 `Cmd/Ctrl+K` 面板 | ✅ |
| 龙虾实体页 | `GET /api/v1/lobsters/{id}` + `/stats` + `/runs` + `/skills` + `/docs` | `web/src/types/lobster.ts` | `/lobsters` + `/lobsters/[id]` | ✅ |
| 生命周期治理 | `GET/PUT /api/v1/lobsters/{id}/lifecycle` | `web/src/types/lobster.ts` | `/lobsters/[id]` | ✅ |
| 危险操作确认 | `onConfirm: () => Promise<void>` | `DangerActionGuardProps` | `DangerActionGuard` | ✅ |
| 右键快捷菜单 | 复用实体 CRUD / lifecycle / execute API | `entity-menus/*` | 龙虾池 / 工作流 / Fleet 列表页 | ✅ |
| Blocks 布局骨架 | 复用现有页面 API | 复用现有 types | `AppSidebar` + `EntityListPage`（已接 `/campaigns`、`/operations/channels`） | ✅ |
| 图表组件层 | 复用 dashboard / lobster / channels 现有 API | `web/src/components/charts/*` | `/`、`/dashboard/lobster-pool`、`/lobsters/[id]`、`/operations/channels` | ✅ |
| 表单验证体系 | 复用 lobster / feature-flag / tenant 现有 API | `ui/Form.tsx` + 表单组件类型 | `/lobsters/[id]`、`/operations/feature-flags`、`/onboard` | ✅ |
| 审计事件表格 | `GET /api/v1/audit/events` | `web/src/types/audit-log.ts` | `/settings/audit` | ✅ 服务端分页 + 行展开 |
| 龙虾执行记录表格 | `GET /api/v1/lobsters/runs` | `web/src/types/lobster.ts` | `/lobsters/runs` | ✅ 服务端分页 + 行展开 |
| 工作流批量操作 | `GET/PUT /api/v1/workflows/{workflow_id}/lifecycle` | `web/src/types/workflow-engine.ts` | `/operations/workflows` | ✅ 批量暂停/恢复/归档 |
| 渠道账号批量操作 | `GET /api/v1/ai/channels/status` + `PUT /api/v1/ai/channels/*` | 复用 `ChannelAccountSummary` | `/operations/channels` | ✅ 批量切换 dm_scope |
| 告警规则引擎 | `GET/POST/PUT /api/v1/alerts/*` | `web/src/types/alert-engine.ts` | `/operations/alerts` | ✅ |
| 图表事件标注 | `GET /api/observability/chart/annotations` | `web/src/types/chart-annotation.ts` | 已接执行趋势图 / 质量趋势图 | ✅ |
| 分布式链路追踪 | `GET /api/observability/traces*` | `web/src/types/distributed-tracing.ts` | `/operations/traces` | ✅ |
| 边缘遥测缓冲 | `POST /api/v1/edge/telemetry/batch` | - | edge-runtime 内部能力 | ✅ |
| Provider 管理 | `GET/POST/PUT/DELETE /api/v1/providers*` | `web/src/types/provider-registry.ts` | `/settings/model-providers` | ✅ |
| 资源粒度 RBAC | `GET/POST /api/v1/rbac/*` | `web/src/types/rbac-permission.ts` | `/settings/permissions` | ✅ |
| 结构化审计事件 | `GET /api/v1/audit/event-types` / `GET /api/v1/audit/events` | `web/src/types/audit-log.ts` | `/settings/audit` | ✅ |
| 白标配置 | `GET/PUT /api/v1/white-label/*` | `web/src/types/white-label.ts` | `/settings/white-label`, `/login` | ✅ |
| Feature Flags | `GET/POST /api/v1/feature-flags*` | `web/src/services/endpoints/feature-flags.ts`（独立 endpoints 文件，F-任务三A） | `/operations/feature-flags` | ✅ 前端已接线：CRUD + enable/disable + strategies + changelog + check |
| Prompt Experiments | `GET/POST /api/v1/prompt-experiments*` | `web/src/services/endpoints/experiments.ts`（独立 endpoints 文件，F-任务三B） | `/operations/experiments` | ✅ 前端已接线：list/run/compare/diff/promote/stop |
| 实验注册表 / 在线评测 | `GET/POST /api/v1/experiments*` | `web/src/services/endpoints/experiments.ts` | `/operations/experiments` | ✅ |
| Prompt Diff | `GET /api/v1/prompts/{name}/diff` | `web/src/services/endpoints/experiments.ts` | `/operations/experiments` | ✅ |
| Prompt 注册表 | `GET /api/v1/prompts` + `GET /api/v1/prompts/{name}/versions` | `web/src/services/endpoints/prompt-registry.ts` ✅ | `/operations/prompts` | 🟡 页面已上线（真实结构，非 stub），等 NestJS 代理（`GET /api/v1/prompts` 与 `versions` 无 controller） |
| 龙虾执行步骤摘要 | `GET /api/lobster/steps` | 待补 `lobster-step-event.ts` | 待补执行时间线 / 实时卡片 | 🟡 后端已完成 |
| 能力 Module 注册表 | `GET /api/v1/modules` | `web/src/services/endpoints/module-registry.ts` ✅ | 待补 `/ai-brain/modules` | 🟡 前端类型已补，等 NestJS 代理（`GET /api/v1/modules` 无对应 controller） |
| 线索转化状态机 | `GET /api/v1/leads/{tenant_id}/{lead_id}/conversion-*` | 待补 `lead-conversion.ts` | 待补 `/crm/leads/[id]` | 🟡 NestJS 代理已补（`c1a0f98`），前端可接线 `conversion-status` / `conversion-history` |
| 客户 Mind Map | `GET/POST /api/v1/mind-map/{tenant_id}/{lead_id}*` | `web/src/services/endpoints/customer-mind-map.ts` ✅ | 待补 `/crm/leads/[id]/mind-map` | 🟡 前端类型已补，等 NestJS 代理（mind-map 路由无对应 controller） |
| 文件加载器 | `POST /api/v1/files/parse` + `/extract-business-card` | `web/src/services/endpoints/file-loader.ts` ✅ | 待补 `/operations/files` / 线索导入页 | 🟡 前端类型已补，等 NestJS 代理（files 路由无对应 controller） |
| 龙虾成本分析 | `GET /api/v1/cost/lobsters*` | 待补 `lobster-cost.ts` | `/operations/cost` | ✅ 页面已存在，后端完成，NestJS `cost.controller.ts`（`e182ab6`）已补 |
| 龙虾配置中心 | `GET/PATCH /api/v1/lobster-config*` | `web/src/types/lobster-config-center.ts` | `/operations/lobster-config` | ✅ 前端已接线（fetchLobsterConfigs / fetchLobsterConfigDetail / updateLobsterConfig） |
| 官网嵌入 Widget | `GET/PUT /api/v1/widget/config` + `GET /api/v1/widget/script/{widget_id}` | `web/src/types/embed-widget.ts` | `/settings/widget` | ✅ 前端已接线（F-P1-07）：真实嵌入代码、一键复制、iframe 预览、位置配置 |
| 查询扩展 | `POST /api/v1/query-expander/expand` | 暂复用通用返回结构 | 暂未单独出页 | ✅ 后端已完成 |
| 连接器凭证库 | `GET/PUT/DELETE /api/v1/connectors/credentials*` | 待补 connector credential types | 待接入 `/settings/integrations` | 🟡 |
| 内容引用标注 | `POST /api/v1/lobsters/{id}/execute` 返回 `citations` | 可复用 lobster/detail types | `/lobsters/[id]` / Prompt Lab 后续可接 | ✅ 后端已完成 |
| Artifact 渲染器 | `POST /api/v1/artifacts/classify` + `GET /api/v1/artifacts/{artifact_id}/render` | 组件内本地类型 | `/operations/autopilot/artifacts` | ✅ |
| 人工反馈 | `POST /api/v1/feedbacks` + `GET /api/v1/lobsters/{id}/quality-stats` | `web/src/types/lobster-feedback.ts` | `/lobsters/[id]` | ✅ |
| 知识库管理 | `GET/POST /api/v1/knowledge-bases*` | `web/src/types/knowledge-base.ts` | `/operations/knowledge-base` | ✅ |
| Pipeline 中间件 | 运行时链路内建 | 暂无独立前端类型 | 暂无独立管理页 | ✅ |
| 后台后处理任务 | 运行时链路内建 | 暂无独立前端类型 | 暂无独立管理页 | ✅ |
| 规则引擎 / 自动响应 | `GET/POST/DELETE /api/v1/rule-engine/*` + `POST /api/v1/rule-engine/evaluate` | 暂无独立前端类型 | 暂无独立管理页 | ✅ |
| OPA 策略引擎 / 决策日志 | `GET/POST/PUT/DELETE /api/v1/policies*` + `GET /api/v1/audit/decisions*` | 待补 `policy-engine.ts` | 待补 `/settings/policies` / `/settings/decisions` | 🟡 后端已完成 |
| 边缘守护 / 双向认证 | 握手与边缘运行链路内建 | 暂无前端类型 | `/fleet` 后续可补健康详情 | ✅ |
| 营销归因分析 | `GET /api/v1/analytics/attribution` | `web/src/types/attribution.ts` | `/analytics/attribution` | ✅ |
| 工作流漏斗分析 | `GET /api/v1/analytics/funnel` | `web/src/types/funnel.ts` | `/analytics/funnel` | ✅ |
| 调查系统 | `GET/POST /api/v1/surveys*` + `POST /api/v1/surveys/respond` | `web/src/types/survey.ts` | `/operations/strategy` 内嵌卡片 | ✅ |
| 自然语言数据查询 | `POST /api/v1/analytics/nl-query` | `web/src/types/nl-query.ts` | `/operations/strategy` 内嵌卡片 | ✅ |
| 日志查询 | `POST /api/v1/logs/query` / `GET /api/v1/logs/templates` | - | `dragon_dashboard.html` | ✅ |
| Edge Node Group | `GET/POST /api/v1/edge/groups*` | `web/src/types/edge-node-group.ts` | `/fleet` | ✅ |
| Lobster Trigger Rules | `GET/POST/PUT/DELETE /api/v1/lobster-trigger-rules*` | 待补 `lobster-trigger-rule.ts` | 待补策略页 | 🟡 后端已完成 |
| Lobster Metrics History | `GET /api/v1/metrics/lobster/{name}/history` | 待补 `lobster-metrics-history.ts` | 待补 `/lobsters/[id]` 趋势图 | 🟡 后端已完成 |
| Intake Form | `GET/POST /intake/{tenant_slug}` + `GET/POST /api/v1/intake/*` | - | 公开表单页 + 待补管理页 | ✅ 后端已完成 |
| Lobster Kanban | `GET /api/v1/tasks/kanban` | - | `dragon_dashboard.html` | ✅ F-P1-01 阻塞已解除：路由存在，tenantId 从 JWT 取，前端可立即接线 |
| Lobster Docs | `GET/PUT /api/v1/docs*` | 待补 `lobster-doc.ts` | 待补文档页；现有 `/lobsters/[id]` docs 接口已兼容 | 🟡 |
| RAG 测试集生成 | `POST /api/v1/rag/testsets/generate` | 待补 `rag-eval.ts` | 待补评测页/Prompt Lab 集成 | 🟡 |
| RAG 检索质量评测 | `POST /api/v1/experiments/{id}/run` | 复用 `web/src/types/ai-experiments.ts` | `/operations/experiments` | 🟡 |
| Bootstrap 状态 | `GET/POST /api/v1/bootstrap/*` | - | 待补管理页 | 🟡 |
| Retry & Escalate | `GET /api/v1/escalations` / `POST /api/v1/escalations/{id}/resolve` | 待补 escalation types | `/operations/escalations` | ✅ 前端已接线（fetchEscalations / resolveEscalation） |
| 主动心跳 | `GET /api/v1/heartbeat/active-check*` | 待补 heartbeat active types | 待补 dashboard 卡片 | 🟡 |
| 主动意图建议 | `GET /api/v1/commander/suggested-intents` | 待补 intent types | 待补对话框快捷建议 | 🟡 |
| MCP Gateway | `GET/POST /api/v1/mcp/*` | `web/src/types/mcp-gateway.ts` | `/operations/mcp` | ✅ |
| MCP Tool Policy | `GET/PUT /api/v1/mcp/policies*` | `web/src/types/mcp-gateway.ts` | `/operations/mcp` | ✅ |
| MCP Tool Monitor | `GET /api/v1/monitor/tools/*` | `web/src/types/mcp-gateway.ts` | `/operations/mcp` | ✅ |
| 边缘执行快照审计 | `GET /api/v1/snapshots*` + `POST /edge/snapshots/report` | 待补 `execution-snapshot.ts` | 待补 `/operations/edge-audit` | 🟡 |
| Tool Marketplace | `GET/POST /api/v1/tools/*` | `web/src/types/mcp-gateway.ts` | `/operations/mcp` | ✅ |
| 国际化 i18n | — | `web/src/locales/*.json` | 全部 `/operations/` 页面 + `/fleet` | ✅ |
| 记忆压缩 | `GET /api/memory/*` | 待补 `memory-compression.ts` | `/operations/memory` | ✅ 基础页已在 |
| 活动流 / JobRegistry | `GET /api/v1/activities*` + `GET /api/v1/jobs/registry` | 待补 `activity-stream.ts` | 待补 `/settings/activities` | 🟡 NestJS 代理已补（`c1a0f98`），前端可接线活动流列表和详情 |
| 时序知识图谱 | `GET /api/v1/graph/{tenant_id}/snapshot` + `/timeline` | 待补 `temporal-graph.ts` | 待补 `/crm/graph` | 🟡 后端已完成 |
| 龙虾 KB 检索工具 | 运行时工具层，待补显式 API | 待补 | 待补调试页/Prompt Lab 侧集成 | 🟡 |
| 用例市场 | `GET /api/usecases*` | 已在 endpoint 中定义 | `/operations/usecases` | ✅ |
| 会话隔离 | `GET/DELETE /api/sessions*` | `web/src/types/session-isolation.ts` | `/operations/sessions` + `/operations/channels` | ✅ |
| 安全审计 | `GET /api/v1/audit/logs` | `web/src/types/security-audit.ts` | 待补安全审计页 | 🟡 |
| RSA 敏感字段加密 | `GET /api/v1/crypto/public-key` | `web/src/lib/rsa-crypto.ts` | `/login`、`/register`、模型配置等表单 | ✅ |
| 边缘安全巡检 | `GET /api/security/reports` / `POST /api/security/audit/trigger` | 可复用 `edge-terminal.ts` 或补独立 types | `/fleet` 内嵌安全巡检区块 | ✅ |
| DLP 告警 | `GET /api/v1/security/dlp-alerts` | 待补 dlp alert types | 待补安全告警面板 | 🟡 |
| 边缘调试终端 | `WS /edge-terminal` | `web/src/types/edge-terminal.ts` | `/fleet` 内嵌终端面板 | ✅ |
| 边缘 Cron 调度 | `WS /edge-terminal` scheduler status/toggle | `web/src/types/edge-terminal.ts` | `/fleet` 内嵌终端面板 | ✅ |
| 边缘备份/还原 | `WS /edge-terminal` backup trigger/list/restore | `web/src/types/edge-terminal.ts` | `/fleet` 内嵌终端面板 | ✅ |
| Restore 历史 | `GET /api/v1/restore-events` | 待补 restore event types | 待补备份/运维页 | 🟡 |
| 智能模型路由 | `GET /llm/router/status` / `POST /llm/router/smoke` | 路由指标复用 provider / status 卡片 | `/settings/model-providers` | ✅ 基础运维页已接入 |
| Prompt 管理 | 待补完整管理 API | 待补 | `/ai-brain/prompt-lab` | 🟡 |
| 执行监控室 | `ws/execution-logs` + `GET /api/v1/monitor/snapshot` | `web/src/services/endpoints/ai-subservice.ts`（fetchExecutionMonitorSnapshot/fetchEventBusSubjects/fetchEventBusPrefixSummary 已存在） | `/operations/monitor` | 🟡 前端 REST 快照已接线；WebSocket 日志流待后端落地 |

## 十一、权威文档关系

- `docs/SYSTEM_ARCHITECTURE_OVERVIEW.md`
  回答“系统怎么分层、数据怎么流、哪些层已经落地”
- `PROJECT_CONTROL_CENTER.md`
  回答“当前做到了什么、还有什么风险、前端要去哪里对齐”

前端工程师优先看这两份，其他分析文档都视为背景材料，不再作为执行基线。
