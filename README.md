# ClawCommerce Agent

基于 OpenClaw 的商业化 AI 运营 SaaS（代号 ClawCommerce）— Agent 核心：节点管理、内容产出、线索提取、Prompt 优化与安全合规。

---

## 最终成品入口（总负责人签发）

| 你要… | 做法 |
|--------|------|
| **一眼看完交付物与启动方式** | 打开 **[docs/最终交付_总负责人签发_v1.0.md](docs/最终交付_总负责人签发_v1.0.md)** |
| **客户演示（无后端）** | 双击 **`启动演示控制台.bat`** 或 `cd web && npm run dev`，浏览器打开 **终端里显示的 Local 地址 + `/demo.html`**（如 `http://localhost:3005/demo.html`） |
| **一号客户 VIP 黑框连总控** | 配置 `scripts/vip-build/.env.vip` 后双击 **`scripts/vip-build/启动VIP客户端.bat`** 或 `npm run vip:run` |
| **总控后端 + Redis** | `docker compose -f docker-compose.backend.yml up -d` 后 `cd backend && npm run start:dev` |
| **客户能装什么 / 不能装什么** | **[docs/项目进度与安装就绪_客户版.md](docs/项目进度与安装就绪_客户版.md)** |

---

## 当前交付：OpenClaw 节点管理核心引擎

- **node-manager**：主调度引擎（带 Redis 分布式锁）
- **node-pool**：节点池（内存 + Redis 持久化）
- **health-monitor**：5 分钟 CDP 心跳 + 自动恢复
- **phone-pool**：手机号池（SMS-Activate / 5SIM / TigerSMS 集成位）
- **Dashboard API**：`GET /api/agent/nodes/status` + WebSocket 事件推送说明

### 使用方法

见 [src/agent/README.md](src/agent/README.md)。

### 测试

```bash
# 需要本地 Redis
export REDIS_URL=redis://localhost:6379
npm install
npm run build
npm test
```

### Docker

```bash
docker compose up -d
# Redis + Agent 进程（Agent 依赖 Redis 健康后启动）
```

### 配置项

| 环境变量 | 说明 |
|----------|------|
| REDIS_URL | Redis 连接（必填） |
| MAX_NODES | 最大节点数 |
| IDLE_RELEASE_MINUTES | 闲置释放分钟数 |
| HEARTBEAT_INTERVAL_MS | 健康检查间隔（毫秒） |
| LOG_LEVEL | 日志级别 |

## 技术栈

- TypeScript + Node.js 20+
- Redis（节点状态、锁）、MongoDB（日志，后续）
- BullMQ（定时任务，后续）、Winston、Zod

## 与后端协作

- 后端提供多租户、WebSocket、数据库持久化。
- 本仓库提供 **内部 API**：`NodeManager.getNodesStatus()`、`NodeManager.allocate(campaign)`、`NodeManager.release(nodeId)`。
- Dashboard：后端挂载 `getNodesStatusHandler(nodeManager)` 为 `GET /api/agent/nodes/status`，并通过 `onEvent` 将事件推送到 WebSocket。

## 本地运行（三步）

1. **安装与构建**（需 Node 20+、Redis）
   ```bash
   npm install
   npm run build
   npm test
   ```

2. **挂载 Dashboard API + WebSocket**
   - 示例后端：`npm run server` 启动后：
     - `GET http://localhost:38789/api/agent/nodes/status` 获取节点状态
     - `WS ws://localhost:38789/api/agent/nodes/events` 接收实时事件
   - 或在你自己的后端中挂载 `getNodesStatusHandler(nodeManager)`，并在创建 NodeManager 时传入 `onEvent` 做 WebSocket 广播。

3. **内容产出与二创（content/）**
   - `src/content/prompt-engine.ts`：Prompt 模板 + RAG，按行业/平台加载 JSON
   - `src/content/content-generator.ts`：LLM 二创脚本生成
   - `src/content/browser-orchestrator.ts`：Playwright 真实操作（骨架）
   - `src/content/anti-detection.ts`：反检测策略
   - `src/content/skills/`：小红书发帖等技能（可热加载）
   - 模板示例：`src/content/templates/beauty/`、`fitness/`
   - 测试：`npm run test:content`

## 后续模块（按 PRD）

- 线索提取与自动回传（lead/）
- Prompt 持续优化与 A/B 测试 + 安全与合规
