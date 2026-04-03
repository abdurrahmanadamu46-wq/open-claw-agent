# CODEX TASK: ClawTeam 多龙虾协作体系升级
> 来源借鉴：https://github.com/win4r/ClawTeam-OpenClaw.git
> 任务时间：2026-04-01
> 优先级：P0（多龙虾协作核心基础设施）

---

## 背景

通过对 ClawTeam-OpenClaw 项目的完整分析，识别出我们龙虾多Agent协作体系的**6个关键缺失**，本任务完成 P0+P1 共 6 个模块的落地。

---

## 已落地模块清单

### P0（核心 Multi-Agent 协作基础）

#### P0-1: `lobster_task_dag.py` — 任务 DAG 依赖图 + TaskLock
**解决的问题**：多龙虾并发抢同一任务 / 任务依赖顺序混乱

关键特性：
- `TaskItem` 含 `blocks/blocked_by`（DAG 有向图）
- 只有 `blocked_by` 全部 `completed`，下游任务才从 `blocked→pending`
- `claim_next(lobster_name)` 原子乐观锁（SQLite WAL + WHERE locked_by=''）
- 4级优先级：`urgent > high > medium > low`
- `recover_dead_lobster(name)`：恢复死亡龙虾持有的任务
- `get_dag_summary(team_id)`：进度摘要（供 Dashboard 显示）

**集成 14步工作流**（示例）：
```python
dag = LobsterTaskDAG()
run_id = "content-campaign-001"

# 按 14步工作流创建有依赖的任务链
t1 = dag.create("市场调研", team_id=run_id, owner="researcher", priority="high")
t2 = dag.create("受众分析", team_id=run_id, owner="strategist",
                 blocked_by=[t1.task_id])
t3 = dag.create("文案创作", team_id=run_id, owner="inkwriter",
                 blocked_by=[t2.task_id])
t4 = dag.create("合规审查", team_id=run_id, owner="catcher",
                 blocked_by=[t3.task_id])
# ... 14步全部建立依赖关系

# 龙虾并发领取任务
task = dag.claim_next("researcher", team_id=run_id)
dag.complete(task.task_id, result="调研报告...", lobster_name="researcher")
# → 自动解除 t2 的 blocked 状态 → t2 变 pending
```

---

#### P0-2: `lobster_mailbox.py` — 龙虾间消息通信 + Dead Agent 恢复

**解决的问题**：龙虾间只有云→边单向通道，无法龙虾互相通信；龙虾死亡后任务丢失

关键特性：
- `LobsterMailbox`：SQLite 消息存储，单播+广播双模式
- 14种结构化 `LobsterMessageType`（message/task_assigned/task_result/plan_submit/plan_approved/idle/broadcast/shutdown...）
- `broadcast(from_agent, content)`：Coordinator → 所有龙虾广播
- `heartbeat(lobster_name)`：龙虾存活心跳（每步执行后调用）
- `get_dead_lobsters(threshold_s=60)`：检测超时无心跳的龙虾
- `LobsterCoordinator`：封装 Coordinator 操作（广播/分配/审批/检测死亡）

**集成示例**：
```python
mailbox = LobsterMailbox()
coordinator = LobsterCoordinator("coordinator", "run-001", mailbox)

# Coordinator 广播启动信号
coordinator.broadcast("🚀 14步工作流启动，请各龙虾就绪")

# 分配任务
coordinator.assign_task("researcher", task_id, "市场调研", "请分析...")

# 龙虾回报结果
mailbox.send_task_result("researcher", "coordinator", task_id, "调研完成...")

# 检测死亡龙虾（可结合 dag 自动恢复）
dead = coordinator.check_dead_lobsters(dag=dag)
```

---

#### P0-3: `lobster_circuit_breaker.py` — 三态健康熔断器 + quality_score 路由

**解决的问题**：龙虾出错后继续被分配任务，无健康管理

关键特性：
- **三态**：`healthy → degraded → open（熔断）→ half-open → healthy`
- `quality_score`（EMA）：成功 +0.05×0.95，失败 ×0.7（快速降分）
- `is_accepting_tasks`：熔断期自动拒绝新任务
- `get_best_lobster(candidates)`：从候选中选最优（过滤熔断+按分排序）
- `force_open(name, reason)`：运维强制熔断
- FastAPI Router：`/api/circuit-breaker/...`（供 Dashboard 展示）

**集成到 lobster_pool_manager**：
```python
cb = LobsterCircuitBreaker()

# 选择最优龙虾执行任务
best = cb.get_best_lobster(["inkwriter", "inkwriter_backup"])
if best:
    task = dag.claim_next(best, team_id=run_id)
    try:
        result = run_lobster(best, task)
        cb.report_success(best)
        dag.complete(task.task_id, result=result)
    except Exception as e:
        cb.report_failure(best, str(e))
        dag.fail(task.task_id, str(e), retry=True)
```

---

### P1（协作体系完善）

#### P1-4: `lobster_task_waiter.py` — 带超时+Dead Agent 恢复的等待循环

**解决的问题**：工作流无法优雅等待所有龙虾完成；死亡龙虾导致工作流卡死

关键特性：
- 每 poll 周期：① 收消息 ② 死亡检测+任务恢复 ③ 进度统计 ④ 回调通知
- `WaitResult`：汇总 completed/pending/blocked/failed/progress_pct
- SIGINT 优雅中断
- `on_progress/on_message/on_dead_lobster/on_complete` 回调链

**集成示例**：
```python
result = wait_for_team(
    dag, mailbox, "coordinator", run_id,
    timeout=600,  # 10分钟超时
    verbose=True,
)
if result.status == "completed":
    print(f"✅ 14步工作流完成，用时 {result.elapsed:.0f}s")
elif result.status == "timeout":
    print(f"⏰ 超时，完成率 {result.progress_pct}%")
```

