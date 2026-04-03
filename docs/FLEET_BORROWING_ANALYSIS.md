# Fleet 借鉴分析报告

**来源**：https://github.com/fleetdm/fleet（⭐6,201）  
**语言**：Go（服务端）+ TypeScript/React（前端）  
**定位**：开源设备管理平台 — 端点管理 + osquery实时查询 + GitOps配置 + 策略合规 + MDM  
**分析日期**：2026-04-02

---

## 一、Fleet 架构速览

```
Fleet 架构：
┌──────────────────────────────────────────────────┐
│               Fleet SaaS 控制台（前端）            │
│  Hosts（设备列表）/ Queries（查询）/ Policies（策略）│
│  Software / Activities / Calendar / Labels        │
└─────────────────────┬────────────────────────────┘
                       │ REST API + WebSocket
┌─────────────────────▼────────────────────────────┐
│            Fleet Server（Go，云端核心）             │
│  server/fleet/     ← 核心模型（hosts/policies等）  │
│  server/service/   ← 业务逻辑（API Handler）       │
│  server/cron/      ← 定时任务（漏洞扫描/统计等）    │
│  server/activity/  ← 活动日志（每次操作都记录）     │
│  server/policies/  ← 策略评估                     │
│  server/live_query/← 实时查询（基于WebSocket）     │
│  server/worker/    ← 后台任务队列                  │
│  ee/server/        ← 企业版（日历/SCIM/Webhook）   │
└─────────────────────┬────────────────────────────┘
                       │ HTTPS + Token
┌─────────────────────▼────────────────────────────┐
│            Orbit（边缘 Agent，Go）                  │
│  orbit/pkg/update/   ← 自动更新（TUF 协议）        │
│  orbit/pkg/osquery/  ← osquery 管理              │
│  orbit/pkg/token/    ← 设备 Token 管理             │
│  orbit/pkg/installer/← 软件安装                    │
│  orbit/pkg/platform/ ← 跨平台抽象（Win/Mac/Linux） │
│  orbit/pkg/profiles/ ← 配置文件管理               │
└──────────────────────────────────────────────────┘

Host 状态：online | offline | mia（失联）| missing | new
```

---

## 二、已落地声明（跳过）

| Fleet 功能 | 我们已落地 |
|-----------|----------|
| 边缘心跳/在线状态 | `edge_heartbeat.py`（已落地）|
| 边缘 WSS 重连退避 | `CODEX_TASK_EDGE_WSS_BACKOFF.md`（已落地）|
| 边缘设备标签 | `CODEX_TASK_EDGE_NODE_TAGS.md`（已落地）|
| 边缘金丝雀部署 | `CODEX_TASK_EDGE_CANARY_DEPLOY.md`（已落地）|
| 边缘回滚 | `CODEX_TASK_EDGE_ROLLBACK.md`（已落地）|
| 实时仪表板 | `CODEX_TASK_EDGE_REALTIME_DASHBOARD.md`（已落地）|
| 审计日志 | `tenant_audit_log.py`（已落地）|
| RBAC权限 | `rbac_permission.py`（已落地）|
| 告警引擎 | `CODEX_TASK_ALERT_ENGINE.md`（已落地）|
| 策略/规则引擎 | `CODEX_TASK_LOBSTER_RULE_ENGINE.md`（已落地）|
| GitOps配置 | `CODEX_TASK_YAML_WORKFLOW.md` 部分覆盖 |

---

## 三、逐层对比分析

### 🌐 前端 SaaS 控制台

