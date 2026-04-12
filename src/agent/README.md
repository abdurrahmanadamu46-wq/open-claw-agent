# ClawCommerce Agent - OpenClaw Node Management Core

OpenClaw 节点管理核心引擎：动态分配、健康监控、手机号池、空闲释放、Dashboard API。

## 目录结构

```
src/agent/
├── node-manager.ts      # 主调度引擎（带锁）
├── node-pool.ts         # 节点池（内存 + Redis 持久化）
├── health-monitor.ts    # 心跳 + 自动恢复
├── phone-pool.ts        # 手机号池（SMS-Activate / 5SIM / TigerSMS）
├── dashboard-api.ts    # GET /api/agent/nodes/status + WebSocket 说明
├── logger.ts           # Winston 日志
├── types.ts             # 类型定义
└── index.ts             # 对外 API
```

## 使用方法

### 配置（环境变量）

- `REDIS_URL`：Redis 连接（必填）
- `MAX_NODES`：最大节点数（默认 10）
- `IDLE_RELEASE_MINUTES`：空闲多少分钟后自动释放（默认 30）
- `HEARTBEAT_INTERVAL_MS`：健康检查间隔（默认 5 分钟）

### 初始化与启动

```ts
import Redis from 'ioredis';
import { NodePool, HealthMonitor, PhonePool, NodeManager, createLogger } from './agent';

const redis = new Redis(process.env.REDIS_URL!);
const nodePool = new NodePool({ redis });
await nodePool.syncFromRedis();

const logger = createLogger('clawcommerce-agent');
const healthMonitor = new HealthMonitor({
  nodePool,
  logger,
  intervalMs: 5 * 60 * 1000,
  checkCdp: async (cdpEndpoint) => {
    // 实现 CDP 连通性检查（如 ws 连接）
    return { ok: true };
  },
  getResourceUsage: async (nodeId, containerId) => {
    // 可选：从容器/主机获取 CPU、内存
    return {};
  },
  onUnhealthy: async (nodeId, reason) => {
    // 重启容器或切换节点
  },
});

const phonePool = new PhonePool({
  adapters: {
    'sms-activate': smsActivateAdapter,
    // '5sim': fiveSimAdapter,
  },
});

const nodeManager = new NodeManager({
  redis,
  maxNodes: parseInt(process.env.MAX_NODES ?? '10', 10),
  idleReleaseMinutes: parseInt(process.env.IDLE_RELEASE_MINUTES ?? '30', 10),
  nodePool,
  healthMonitor,
  phonePool,
  spawnNode: async () => {
    // 可选：从云拉取新容器，返回 NodeStatus
    return null;
  },
  onEvent: (event) => {
    // WebSocket 推送：broadcast(JSON.stringify(event))
  },
});

await nodeManager.start();
```

### 分配与释放

```ts
const campaign: CampaignConfig = { ... };
const result = await nodeManager.allocate(campaign);
if (result) {
  // result.nodeId, result.nodeStatus, result.phoneNumberId, result.expiresAt
}
await nodeManager.release(result.nodeId);
```

### Dashboard API

- **GET /api/agent/nodes/status**：使用 `getNodesStatusHandler(nodeManager)` 挂到后端路由，返回 `NodesStatusResponse`。
- **WebSocket 实时推送**：在构造 `NodeManager` 时传入 `onEvent`，将 `node_allocated` / `node_released` / `node_unhealthy` 等事件广播给前端。

详见 `dashboard-api.ts` 中的 `WS_PUSH_DOC`。

## 测试

```bash
# 需本地 Redis
export REDIS_URL=redis://localhost:6379
npm test

# 仅 agent 模块
npm run test:agent
```

## 配置项摘要

| 配置项 | 说明 |
|--------|------|
| Redis | 节点状态持久化、分布式锁 |
| checkCdp | 每 5 分钟检查 CDP 是否可达 |
| getResourceUsage | 可选 CPU/内存，超过 80% 判为 unhealthy |
| onUnhealthy | 触发重启/切换节点 |
| idleReleaseMinutes | 闲置超时自动释放节点与手机号 |
| spawnNode | 可选，水平扩容时创建新节点 |

## Docker

见项目根目录 `Dockerfile` 与 `docker-compose.yml`。
