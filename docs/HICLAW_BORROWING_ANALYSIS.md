# HiClaw 借鉴分析

> **项目**: [agentscope-ai/HiClaw](https://github.com/agentscope-ai/HiClaw)
> **Stars**: 3469 | **Forks**: 389 | **Language**: Shell/Go/Python | **License**: Apache-2.0
> **描述**: An open-source Collaborative Multi-Agent OS for transparent, human-in-the-loop task coordination via Matrix rooms.
> **版本**: v1.0.8 | **分析日期**: 2026-03-31

---

## 一、项目定位

**HiClaw** 是一个**开源的协作式多 Agent 操作系统**，通过 Matrix 即时通讯协议实现多 AI Agent 之间的透明协作，并内建人类在环（HITL）监督机制。

**核心理念**：所有 Agent 通信发生在 Matrix 聊天室中，人类管理员可以**实时看到、参与和干预**每一个 Agent 的工作——没有隐藏通信。

**与我们的关系**：HiClaw 是目前最接近我们"龙虾元老院"架构的开源项目——Manager（Commander）+ Workers（龙虾们）+ 人类监督 + 任务编排。但它面向**通用研发团队**，我们面向**本地生活服务增长**。

---

## 二、核心架构拆解

### 2.1 四层架构

```
┌─────────────────────────────────────────────┐
│  hiclaw-controller (Go, K8s CRD)           │  ← 声明式资源管理层
├─────────────────────────────────────────────┤
│  Manager Container                          │  ← 编排中枢（= 我们的 Commander）
│  ├── Manager Agent (OpenClaw)               │
│  ├── Higress AI Gateway (统一入口)           │
│  ├── Tuwunel Matrix Server (IM 通信)        │
│  ├── Element Web (人类 UI)                   │
│  └── MinIO (文件存储/同步)                   │
├─────────────────────────────────────────────┤
│  Worker Containers (N 个)                   │  ← 执行者（= 我们的龙虾）
│  ├── Worker Agent (OpenClaw)                │
│  ├── mc (MinIO 文件同步)                    │
│  └── mcporter (MCP 工具调用)                │
├─────────────────────────────────────────────┤
│  CoPaw Worker (Python, AgentScope)          │  ← 第三方 Agent 运行时桥接
└─────────────────────────────────────────────┘
```

### 2.2 关键组件对照

| HiClaw 组件 | 我们的对应物 | 差异 |
|-------------|-------------|------|
| **Manager Agent** | Commander (元老院总脑) | HiClaw Manager 更成熟：有完整 HEARTBEAT 7步检查 + 容器生命周期管理 + 跨渠道升级 |
| **Worker Agent** | 9 只龙虾 | HiClaw Worker 是**通用的**无差异 Agent，通过 Skills 注入能力；我们的龙虾是**专业化**的角色 |
| **Team Leader** | ❌ 我们没有 | HiClaw 支持**团队层级**：Manager → Team Leader → Workers，Leader 负责团队内协调 |
| **Matrix Server** | ❌ 我们用 WebSocket | HiClaw 用标准 Matrix 协议，天然去中心化、消息持久化、多端同步 |
| **Higress AI Gateway** | ❌ 我们没有统一网关 | 统一的 LLM 代理 + MCP 服务器 + 权限控制入口 |
| **MinIO 文件系统** | ❌ 我们用本地文件 | 所有 Agent 配置、任务规范、结果通过 MinIO 同步，Worker 无状态 |
| **hiclaw-controller (K8s)** | ❌ 我们没有 | 声明式资源管理：Worker/Team/Human 作为 K8s CRD 对象 |
| **Element Web** | ❌ 我们没有通用 IM UI | 人类通过标准聊天界面参与 Agent 协作 |
| **state.json** | ❌ 我们没有 (CODEX-AA-01 规划中) | Manager 运行时状态：active_tasks/admin_dm_room 等 |
| **SOUL.md** | role-card.json (简版) | HiClaw SOUL.md 更丰富（AI Identity + Security Rules + 动态人格配置） |
| **HEARTBEAT.md** | ❌ 我们没有 | 7 步完整检查清单（有限任务/无限任务/项目/容量/容器生命周期/报告） |
| **Skills 系统** | lobster_skill_registry | HiClaw 的 Skill = 目录（SKILL.md + references/ + scripts/），更结构化 |
| **worker-lifecycle.json** | ❌ 我们没有 | 容器状态 + 空闲超时自动停止 + 按需唤醒 |

### 2.3 Agent 身份文件体系

```
manager/agent/
├── SOUL.md              ← 身份 + AI Identity + 安全规则
├── AGENTS.md            ← 工作空间规范 + 通信协议 + 运行规则
├── HEARTBEAT.md         ← 7步心跳检查清单
├── TOOLS.md             ← 技能清单引用
├── state.json           ← 运行时状态（active_tasks、admin_dm_room）
├── workers-registry.json ← Worker 注册表（技能/房间/状态）
├── worker-lifecycle.json ← 容器生命周期状态
├── primary-channel.json ← 管理员首选通知渠道
├── trusted-contacts.json ← 授权联系人白名单
├── yolo-mode            ← 自主模式开关文件
└── memory/              ← 记忆文件（MEMORY.md + 每日日志）
```

**对比我们**：我们在 CODEX-AA-01 中规划了 `SOUL.md + AGENTS.md + heartbeat.json + working.json`，但 HiClaw 的实现更完整——它还有 `workers-registry.json`（Worker 注册表）、`worker-lifecycle.json`（容器生命周期）、`primary-channel.json`（通知渠道偏好）、`yolo-mode`（自主模式开关）、`memory/`（记忆目录）。

### 2.4 HEARTBEAT.md 深度分析（7 步检查清单）

HiClaw Manager 的心跳不是简单的"还活着吗"检查，而是一个**完整的管理例会**：

| 步骤 | 检查内容 | 我们有没有 | 启发 |
|------|---------|-----------|------|
| **1. 读 state.json** | 初始化状态 + 确保通知渠道可用 | ❌ | Commander 每次唤醒应先读运行时状态 |
| **2. 有限任务跟进** | 逐个检查 Worker 进度 + 自动唤醒容器 + 超时告警 | ❌ | Commander 应主动轮询龙虾进度 |
| **2b. 团队任务跟进** | 通过 Team Leader 检查，不直接联系团队成员 | ❌ | 未来如果有子团队编排 |
| **3. 无限任务调度** | 检查定时任务是否到期 + 触发执行 + 防重入 | ❌ | 回访虾、触须虾的定时巡检 |
| **4. 项目进度监控** | 扫描项目 plan.md + 检查阻塞 | ❌ | 金算虾的项目复盘 |
| **5. 容量评估** | 统计忙碌/空闲 Worker + 建议扩容/重分配 | ❌ | Commander 资源仲裁 |
| **6. 容器生命周期** | 同步状态 + 空闲超时停止 + 通知 | ❌ | 边缘执行端的容器管理 |
| **7. 向管理员报告** | 异常汇总 → 多渠道推送 + 人格化表达 | ❌ | Commander 定期向人类报告 |

**最关键的洞察**：HiClaw 的 HEARTBEAT 不是技术层面的心跳，而是**业务层面的管理例会**——每个心跳周期，Manager 就像一个尽责的项目经理，逐项检查所有在途任务、团队状态、容量瓶颈，然后给老板一份简报。

### 2.5 Kubernetes CRD 声明式管理

HiClaw 定义了 3 个 CRD（Custom Resource Definition）：

#### Worker CRD
```yaml
apiVersion: hiclaw.io/v1beta1
kind: Worker
metadata:
  name: alice
spec:
  model: claude-sonnet-4-20250514
  runtime: openclaw        # 或 copaw
  identity: "前端开发专家"
  soul: "你是一个注重用户体验的前端开发者..."
  skills: ["coding-cli", "github-operations"]
  mcpServers: ["github"]
  channelPolicy:
    groupAllowExtra: ["@bob"]
    dmDenyExtra: []
status:
  phase: Running
  matrixUserID: "@alice:hiclaw.local"
  roomID: "!abc123:hiclaw.local"
  containerState: running
  lastHeartbeat: "2026-03-31T07:00:00Z"
```

#### Team CRD
```yaml
apiVersion: hiclaw.io/v1beta1
kind: Team
metadata:
  name: frontend-team
spec:
  description: "前端开发团队"
  leader:
    name: frontend-lead
    model: claude-sonnet-4-20250514
    identity: "前端团队负责人"
  workers:
    - name: alice
      skills: ["coding-cli"]
    - name: bob
      skills: ["coding-cli", "github-operations"]
  peerMentions: true
status:
  phase: Active
  leaderReady: true
  readyWorkers: 2
  totalWorkers: 2
```

#### Human CRD
```yaml
apiVersion: hiclaw.io/v1beta1
kind: Human
metadata:
  name: admin-zhang
spec:
  displayName: "张三"
  email: "zhang@company.com"
  permissionLevel: 1  # 1=Admin, 2=Team, 3=Worker
  accessibleTeams: ["*"]
status:
  phase: Active
  matrixUserID: "@zhang:hiclaw.local"
```

**核心启发**：通过声明式 YAML 管理 Agent 团队——创建 Worker 只需 `kubectl apply -f worker.yaml`，扩容只需修改 Team YAML。这比我们当前的代码硬编码灵活得多。

### 2.6 技能（Skill）目录结构

```
skills/task-management/
├── SKILL.md              ← 技能描述 + 何时使用 + 注意事项
├── references/           ← 参考文档（按需加载，不一次全部加载）
│   ├── finite-tasks.md
│   ├── infinite-tasks.md
│   ├── state-management.md
│   └── worker-selection.md
└── scripts/              ← 可执行脚本
    ├── find-worker.sh
    ├── manage-state.sh
    └── resolve-notify-channel.sh
```

**关键设计**：
- `SKILL.md` 有 YAML frontmatter（name + description）用于技能发现
- "Gotchas" 节列出**常见错误和陷阱**——防止 LLM 犯同样的错误
- "Operation Reference" 表格告诉 Agent **按需读取**参考文档，不是一次全部加载
- `scripts/` 下的 Shell 脚本是**Agent 可以直接调用的工具**

### 2.7 安全模型

```
Higress Gateway (统一入口)
├── Consumer key-auth: 每个 Worker 有独立的 BEARER token
├── 路由权限: Manager 控制每个 Worker 可访问哪些 MCP Server
├── 外部 API 凭证: 集中存储在 Gateway，Worker 永远看不到
└── 通信策略: channelPolicy (groupAllow/Deny + dmAllow/Deny)
```

**关键设计**：
- Worker **永远不会直接接触**外部 API 凭证（GitHub PAT 等）
- 所有外部调用通过 Gateway 代理，权限由 Manager 控制
- `channelPolicy` 可以精细控制谁能和谁通信

### 2.8 通信模型

```
Matrix Room: "Worker: Alice"
├── Members: @admin, @manager, @alice
├── Manager 分配任务 → 所有人可见
├── Alice 汇报进度 → 所有人可见
├── Human 随时干预 → 所有人可见
└── 没有隐藏通信 → 完全透明
```

**跨渠道升级**：
- Manager 支持 Matrix DM + Discord + 飞书 + Telegram 等多渠道
- 紧急问题通过 `primary-channel.json` 发送到管理员首选渠道
- 回复自动路由回原始 Matrix 房间

---

## 三、对比分析：我们 vs HiClaw

### 3.1 整体对比

| 维度 | HiClaw | 我们（龙虾元老院） | 差距/结论 |
|------|--------|------------------|----------|
| **定位** | 通用多 Agent 研发协作 OS | 本地生活服务 AI 增长系统 | 不同赛道 |
| **Agent 编排** | Manager + Team Leader + Worker 三级 | Commander + 9 龙虾两级 | HiClaw 多一级团队编排 |
| **Agent 专业化** | Worker 通用，靠 Skills 注入能力 | 龙虾深度专业化（固定角色） | 我们更深 |
| **通信基础** | Matrix 协议（标准、去中心化、持久化） | WebSocket（自建、无持久化） | **HiClaw 远强于我们** |
| **人类参与** | Element Web 实时聊天 + 多渠道 | 审批门 + Dashboard | **HiClaw 更自然** |
| **透明度** | 100% 透明（所有通信人类可见） | 部分透明（审计日志） | **HiClaw 更好** |
| **容器管理** | 空闲自动停 + 按需唤醒 + lifecycle.json | ❌ 无 | **重大缺失** |
| **声明式部署** | K8s CRD (Worker/Team/Human) | ❌ 代码硬编码 | **重大缺失** |
| **文件同步** | MinIO + mc mirror（实时同步） | ❌ 本地文件 | **重大缺失** |
| **HEARTBEAT** | 7 步管理例会（任务/团队/容量/容器/报告） | ❌ 无 | **重大缺失** |
| **state.json** | 完整运行时状态 | ❌ 无（规划中） | **重大缺失** |
| **多渠道通知** | Matrix + Discord + 飞书 + Telegram | 规划中 | HiClaw 已落地 |
| **Skill 系统** | SKILL.md + references/ + scripts/ | lobster_skill_registry（JSON 注册） | HiClaw 更结构化 |
| **AI Gateway** | Higress（统一 LLM/MCP 代理 + 权限） | ❌ 各龙虾直连 | **重大缺失** |
| **YOLO 模式** | yolo-mode 文件开关（无人监督自主运行） | ❌ 无 | 自主模式开关 |
| **记忆系统** | memory/ 目录（MEMORY.md + 每日日志） | memory_consolidator（简版） | HiClaw 更实用 |
| **业务深度** | 通用（无行业知识） | 深（行业知识包 + 平台适配） | 我们更强 |
| **执行能力** | Shell 脚本 + MCP 工具 | BBP + 提线木偶 + WSS | 我们有浏览器自动化 |

### 3.2 HiClaw 有而我们没有的（关键差距）

#### ❌ 差距 1: 没有统一 AI 网关

HiClaw 使用 Higress 作为所有 AI 交互的统一入口：
- LLM API 代理（统一 API Key 管理、限速、日志）
- MCP Server 代理（权限控制、按 Worker 分配）
- 文件系统代理（认证、访问控制）

**对我们的启发**：`provider_registry.py` 负责 LLM 调用，但缺少统一的网关层来管理 MCP 工具权限和限速。

#### ❌ 差距 2: 没有透明的通信基础设施

HiClaw 所有 Agent 通信通过 Matrix 房间，人类实时可见。我们的龙虾间通信通过 `lobster_event_bus`，人类只能看到审计日志。

**对我们的启发**：龙虾间通信应该有"可观察房间"模式——人类可以进入任何龙虾的工作房间，实时看到通信内容。

#### ❌ 差距 3: 没有容器/Worker 生命周期管理

HiClaw 的 `worker-lifecycle.json` + `lifecycle-worker.sh` 实现了：
- 容器状态同步（running/stopped/missing）
- 空闲超时自动停止（节省资源）
- 任务分配时自动唤醒（按需启动）
- 异常容器自动重建

**对我们的启发**：边缘执行端需要类似的生命周期管理——BBP/提线木偶空闲时自动休眠，有任务时自动唤醒。

#### ❌ 差距 4: 没有声明式资源管理

HiClaw 的 K8s CRD 允许通过 YAML 声明式管理整个 Agent 团队。创建新 Worker 只需 `kubectl apply`。

**对我们的启发**：龙虾配置应该可以通过声明式 YAML/JSON 管理——添加新龙虾实例、修改配置、扩缩容都不需要改代码。

#### ❌ 差距 5: 没有团队层级编排

HiClaw 支持 Manager → Team Leader → Workers 三级编排：
- Team Leader 负责团队内部任务分解和协调
- Manager 只和 Team Leader 通信，不直接管理团队 Worker
- 适合复杂多步骤项目

**对我们的启发**：未来如果龙虾数量增加（比如行业定制龙虾），可能需要引入"团队"概念——一个"美容行业团队"包含定制的触须虾+吐墨虾+幻影虾，由行业 Leader 协调。

#### ❌ 差距 6: 没有 YOLO 模式开关

HiClaw 通过一个文件 `yolo-mode` 的存在/缺失来切换自主模式。存在时 Manager 可以不经人类确认自主决策。

**对我们的启发**：这与 Clawith 的 L1/L2/L3 autonomy policy 对应。可以简化为一个开关文件。

### 3.3 我们有而 HiClaw 没有的（独有优势）

| 我们有 | 说明 |
|--------|------|
| **角色专业化** | 9 只龙虾各有深度专业角色，HiClaw Worker 是通用的 |
| **行业知识包** | 每虾 10-15 个行业知识包 + RAG 召回 |
| **浏览器自动化** | BBP + 提线木偶 + 上下文导航 |
| **线索评分引擎** | xai-scorer + 反事实解释 |
| **策略张量路由** | policy-router-service + policy_bandit |
| **RL 训练闭环** | input→output→outcome 三元组 + SFT/DPO 导出 |
| **工件系统** | 每虾产出结构化工件（SignalBrief/CopyPack/ExecutionPlan 等） |
| **多平台发布自动化** | 点兵虾的多账号轮转、定时发布、紧急下架 |

---

## 四、最高价值借鉴点

### 🔴 P0 借鉴（立即价值）

#### 1. HEARTBEAT 升级为"7 步管理例会"

我们在 CODEX-AA-01 中规划的 `heartbeat.json` 太简单了。参考 HiClaw，Commander 的 HEARTBEAT 应该是：

```markdown
## Commander 心跳检查清单

### 1. 读取运行时状态 (state.json / working.json)
- 加载所有龙虾的 working.json
- 确保管理员通知渠道可用

### 2. 有限任务跟进
- 逐个检查每只龙虾的当前任务进度
- 超时未响应的龙虾标记告警
- 已完成但未更新状态的自动更新

### 3. 定时任务调度
- 触须虾的定时竞品扫描
- 回访虾的定时客户跟进
- 检查是否到期 + 触发执行 + 防重入

### 4. 项目进度监控
- 扫描活跃项目的 KPI 达成情况
- 检查是否有龙虾阻塞在等待上游

### 5. 容量评估
- 统计忙碌/空闲龙虾
- 评估是否需要扩容或重分配
- 检查 token 预算使用率

### 6. 边缘执行端状态
- 同步 BBP/提线木偶容器状态
- 空闲超时的边缘端自动休眠
- 有任务的边缘端自动唤醒

### 7. 向管理员报告
- 如果全部正常：HEARTBEAT_OK（不打扰）
- 如果有异常：汇总报告 → 通过首选渠道推送
- 使用 SOUL.md 定义的人格和语言
```

#### 2. Worker 注册表 (workers-registry.json)

HiClaw 的 `workers-registry.json` 是 Manager 管理所有 Worker 的单一真相源：

```json
{
  "alice": {
    "matrix_user_id": "@alice:hiclaw.local",
    "room_id": "!abc:hiclaw.local",
    "skills": ["coding-cli", "github-operations"],
    "mcp_servers": ["github"],
    "status": "running",
    "last_heartbeat": "2026-03-31T07:00:00Z"
  }
}
```

**对我们的启发**：Commander 应该维护一个 `lobsters-registry.json`（龙虾注册表），记录每只龙虾的实时状态、能力、通道、最后心跳等，取代散落在多个文件中的注册信息。

#### 3. Skill 目录结构标准化

HiClaw 的 Skill 目录包含 `SKILL.md`（含 Gotchas 陷阱列表）+ `references/`（按需加载参考文档）+ `scripts/`（可执行脚本）。

**对我们的启发**：
- 每个龙虾技能应该有 **Gotchas** 节——记录常见错误和陷阱
- 参考文档应该**按需加载**（"读了再干"），不是一次全部加载
- 技能应该关联可执行脚本（API 调用模板、shell 命令等）

### 🟡 P1 借鉴（架构强化期）

#### 4. 容器生命周期管理

为边缘执行端（BBP/提线木偶）引入生命周期管理：

```json
{
  "edge_runtime_douyin": {
    "container_state": "running",
    "last_active": "2026-03-31T07:00:00Z",
    "idle_since": null,
    "idle_timeout_minutes": 30,
    "auto_stop": true,
    "auto_restart_on_task": true
  }
}
```

#### 5. 透明通信房间模式

借鉴 HiClaw 的 Matrix Room 模式，为龙虾间通信增加"可观察"层：
- 每只龙虾有一个"工作房间"
- 人类管理员可以加入任何房间实时观察
- 所有龙虾间通信通过 lobster_event_bus 同时推送到对应房间
- 不需要完全迁移到 Matrix，但需要可观察性

#### 6. 声明式龙虾管理

参考 HiClaw 的 K8s CRD，创建龙虾声明式配置格式：

```yaml
# lobster-radar.yaml
apiVersion: openclaw.io/v1
kind: Lobster
metadata:
  name: radar
spec:
  displayName: 触须虾
  model: claude-sonnet-4-20250514
  soul: ./SOUL.md
  skills:
    - competitor-tracking
    - trend-scanning
    - sentiment-alert
  heartbeat:
    intervalMinutes: 30
    onWake:
      - check_new_events
      - check_pending_tasks
  tokenBudget:
    perTask: 8000
    dailyLimit: 200000
status:
  phase: Online
  lastHeartbeat: "2026-03-31T07:00:00Z"
  currentTask: null
```

#### 7. YOLO 模式 / Autonomy 级别开关

合并 Clawith 的 L1/L2/L3 和 HiClaw 的 yolo-mode：

```json
{
  "autonomy_level": "L2",  // L1=人工确认所有, L2=低风险自主, L3=全自主(YOLO)
  "yolo_mode": false,       // 等价于 L3
  "auto_approve_threshold": 0.8  // L2 模式下置信度 > 0.8 自动执行
}
```

### 🟢 P2 借鉴（远期架构）

#### 8. AI Gateway 统一入口

参考 Higress，建立统一的 AI Gateway：
- 所有 LLM 调用通过 Gateway（限速/日志/成本控制）
- 所有 MCP 工具调用通过 Gateway（权限控制）
- 所有外部 API 凭证集中管理（龙虾永远不直接接触凭证）

#### 9. Team 层级编排

未来如果龙虾数量增加，引入 Team 概念：
- 行业团队（美容团队 = 定制触须虾 + 定制吐墨虾 + 定制幻影虾）
- Team Leader 负责团队内部协调
- Commander 只和 Team Leader 通信

---

## 五、与现有 Codex 任务的关联

| HiClaw 借鉴点 | 已有 Codex 任务 | 关联说明 |
|---------------|---------------|---------|
| HEARTBEAT 7 步检查 | CODEX-AA-01 | **升级**：从简单 heartbeat.json 升级为 7 步管理例会 |
| state.json 运行时状态 | CODEX-AA-01 (working.json) | **增强**：增加 active_tasks 全局视图 |
| Worker 注册表 | CODEX-OCM-03 | **新增**：lobsters-registry.json |
| 容器生命周期 | CODEX-MC-01 | **增强**：从简单心跳升级为完整容器生命周期 |
| Skill 目录结构 | CODEX-CAP-01 | **增强**：增加 Gotchas + references/ + scripts/ |
| 透明通信 | CODEX-OIM-01 (EventBus) | **增强**：增加人类可观察房间 |
| 声明式管理 | CODEX-DOC-01 (Docker 部署) | **升级方向**：从 Docker 到声明式 YAML |
| YOLO 模式 | CODEX-CW-02 (Autonomy Policy) | **简化**：增加一个文件开关 |
| AI Gateway | provider_registry | **升级方向**：从代码级注册到网关级代理 |

---

## 六、核心结论

### 一句话总结

> **HiClaw 是目前最成熟的开源多 Agent 协作操作系统。它最大的贡献是证明了 "Manager + Worker + Matrix IM + 声明式 CRD + 7 步心跳管理例会 + 容器生命周期" 这套架构在生产中可以工作。我们最应该借鉴的是它的 HEARTBEAT 管理例会模式、Worker 注册表、容器生命周期管理和 Skill 目录标准化。**

### 与历次借鉴的四方印证

| 维度 | Clawith | Awesome Agents | HiClaw | 我们的差距 |
|------|---------|---------------|--------|-----------|
| **自主唤醒** | Aware 触发 | HEARTBEAT.md 简版 | **7 步管理例会** | ❌ 完全缺失 |
| **身份人格** | soul.md | SOUL.md (丰富) | SOUL.md + AI Identity | 🟡 role-card 太薄 |
| **运行规则** | Autonomy Policy | AGENTS.md | AGENTS.md + TOOLS.md | 🟡 散落代码中 |
| **状态管理** | focus.json + state.json | WORKING.md | **state.json + lifecycle.json** | ❌ 完全缺失 |
| **多 Agent 协作** | A2A + Participant | ❌ 无 | **Manager → Leader → Worker** | 🟡 两级编排 |
| **通信可观察** | ❌ | ❌ | **Matrix Room 全透明** | ❌ 不透明 |
| **容器管理** | ❌ | ❌ | **lifecycle + 自动休眠/唤醒** | ❌ 完全缺失 |
| **声明式管理** | ❌ | ❌ | **K8s CRD** | ❌ 硬编码 |
| **执行能力** | 简单 Poll | ❌ 无 | Shell + MCP | ✅ BBP + 提线木偶 |
| **行业深度** | ❌ | ❌ | ❌ | ✅ 行业知识包 |

### 行动优先级

| 排名 | 借鉴点 | 投入 | 价值 | 路径 |
|------|--------|------|------|------|
| **1** | HEARTBEAT 7 步管理例会 | 中 | 🔴 极高 | 升级 CODEX-AA-01 的 heartbeat |
| **2** | Worker 注册表 | 低 | 🔴 高 | 新增 `lobsters-registry.json` |
| **3** | Skill Gotchas + 按需加载 | 低 | 🔴 高 | 升级 Skill 目录结构 |
| **4** | 容器生命周期管理 | 中 | 🟡 中高 | 边缘执行端 lifecycle |
| **5** | 透明通信可观察 | 中 | 🟡 中 | EventBus → 可观察房间 |
| **6** | YOLO 模式开关 | 低 | 🟡 中 | autonomy_level 配置 |
| **7** | 声明式龙虾管理 | 高 | 🟢 远期 | 声明式 YAML 配置 |
| **8** | AI Gateway | 高 | 🟢 远期 | Higress 或类似网关 |
| **9** | Team 层级编排 | 高 | 🟢 远期 | 行业团队概念 |