| Fleet 能力 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **活动日志 UI**（所有操作的时间线，谁在什么时候做了什么，支持过滤）| 审计日志API有，无专用 UI | ✅ **P1** — 运营操作历史页（谁添加了哪条规则/谁触发了哪次任务）|
| **标签系统 UI**（Labels — 按属性给设备分组，自动更新成员）| 无动态标签 UI | ✅ **P1** — 动态标签页（按龙虾属性自动分组，如"正在跟进"/"待激活"）|
| **实时查询页**（Live Queries — 向所有在线设备发查询，秒级返回结果）| 无实时查询 | ✅ **P2** — 实时龙虾状态查询（向所有边缘节点广播 query，看当前执行情况）|
| **软件库 UI**（软件目录管理，支持一键部署到指定设备）| 无 | ✅ **P2** — 龙虾插件市场（可视化安装/更新龙虾能力包）|
| **漏洞扫描结果页**（CVE 漏洞列表，关联具体设备）| 无 | ⭕ 不适用（我们不做漏洞扫描）|
| **日历事件 UI**（EE — 合规事件日历）| `CODEX_TASK_INTAKE_FORM.md` 已落地 | ⭕ 已落地（更垂直）|

### 🧠 云端大脑层

| Fleet 能力 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **活动记录（Activity Log）**（`server/activity/` — 所有操作自动产生结构化 activity，含 actor/target/details）| `tenant_audit_log.py` 有基础 | ✅ **P1** — 结构化活动流（龙虾的每次执行、每次决策都产生 activity 记录，可推送到 Webhook）|
| **Worker 后台任务池**（`server/worker/` — 可靠异步任务队列，支持重试/延迟/优先级）| `task_queue.py` 有基础 | ✅ **P1** — 升级 task queue：Fleet worker 的 job 类型注册模式（每种 job 是独立注册的类，不是 if/else）|
| **Cron 任务调度**（`server/cron/` — 可配置的定时任务，含漏洞扫描/统计聚合/过期清理）| `edge_heartbeat.py` 部分覆盖 | ✅ **P1** — 云端 Cron 框架（统计聚合/过期清理/定期报告，结构化配置而非硬编码）|
| **实时查询 Live Query**（WebSocket 推送查询到在线节点，毫秒级聚合响应）| 无 | ✅ **P2** — 实时边缘状态查询（向所有在线边缘节点广播，实时看执行情况）|
| **GitOps 配置管理**（`server/fleet/agent_options.go` — 配置YAML版本化管理，CI/CD推送即生效）| `dynamic_config.py` 部分覆盖 | ✅ **P2** — GitOps 边缘配置（git push 配置 → 自动推送到边缘节点）|
| **Secret 变量管理**（`server/fleet/secret_variables.go` — 敏感配置安全存储和下发）| 无统一 Secret 管理 | ✅ **P2** — Secret 变量仓库（API密钥/Token 安全存储，边缘节点按需拉取）|

### 🦞 9个龙虾层

| Fleet 能力 | 对应场景 | 借鉴价值 |
|-----------|---------|---------|
| **Host Labels 标签系统**（动态查询语句作为标签条件，自动更新成员）| 龙虾能力/状态分组 | ✅ **P1** — 动态龙虾标签（"正在执行的龙虾"/"空闲龙虾"/"专注高意向线索的龙虾"）|
| **Agent Options（per-team）**（不同 team 的 agent 有不同配置，在线热更新）| 不同龙虾不同配置 | ✅ **P1** — 龙虾级配置隔离（dispatcher 和 followup 有各自的执行参数，不共用全局配置）|
| **活动流（Actor 归因）**（每个 activity 记录 actor_id + details，谁做了什么可溯源）| 龙虾执行溯源 | ✅ **P1** — 龙虾操作归因（每条记录能追溯是哪只龙虾执行的、输入什么、输出什么）|
| **campaigns.go（实时查询 campaign）**（一次查询跨多个节点，汇聚结果）| 多龙虾协作查询 | ✅ **P2** — 龙虾广播查询（Commander 向所有激活龙虾广播 query，汇聚各龙虾状态）|

### 🏗️ L1.5 支撑微服务集群

