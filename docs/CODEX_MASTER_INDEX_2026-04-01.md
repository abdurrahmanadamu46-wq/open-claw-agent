# CODEX 任务总索引 — 2026-04-01 差距分析补全批次

> **生成时间**：2026-04-01  
> **基于**：docs/BORROWING_GAP_ANALYSIS_2026-04-01.md（综合7个深度研究项目的差距分析）  
> **总任务数**：11个（G01 Smart Routing 已在前序批次中落地，G08/G09 Doctor 合并到 G07）  
> **面向对象**：Codex（代码落地）+ 前端工程师（UI/API 对接）

---

## 📋 执行顺序说明

**依赖关系**（必须按此顺序执行 P0 任务）：
```
G02 FailoverProvider  ─┐
G05 Soul Redline      ─┤─ 并行执行（互不依赖）
G06 DLP Scan          ─┘

G03 Expects Validation ─→ G04 Retry Escalate  （G04 依赖 G03 的 expects_failed 状态）

P1 任务可在 P0 完成后并行展开
```

---

## 🔴 P0 最关键缺口（6项，立即行动）

| ID | 文件 | 缺口描述 | 来源 | 预估工作量 | 状态 |
|----|------|---------|------|-----------|------|
| G01 | `docs/CODEX_TASK_IRONCLAW_SMART_ROUTING.md` | Smart Routing 13维评分代码未落地 | IronClaw | 2天 | ⏳ 待执行 |
| G02 | `docs/CODEX_TASK_FAILOVER_PROVIDER.md` | FailoverProvider 多 Provider 故障转移 | IronClaw | 1天 | ⏳ 待执行 |
| G03 | `docs/CODEX_TASK_EXPECTS_VALIDATION.md` | expects 验收标准 + max_retries 机制 | AntFarm | 1天 | ⏳ 待执行 |
| G04 | `docs/CODEX_TASK_RETRY_ESCALATE.md` | Retry & Escalate 自动重试 + 人工升级 | AntFarm | 1天 | ⏳ 待执行 |
| G05 | `docs/CODEX_TASK_SOUL_REDLINE_10_LOBSTERS.md` | 10只龙虾红/黄线安全规则植入（含 commander） | SlowMist | 2天 | ⏳ 待执行 |
| G06 | `docs/CODEX_TASK_DLP_SCAN.md` | 边缘节点 DLP 凭证泄露扫描 | SlowMist | 1天 | ⏳ 待执行 |

---

## 🟠 P1 重要缺口（7项）

| ID | 文件 | 缺口描述 | 来源 | 预估工作量 | 状态 |
|----|------|---------|------|-----------|------|
| G07 | `docs/CODEX_TASK_HEARTBEAT_LOBSTER.md` | 主动心跳巡查龙虾（30分钟主动告警，5项 check） | IronClaw | 2天 | ⏳ 待执行 |
| G08 | *(已集成到 lobster_runner.py Hook 系统)* | 生命周期 Hooks 系统 | IronClaw | — | ✅ 已落地 |
| G09 | *(合并到 G07 的 check 机制)* | Doctor 16项健康诊断系统 | IronClaw | — | 🔀 合并到G07 |
| G10 | `docs/CODEX_TASK_FRESH_CONTEXT.md` | Fresh Context 原则 + Token 膨胀防控 | AntFarm | 1天 | ⏳ 待执行 |
| G11 | `docs/CODEX_TASK_YAML_WORKFLOW.md` | YAML 工作流定义（替代硬编码 DAG） | AntFarm | 2天 | ⏳ 待执行 |
| G12 | `docs/CODEX_TASK_PROACTIVE_INTENT.md` | 主动意图捕获（commander 预判下次需求） | memU | 2天 | ⏳ 待执行 |
| G13 | `docs/CODEX_TASK_RESTORE_REPORT.md` | 还原完成事件单次上报 + followup 报告 | openclaw-backup | 1天 | ⏳ 待执行 |

---

## 📁 完整文件清单

```
f:/openclaw-agent/docs/
├── BORROWING_GAP_ANALYSIS_2026-04-01.md     ← 差距分析总报告（来源）
│
├── CODEX_MASTER_INDEX_2026-04-01.md         ← 本文件（总索引）
│
├── ── P0 任务（立即执行）──
├── CODEX_TASK_IRONCLAW_SMART_ROUTING.md     ← G01（前序批次已生成）
├── CODEX_TASK_FAILOVER_PROVIDER.md          ← G02（本批次新增）
├── CODEX_TASK_EXPECTS_VALIDATION.md         ← G03（本批次新增）
├── CODEX_TASK_RETRY_ESCALATE.md             ← G04（本批次新增）
├── CODEX_TASK_SOUL_REDLINE_10_LOBSTERS.md   ← G05（本批次新增，覆盖旧版SLOWMIST_LOBSTER_REDLINE）
├── CODEX_TASK_DLP_SCAN.md                   ← G06（本批次新增）
│
└── ── P1 任务（P0完成后展开）──
    ├── CODEX_TASK_HEARTBEAT_LOBSTER.md      ← G07（本批次新增）
    ├── CODEX_TASK_FRESH_CONTEXT.md          ← G10（本批次新增）
    ├── CODEX_TASK_YAML_WORKFLOW.md          ← G11（本批次新增）
    ├── CODEX_TASK_PROACTIVE_INTENT.md       ← G12（本批次新增）
    └── CODEX_TASK_RESTORE_REPORT.md         ← G13（本批次新增）
```

---

