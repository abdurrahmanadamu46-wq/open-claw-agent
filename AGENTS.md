# AGENTS.md — OpenClaw Agent 项目 AI 助手上下文
> 灵感来源：Temporal 仓库的 `.claude/` + `AGENTS.md` 设计模式
> 本文件专为 Claude / Codex / Cursor 等 AI 助手提供项目摘要，减少读错文件的概率

---

## 一、项目定位

**OpenClaw Agent** 是一个面向中小商家的 **AI 内容营销 SaaS 系统**。

核心价值链：
```
行业选题 → AI生成内容 → 云端合成视频 → 边缘自动发布 → 监控互动 → 线索跟进 → 飞书回传
```

---

## 二、仓库结构速查

```
f:/openclaw-agent/
├── dragon-senate-saas-v2/          # 🐉 云端大脑层（Python FastAPI + LangGraph）
│   ├── app.py                      # FastAPI 主入口
│   ├── lobster_runner.py           # 龙虾执行器（单龙虾调用）
│   ├── lobster_pool_manager.py     # 龙虾池（并发管理，全局信号量）
│   ├── commander_graph_builder.py  # LangGraph 有向图（工作流编排）
│   ├── workflow_event_log.py       # ⭐ 工作流事件日志持久化（Temporal Event Sourcing借鉴）
│   ├── dynamic_config.py           # ⭐ 动态配置热更新（Temporal dynamicconfig借鉴）
│   ├── bridge_protocol.py          # 云边通信协议
│   ├── provider_registry.py        # LLM Provider 注册表
│   ├── platform_governance.py      # 平台治理（租户隔离/配额）
│   ├── rbac_permission.py          # RBAC 权限控制
│   ├── saas_billing.py             # 计费模块
│   ├── webhook_event_bus.py        # Webhook 事件总线
│   ├── tenant_audit_log.py         # 租户审计日志
│   ├── video_composer.py           # 云端视频合成（MoviePy）
│   ├── lobsters/                   # 10只龙虾定义（Python）
│   │   ├── base_lobster.py         # 龙虾基类
│   │   ├── strategist.py           # 策略师龙虾
│   │   ├── inkwriter.py            # 文案龙虾
│   │   ├── visualizer.py           # 视觉龙虾
│   │   ├── dispatcher.py           # 调度龙虾
│   │   ├── followup.py             # 跟进龙虾
│   │   └── ...                     # catcher/radar/abacus/echoer
│   ├── lobsters-registry.json      # 龙虾注册表（真相源）
│   └── workflows/
│       └── content-campaign-14step.yaml  # ⭐ 14步内容营销工作流定义
│
├── edge-runtime/                   # 🔌 边缘执行层（Python，运行在客户电脑）
│   ├── wss_receiver.py             # WebSocket 接收器（云边通信）
│   ├── context_navigator.py        # 浏览器上下文导航
│   ├── marionette_executor.py      # 浏览器自动化执行器
│   ├── task_schema.py              # EdgeTaskBundle Pydantic Schema
│   └── edge_heartbeat.py           # ⭐ 边缘心跳机制（Temporal Heartbeat借鉴）
│
├── docs/                           # 📚 借鉴分析报告 + Codex 任务文档
│   ├── TEMPORAL_BORROWING_ANALYSIS.md  # Temporal 借鉴分析（最新）
│   ├── BORROWING_GAP_ANALYSIS_2026-04-01.md  # 综合借鉴差距分析
│   └── CODEX_TASK_*.md             # Codex 可执行任务文档
│
├── PROJECT_CONTROL_CENTER.md       # 📋 项目总控中心（最重要，先读这个）
├── SYSTEM_ARCHITECTURE_OVERVIEW.md # 🏗️ 系统架构总览
└── AGENTS.md                       # 本文件
```

---

## 三、10只龙虾速查