| Fleet 能力 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **Teams 多租户隔离**（`server/fleet/teams.go` — 每个 team 独立配置/策略/数据，成员互不可见）| `tenant_audit_log.py` 有基础 | ✅ **P1** — 完整团队隔离模型（参考 Fleet teams 设计，完善租户数据隔离层）|
| **Worker Job 注册模式**（每种后台任务是独立注册的 Job 类，类型安全，可扩展）| `task_queue.py` 函数式分发 | ✅ **P1** — Job 注册中心（将 task 类型从字符串分发改为注册式 Job 类）|
| **Pub/Sub 实时消息**（`server/pubsub/` — Redis pub/sub 实现实时查询结果广播）| `webhook_event_bus.py` 有基础 | ✅ **P2** — 内部 Pub/Sub 扩展（参考 Fleet redis pub/sub 实现龙虾间实时消息）|
| **统计聚合（statistics.go）**（定期聚合 hosts 统计，存入 aggregated_stats）| `observability_api.py` 有基础 | ✅ **P2** — 龙虾执行统计聚合（定期汇总 vs 实时计算，降低 DB 压力）|

### 🛰️ 云边调度层

| Fleet 能力 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **Orbit 自动更新（TUF 协议）**（`orbit/pkg/update/` — 边缘 agent 定期检查更新，安全验证后自动升级）| `CODEX_TASK_EDGE_ROLLBACK.md` 已落地 | ✅ **P1** — TUF 安全更新（我们的 agent 更新缺少 TUF 签名验证，可能被中间人攻击）|
| **边缘 Token 管理**（`orbit/pkg/token/` — 每个边缘节点有独立 Token，注册/轮换/吊销完整机制）| WSS Token 有基础 | ✅ **P1** — 边缘 Token 轮换（Token 定期自动轮换，旧 Token 自动吊销，防泄露）|
| **配置推送（api_orbit.go）**（云端向 orbit 下发 agent_options，orbit 轮询拉取）| `dynamic_config.py` 部分覆盖 | ✅ **P2** — 结构化配置下发（云端配置变更 → 边缘 polling 拉取 → 校验 hash → 应用）|
| **Orbit 跨平台抽象**（`orbit/pkg/platform/` — Windows/Mac/Linux/Android 统一接口）| 仅 Python，无跨平台 | ✅ **P2** — 边缘平台抽象层（封装平台差异，同一套逻辑在不同 OS 运行）|

### 🖥️ 边缘执行层

| Fleet 能力 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **Orbit 能力封装**（把 osquery/fleetd/nudge 等工具作为 orbit 子进程管理）| `marionette_executor.py` 有基础 | ✅ **P1** — 子进程托管模式（边缘将多个能力工具作为受控子进程，而非硬编码调用）|
| **边缘软件安装（installer.go）**（边缘节点接收云端指令，自动下载并安装软件包）| 无 | ✅ **P2** — 龙虾能力包安装（云端发指令 → 边缘下载 skill 包 → 本地安装激活）|
| **Keystore 本地安全存储**（`orbit/pkg/keystore/` — 敏感数据（证书/Token）本地加密存储）| 无安全存储 | ✅ **P2** — 边缘 Keystore（API密钥/证书本地加密，防止明文存储泄露）|
| **Tables 插件化扩展**（`orbit/pkg/table/` — 每种数据源是独立的 Table 插件，可热插拔）| 无插件化 | ✅ **P2** — 边缘数据收集插件化（每种遥测数据是独立插件，可动态启停）|

---

## 四、核心设计精髓

### 1. Activity Log 结构（最直接可借鉴）

```go
// Fleet server/activity/ 的设计
type Activity struct {
    ID          uint             `json:"id"`
    ActorFullName *string        `json:"actor_full_name"`  // 谁做的
    ActorID       *uint          `json:"actor_id"`
    ActorEmail    *string        `json:"actor_email"`
    Type          ActivityType   `json:"type"`             // 做了什么
    Details       *json.RawMessage `json:"details"`        // 详情（结构化）
    CreatedAt     time.Time      `json:"created_at"`
}
// 类型化的 Activity（不是自由文本，是结构化的）
// 例如：ActivityTypeRanScript、ActivityTypeEditedPolicy、ActivityTypeEnrolledHost
```

### 2. Worker Job 注册模式

