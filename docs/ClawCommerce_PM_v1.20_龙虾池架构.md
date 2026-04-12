# ClawCommerce PM 文档 v1.20  
## 战略级升级：分布式「龙虾池」架构 (Remote C&C) 与客户端下放

**致：** 小军（全栈/Agent）、小明（后端）  
**结论：** 节点不再全部托管在自家服务器；改为 **商家侧极简客户端 + 云端总控**，长连接穿透 NAT，任务只下发到 **租户自有设备池**。

---

## 1. 核心架构重构（范式转移）

| 原范式 | 新范式 |
|--------|--------|
| 后端主动 HTTP POST 调 Agent | **Agent 启动后主动建长连接**（WebSocket / gRPC）连云端；任务由云端经连接 **推送** |
| 客户机在 NAT 后无公网 IP | **无需公网**；由客户端出站连接解决穿透 |
| NodeManager 全局共享池 | **Tenant Node Pool**：每个商家任务 **只能** 下发到已绑定给自己的设备 |

---

## 2. 功能模块拆解与负责人

### 功能一：一键安装「龙虾客户端」(Claw Agent Installer) — **小军**

**产品形态：** Electron 或 Tauri 桌面端（Windows / Mac），**零 Docker / 零 Node 配置**。

| 能力 | 说明 |
|------|------|
| **扫码绑定** | 客户端展示二维码 → 手机/网页扫码 → 物理设备与云端 **Tenant ID** 绑定 |
| **静默运行** | 后台拉起 OpenClaw + Playwright 无头环境 |
| **心跳** | **约每 10s** 上报健康度：CPU、内存、网络状态 → 小明 C&C 落库/转发 |
| **OTA** | 反爬策略 / Prompt 模板热更新，**静默**，无需商家重装 |

**技术线索（Implementation hints）：**  
- 绑定码/Provisioning 与现有 `ProvisioningToken`、`/demo` 流程可统一为 **同一套注册 API**。  
- 心跳 Topic/事件名需与 Fleet 大盘、MQTT/WS 约定对齐（见功能三）。

---

### 功能二：云端「龙虾池」总控中心 (C&C Server) — **小明**

| 模块 | 说明 |
|------|------|
| **Device Registry** | 新表 `ClientDevice`：MAC、内网 IP、租户、状态（在线/离线/忙碌） |
| **双向通信** | Socket.io 或 `@nestjs/websockets`；**出站由 Agent 发起**，服务端仅推送 |
| **task.dispatch** | BullMQ 出队 Campaign → 查租户在线设备 → **WS 下发** JSON 策略 |
| **lead.report** | 接收客户端线索 → 走现有 **AES + 计费扣费** |
| **离线容错** | 断网时任务 **挂起队列**；设备重连后继续下发 |

---

### 功能三：前端「设备监控大盘」(Fleet Management) — **小军（UI）**

**目标：** 商家看到「电费/设备在干什么」。

| 展示 | 说明 |
|------|------|
| **列表/卡片** | 已绑定电脑/节点；状态灯 🟢 运行中 / 🟡 冷却中 / 🔴 离线 |
| **实时** | 与 C&C 或 MQTT/WS 心跳对齐；现有 `/fleet` 可为 v1 形态 |
| **远程画面探针（杀手级）** | 点击设备 → 经 **WebSocket 回传** Playwright 当前页 **截图流/单帧**；满足可控感与审计 |

**与当前仓库对齐：**

- 已有：**Fleet 页** `/fleet`、`RemoteNode` / `TaskCommand` 类型、`node.service` Mock、**MQTT 订阅** `clawcommerce/nodes/+/status`、**MQTT 下发** `.../commands`。  
- 待补：**画面探针**（WS 二进制或 base64 帧 + 前端 `<img>`/canvas）、**Tenant 严格隔离**（API 只返回本租户设备）、**状态枚举与 UI 文案**（运行中/冷却中/离线）与 PM 一致。

---

## 3. 建议里程碑（供排期）

1. **M1** 小明：ClientDevice + WS 通道 + 心跳入库；小军：客户端最小壳 + 扫码绑定 + 10s 心跳。  
2. **M2** task.dispatch / lead.report 走 WS；BullMQ 与断线挂起。  
3. **M3** Fleet 与 C&C 字段对齐；状态灯与列表稳定。  
4. **M4** 远程画面探针（单帧 MVP → 可选低帧率流）。  
5. **M5** OTA 管道与版本回滚。

---

## 4. 文档维护

- 本文档路径：`docs/ClawCommerce_PM_v1.20_龙虾池架构.md`  
- 前端 MQTT 话题与 Hook 说明：`web/MQTT_集成说明.md`  
- 类型与下发结构：`web/src/types/index.ts`、`web/src/services/node.service.ts`