---

#### P1-5: `lobster_session.py` — 龙虾断点续跑

**解决的问题**：龙虾重启后丢失执行状态，需要从头开始

关键特性：
- `save(lobster_name, team_id, task_id, step_index, context)`：保存任意 KV 上下文
- `load(lobster_name, team_id)`：重启后恢复（返回 None=全新启动）
- `advance_step(name, result=...)`：步骤推进 + 保存结果到 context
- `update_context(name, updates={})`：增量 merge，不覆盖
- `get_snapshots()`：历史快照（支持回滚）

**集成示例**：
```python
session = LobsterSession()

# 龙虾启动时检查是否有未完成任务
state = session.load("inkwriter", team_id=run_id)
if state and state.task_id and state.status == "active":
    print(f"♻️ 续跑任务 {state.task_id}，从步骤 {state.step_index} 继续")
    draft = state.get("draft", "")  # 恢复中间草稿
else:
    # 全新开始
    state = session.save("inkwriter", team_id=run_id, task_id=task.task_id)

# 每步完成后保存进度
session.advance_step("inkwriter", team_id=run_id, result=paragraph_1)
session.update_context("inkwriter", updates={"draft": full_draft})
```

---

#### P1-7: `ssrf_guard.py` — SSRF 防护中间件

**解决的问题**：Webhook/外部请求功能可能被用来攻击内网

关键特性：
- `is_blocked_hostname(hostname)`：阻止 localhost/内网IP/link-local/multicast
- DNS rebinding 防护（解析后再检查真实IP）
- `validate_url(url, require_allowlist=False)`：完整 URL 安全验证
- FastAPI 依赖 `make_ssrf_guard_dependency()`
- Starlette 中间件 `make_ssrf_middleware()`（自动检查 url/webhook_url/callback 参数）

**集成到 app.py**：
```python
from ssrf_guard import make_ssrf_middleware, make_ssrf_router

SSRFMiddleware = make_ssrf_middleware()
if SSRFMiddleware:
    app.add_middleware(SSRFMiddleware)

router = make_ssrf_router()
if router:
    app.include_router(router)
```

---

## 整体协作架构（落地后）

```
┌─────────────────────────────────────────────────────────┐
│  Coordinator（大脑 / dragon_senate.py）                  │
│  ├── LobsterCoordinator（mailbox.broadcast/assign）      │
│  ├── LobsterTaskWaiter（等待所有龙虾完成）               │
│  └── LobsterCircuitBreaker.get_best_lobster(...)         │
├─────────────────────────────────────────────────────────┤
│  LobsterTaskDAG（任务依赖图）                            │
│  ├── blocked_by 满足 → pending → 龙虾 claim_next        │
│  └── complete → 自动解除下游 blocked                     │
├─────────────────────────────────────────────────────────┤
│  LobsterMailbox（龙虾间消息）                            │
│  ├── 单播：龙虾↔龙虾 / 龙虾↔Coordinator                │
│  ├── 广播：Coordinator→全部龙虾                         │
│  └── 心跳：龙虾存活检测                                  │
├─────────────────────────────────────────────────────────┤
│  LobsterCircuitBreaker（健康熔断）                       │
│  ├── healthy/degraded/open 三态                         │
│  └── quality_score EMA 路由                             │
├─────────────────────────────────────────────────────────┤
│  LobsterSession（断点续跑）                              │
│  ├── save/load/advance_step                             │
│  └── 快照历史（回滚）                                   │
├─────────────────────────────────────────────────────────┤
│  SSRFGuard（安全防护）                                   │
│  └── 阻止内网攻击 / DNS rebinding                       │
└─────────────────────────────────────────────────────────┘

9个龙虾（各自并发执行）：
researcher / strategist / inkwriter / catcher / dispatcher
visualizer / followup / orchestrator / heartbeat
  ↓ claim_next（DAG）
  ↓ heartbeat（Mailbox）
  ↓ report_success/failure（CircuitBreaker）
  ↓ advance_step（Session）
  ↓ send_task_result（Mailbox）
```

---

## P2 待做（下一迭代）

| ID | 功能 | 文件 |
|----|------|------|
| P2-B3 | 完整 PlanApproval 工作流（Markdown计划+历史） | `lobster_plan_approval.py` |
| P2-L1 | 优雅关机三次握手（request→approve→cleanup） | `lobster_lifecycle.py` |
| P2-L2 | 团队状态 Snapshot（JSON导出恢复） | `lobster_snapshot.py` |
| P2-M3 | Broadcast 消息订阅（龙虾可订阅特定类型） | 扩展 `lobster_mailbox.py` |
| P2-S3 | quality_score 加权任务路由（更复杂算法） | 扩展 `lobster_circuit_breaker.py` |

---

## 验收标准

- [x] `lobster_task_dag.py` - `dag.create/claim_next/complete/recover_dead_lobster` 正常运行
- [x] `lobster_mailbox.py` - `mailbox.send/broadcast/receive/heartbeat/get_dead_lobsters` 正常运行
- [x] `lobster_circuit_breaker.py` - 三态转换 + `get_best_lobster` 正常运行
- [x] `lobster_task_waiter.py` - `wait_for_team()` 可以等待并检测超时
- [x] `lobster_session.py` - `save/load/advance_step/update_context` 正常运行
- [x] `ssrf_guard.py` - 阻止 localhost/192.168.x/127.x 并允许合法外部URL
- [ ] 集成测试：14步工作流完整运行（所有龙虾协同）
- [ ] Dashboard 展示 DAG 进度图 + CircuitBreaker 状态

---

*Codex Task 完成：2026-04-01 | 借鉴来源：ClawTeam-OpenClaw*