```go
// Fleet server/worker/ 的 Job 注册机制
type Job interface {
    Name() string
    Retries() int
    Run(ctx context.Context, payload json.RawMessage) error
}

// 每种任务类型独立注册
worker.Register(&SendMailJob{})
worker.Register(&ScanVulnerabilitiesJob{})
worker.Register(&CalendarEventJob{})
// 分发时按 name 查找，类型安全
```

### 3. Host Status 状态机（对应我们的边缘节点状态）

```
online  → offline（超过 check-in interval × 1.5 无心跳）
offline → mia（超过 30 天）
*       → new（注册后 24 小时内）

对应我们：
active → idle（超过 N 分钟无任务）
idle   → lost（超过 M 小时无心跳）
*      → registered（首次注册后）
```

---

## 五、优先级汇总

### 🔴 P1（新增，高价值）

| # | 功能 | 来源 | 落地路径 |
|---|------|------|---------|
| P1-1 | **结构化活动流**（类型化活动记录 + Webhook 推送）| Fleet `server/activity/` | `dragon-senate-saas-v2/activity_stream.py` |
| P1-2 | **动态标签系统**（基于属性的动态分组 + 自动更新成员）| Fleet `server/fleet/labels.go` | `dragon-senate-saas-v2/dynamic_label.py` |
| P1-3 | **Job 注册中心**（Worker 类型注册式后台任务）| Fleet `server/worker/` | `dragon-senate-saas-v2/job_registry.py` |
| P1-4 | **边缘 Token 轮换**（自动轮换 + 吊销机制）| Fleet `orbit/pkg/token/` | `edge-runtime/token_rotator.py` |
| P1-5 | **Orbit 子进程托管模式**（边缘能力工具作为受控子进程）| Fleet `orbit/` | 升级 `edge-runtime/marionette_executor.py` |

### 🟡 P2

| # | 功能 | 来源 | 落地路径 |
|---|------|------|---------|
| P2-1 | **实时广播查询**（向在线边缘节点广播查询，汇聚结果）| Fleet `server/live_query/` + `campaigns.go` | `dragon-senate-saas-v2/live_query_engine.py` |
| P2-2 | **边缘 Keystore**（本地加密存储敏感数据）| Fleet `orbit/pkg/keystore/` | `edge-runtime/keystore.py` |
| P2-3 | **Secret 变量管理**（云端统一管理 API 密钥，边缘按需拉取）| Fleet `server/fleet/secret_variables.go` | `dragon-senate-saas-v2/secret_vault.py` |
| P2-4 | **执行统计聚合**（定期汇总龙虾执行统计，降低 DB 压力）| Fleet `server/fleet/aggregated_stats.go` | `dragon-senate-saas-v2/stats_aggregator.py` |
| P2-5 | **活动日志 UI**（运营操作历史时间线）| Fleet frontend/activities | 前端 `/settings/activities` |

---

## 六、与我们项目的互补性

```
Fleet（设备管理）          我们（AI营销执行）
───────────────           ─────────────────────
Hosts（设备注册/心跳）  ←→ EdgeNodes（边缘节点注册/心跳）
Labels（设备分组）      ←→ LobsterLabels（龙虾动态分组）
Policies（设备合规）    ←→ PolicyEngine（已落地OPA）
Activities（操作日志）  ←→ ActivityStream（执行审计）
Worker（后台任务）      ←→ JobRegistry（可靠异步任务）
Orbit（边缘 agent）     ←→ EdgeRuntime（边缘执行层）
Live Query（实时查询）  ←→ LiveQueryEngine（实时龙虾状态）

Fleet 最大启发：
  ✅ 把边缘节点当作"受管理的实体"（有状态/标签/策略）
  ✅ 活动日志是系统级基础设施，不是事后补充的功能
  ✅ Worker job 注册模式比 if/else 分发更可扩展
  ✅ 边缘 Token 需要定期轮换（安全基础）
```

---

*来源：Fleet（⭐6.2k）| 分析日期：2026-04-02*
