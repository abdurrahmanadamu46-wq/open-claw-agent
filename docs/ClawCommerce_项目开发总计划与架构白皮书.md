# ClawCommerce 项目开发总计划与架构白皮书

## 一、项目背景与核心定位

本项目代号为 **ClawCommerce**，是一个面向**短视频代运营机构**的「企业级分布式 AI 自动化 RPA 平台」。

**商业模式核心**：**C&C (Command & Control) 分布式架构**：

| 角色 | 职责 |
|------|------|
| **云端总控 (Backend)** | 多租户管理、计费锁扣费、WebSocket 任务派发与状态监控 |
| **边缘节点 (Agent / 龙虾)** | 部署在商家本地电脑上的客户端（封装 Playwright 与防风控引擎），通过 WebSocket 长连接接收总控指令，执行抓取与回传 |
| **前端控制台 (Web)** | 商家查看数据大盘、设备健康度、配置任务的 UI 界面 |

---

## 二、中心化 Master + 分布式 Worker 模型

| 角色 | 含义 | 技术形态 |
|------|------|----------|
| **Master（大脑）** | 统一调度、多租户、计费、任务派发 | ClawCommerce 后端（NestJS）+ NodeManager（由 AI Agent 工程师维护） |
| **Worker（每只龙虾）** | 每台远程电脑上一个执行单元 | **每台机器跑一个 OpenClaw 实例，Docker 容器化** |

- **通信方式**  
  - **WebSocket**：实时心跳 + 任务下发（C&C 协议）。  
  - **Redis**：节点状态缓存 + 任务队列（BullMQ）。
- **部署方式**  
  - **云服务器（推荐）**：阿里云 / 腾讯云 / AWS 新加坡区（低延迟、稳定）。Master 部署在云上，Worker 可为云主机或客户机房内的 Docker。  
  - **本地物理机**：Mac mini / Win PC 部署 Master 时，用 **Tailscale** 或 **向日葵（Sunlogin）** 做内网穿透，配合我们的轻量 Agent（或 Docker 内 OpenClaw）让远程 Worker 能连上 Master。

---

## 三、技术栈规范（强制遵守）

### 后端 (Backend)
- **框架**: NestJS
- **数据库**: PostgreSQL
- **缓存/队列**: Redis，任务队列使用 **BullMQ**
- **ORM**: TypeORM

### 前端 (Web)
- **框架**: Next.js / React
- **样式**: Tailwind CSS
- **组件库**: Shadcn UI
- **数据请求**: React Query (TanStack Query)
- **表单**: React Hook Form + Zod

### 客户端 / Agent (龙虾)
- **运行时**: Node.js
- **自动化**: Playwright
- **通信**: WebSocket (如 ws 或 socket.io-client)
- **打包**: pkg / Tauri 等打包工具

---

## 四、架构原则（与现有 docs 一致）

- **前端与 Agent 禁止直连**：所有指令与数据经总控转发，见 `架构底线_前端与Agent禁止直连.md`。
- **多租户数据隔离**：设备与任务按租户隔离，见 `标准体系_多租户数据安全与合规白皮书_供融资与大客户审计用.md`。
- **C&C 协议**：以 `C&C_WebSocket_协议规范_v1.21.md`、`C&C_协议规范_v1.23_调度增补.md` 等为准。

---

## 五、当前代码与白皮书对照（便于迭代对齐）

| 白皮书要求 | 当前状态 | 说明 |
|------------|----------|------|
| **后端：NestJS** | ✅ 已用 | `backend/` 为 NestJS 项目 |
| **后端：PostgreSQL + TypeORM** | ⏳ 未接入 | 当前无 PG、无 TypeORM，需新增模块与迁移 |
| **后端：Redis** | ✅ 已用 | 使用 `@liaoliaots/nestjs-redis`，端口 6380 |
| **后端：BullMQ** | ⏳ 未接入 | 任务队列尚未用 BullMQ，需与 C&C 派单打通 |
| **后端：WebSocket 任务派发** | ✅ 部分 | AgentCC Gateway `/agent-cc`，支持 `server.task.dispatch` 等 |
| **前端：Next.js / React** | ✅ 已用 | `web/` 为 Next.js |
| **前端：Tailwind + Shadcn** | ✅ 已用 | 现有页面已采用 |
| **前端：React Query + 表单 (RHF + Zod)** | ✅ 已用 | 仪表盘、设备与算力等已对接 |
| **Agent：Node + Playwright + WebSocket** | ✅ 已用 | VIP 龙虾脚本 + 客户包；Playwright 在它库/后续集成 |
| **Agent：pkg / Tauri 打包** | ⏳ 可选 | 当前以「客户包_免exe」+ bat 为主；有 pkg 文档 |
| **Worker = OpenClaw Docker 化** | ⏳ 目标 | 当前 Worker 为 Node 脚本（vip-lobster）；目标为每机一 OpenClaw 容器 |
| **Master 部署：云 / 本地+穿透** | 📋 已定 | 云：阿里云/腾讯云/AWS 新加坡；本地：Tailscale 或向日葵 + 轻量 Agent |

后续开发应优先补齐：**PostgreSQL + TypeORM**（租户、设备、计费持久化）、**BullMQ**（任务队列与派发），并保持与本文档及现有 C&C 协议一致。