## 🏗️ 新增文件/模块汇总（Codex 落地目标）

### SaaS 层（`dragon-senate-saas-v2/`）

| 文件 | 类型 | 对应任务 |
|------|------|---------|
| `failover_provider.py` | 新建 | G02 |
| `escalation_manager.py` | 新建 | G04 |
| `token_budget.py` | 新建 | G10 |
| `workflow_loader.py` | 新建 | G11 |
| `workflows/default_mission.yaml` | 新建 | G11 |
| `intent_predictor.py` | 新建 | G12 |
| `restore_event.py` | 新建 | G13 |
| `lobsters/lobster_security.py` | 追加（commander专用规则） | G05 |
| `lobster_runner.py` | 追加（expects/max_retries/escalation字段） | G03/G04/G10 |
| `provider_registry.py` | 追加（get_failover_provider方法） | G02 |
| `heartbeat_engine.py` | 追加（ActiveHeartbeatChecker类） | G07 |
| `cron_scheduler.py` | 追加（30分钟主动巡查任务） | G07 |
| `commander_router.py` | 追加（fresh_context + intent prediction） | G10/G12 |
| `commander_graph_builder.py` | 追加（WorkflowLoader集成） | G11 |
| `app.py` | 追加（多个新API端点） | G02/G04/G07/G12/G13 |

### 边缘层（`edge-runtime/`）

| 文件 | 类型 | 对应任务 |
|------|------|---------|
| `security_audit.py` | 新建 | G06 |
| `wss_receiver.py` | 追加（DLP日志过滤器安装） | G06 |
| `marionette_executor.py` | 追加（_safe_log方法） | G06 |

### 脚本层（`scripts/`）

| 文件 | 类型 | 对应任务 |
|------|------|---------|
| `scripts/restore.sh` | 新建/追加 | G13 |

---

## 🖥️ 前端工程师 API 对接速查

### 新增 API 端点汇总

| 端点 | 方法 | 功能 | 对应任务 |
|------|------|------|---------|
| `/api/v1/providers/health` | GET | Provider 健康状态 | G02 |
| `/api/v1/escalations` | GET | 升级事件列表 | G04 |
| `/api/v1/escalations/{id}/resolve` | POST | 人工处理升级 | G04 |
| `/api/v1/security/dlp-alerts` | GET | DLP 告警记录 | G06 |
| `/api/v1/heartbeat/active-check` | GET | 触发主动巡查 | G07 |
| `/api/v1/commander/suggested-intents` | GET | 意图建议 | G12 |
| `/api/v1/restore-events` | GET | 还原事件历史 | G13 |
| `/api/v1/workflows` | GET | 工作流列表 | G11 |
| `/api/v1/workflows/{id}` | GET | 工作流详情 | G11 |

### 前端新增 UI 组件优先级

| 优先级 | 组件 | 位置 | 对应任务 |
|--------|------|------|---------|
| 🔴 P0 | 升级事件待处理徽章 | 首页顶部 | G04 |
| 🔴 P0 | 升级事件列表页 `/escalations` | 运维导航 | G04 |
| 🟠 P1 | Provider 健康状态卡片 | 运维首页 | G02 |
| 🟠 P1 | 主动巡查结果卡片 | 运维首页 | G07 |
| 🟠 P1 | 意图建议快捷卡片 | 对话框顶部 | G12 |
| 🟡 P2 | 还原历史Tab | 备份页面 | G13 |
| 🟡 P2 | Token使用量展示 | 龙虾任务卡片 | G10 |
| 🟡 P2 | DLP 安全告警卡片 | 运维页面 | G06 |

---

## ⚠️ 重要注意事项（Codex 必读）

### 1. 冲突避免原则
每个 CODEX_TASK 文件顶部都有"冲突检查"命令，**必须先执行 grep 检查，再动手写代码**。

### 2. 覆盖关系说明
`CODEX_TASK_SOUL_REDLINE_10_LOBSTERS.md`（G05）是对旧版 `CODEX_TASK_SLOWMIST_LOBSTER_REDLINE.md` 的更新版：
- **旧版**：按9只龙虾写，可能已部分落地
- **新版**：补充 commander 专用规则 + 10只龙虾角色专属黄线
- 执行策略：先运行冲突检查，若旧版已落地则**追加**，不覆盖

### 3. 数据库文件位置
新增模块使用的 SQLite 文件统一放在 `./data/` 目录：
- `./data/escalations.sqlite`（G04）
- `./data/restore_events.sqlite`（G13）

### 4. 环境变量新增
```bash
# .env 新增（可选，均有合理默认值）
PROVIDER_FAILOVER_ORDER=dashscope,deepseek,volcengine,local  # G02
EDGE_OFFLINE_THRESHOLD=300        # G07，单位秒
TASK_QUEUE_BACKLOG_LIMIT=50       # G07
PUBLISH_PLAN_OVERDUE_MINUTES=30   # G07
WORKFLOWS_DIR=./dragon-senate-saas-v2/workflows  # G11
CENTRAL_API_URL=http://localhost:8000            # G06 DLP告警上报
```

---

## 📊 预计总工作量

| 阶段 | 任务 | 预计天数 |
|------|------|---------|
| P0 阶段（优先） | G01+G02+G03+G04+G05+G06 | 8天 |
| P1 阶段（紧随） | G07+G10+G11+G12+G13 | 8天 |
| **合计** | **11个任务** | **~16天（部分并行）** |

---

*索引生成时间：2026-04-01 | 覆盖差距分析：G01-G13 | 由 Cline 自动生成*