| 龙虾 | 代号 | 职责 |
|------|------|------|
| 策略师 | `strategist` | 行业选题、客户画像、策略制定 |
| 文案师 | `inkwriter` | 文案生成、口播脚本、标题封面 |
| 视觉师 | `visualizer` | 画面匹配、分镜、字幕特效、封面 |
| 调度员 | `dispatcher` | 云端归档、边缘任务下发、定时发布 |
| 跟进员 | `followup` | 电话跟进、飞书通知、录音回传 |
| 捕手 | `catcher` | 合规审核、敏感词过滤、投诉风险 |
| 雷达 | `radar` | 行业标签识别、知识库路由 |
| 算盘 | `abacus` | 评分计算、线索评分、费用统计 |
| 回声 | `echoer` | 评论监控、私信捕获、互动流 |
| 心跳 | `heartbeat` | 系统健康监控（规划中）|

---

## 四、关键架构规则（AI 助手必读）

### ❌ 绝对禁止
1. 在**边缘层**（`edge-runtime/`）做视频合成 —— 只能在云端 `video_composer.py`
2. 修改 `lobsters-registry.json` 的龙虾 ID —— 这是唯一真相源
3. 绕过 `lobster_pool_manager.py` 的全局信号量直接并发调用龙虾

### ✅ 架构铁律
1. **边缘层**：只做下载 + 发布 + 回传心跳，无 LLM 调用，无视频合成
2. **云端大脑**：LangGraph 有向图编排，`commander_graph_builder.py` 是工作流引擎
3. **事件日志**：工作流状态必须写入 `workflow_event_log.py`，支持断点续跑
4. **心跳机制**：边缘执行任务时必须每30秒通过 `edge_heartbeat.py` 上报进度
5. **动态配置**：运行时参数修改必须通过 `dynamic_config.py`，不修改环境变量

---

## 五、核心文件优先级（先读哪个）

1. `PROJECT_CONTROL_CENTER.md` — 项目总状态 + 下一步优先级
2. `SYSTEM_ARCHITECTURE_OVERVIEW.md` — 4层架构图解
3. `dragon-senate-saas-v2/lobsters-registry.json` — 龙虾注册表（真相源）
4. `dragon-senate-saas-v2/workflows/content-campaign-14step.yaml` — 14步工作流定义
5. `docs/TEMPORAL_BORROWING_ANALYSIS.md` — 最新借鉴分析（Temporal）

---

## 六、近期重要变更（2026-04-01）

从 Temporal（持久化执行平台）借鉴落地的模块：

| 文件 | 借鉴来源 | 功能 |
|------|---------|------|
| `dragon-senate-saas-v2/workflow_event_log.py` | Temporal History Service / Event Sourcing | 工作流执行事件持久化、断点续跑、Signal机制、持久化Timer |
| `edge-runtime/edge_heartbeat.py` | Temporal Activity Heartbeat | 边缘心跳上报、Long Poll 任务拉取、HeartbeatMonitor、优雅退出 |
| `dragon-senate-saas-v2/dynamic_config.py` | Temporal dynamicconfig | 运行时热更新配置、租户级别覆盖、变更回调、变更历史 |
| `dragon-senate-saas-v2/workflows/content-campaign-14step.yaml` | Temporal RetryPolicy + Signal + Timer + Versioning | 步骤级重试策略、全局超时、Signal审批、工作流版本化 |

---

## 七、常用命令

```bash
# 启动云端 SaaS
cd dragon-senate-saas-v2 && uvicorn app:app --reload --port 8000

# 启动边缘运行时
cd edge-runtime && python wss_receiver.py

# 检查动态配置
python -c "from dynamic_config import get_dynamic_config; cfg=get_dynamic_config(); print(cfg.export_snapshot())"

# 查看工作流事件日志
python -c "from workflow_event_log import WorkflowEventLog; log=WorkflowEventLog(); print(log.list_runs())"
```

---

*最后更新：2026-04-01 | 维护者：OpenClaw 架构组*
