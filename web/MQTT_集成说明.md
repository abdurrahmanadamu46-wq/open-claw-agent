# MQTT 云边协同（龙虾池）集成说明

## 依赖

```bash
cd web
npm install mqtt
```

已写入 `package.json`；若未安装请执行上述命令。

## 环境变量

在 `.env.local` 中配置：

```env
NEXT_PUBLIC_MQTT_URL=wss://your-broker:8084/mqtt
```

未配置时：**不会抛错**；Fleet 仍用初始 Mock + 本地「模拟心跳」调试；任务下发会 Toast，并在 MQTT 连上后由单例 client 补发（当前实现为 publish 时若未连上会 best-effort）。

## 话题约定

| 方向 | Topic | 说明 |
|------|--------|------|
| 边 → 云 | `clawcommerce/nodes/+/status` | 节点心跳/状态；Payload JSON 建议含 `nodeId`、`status`、`cpuPercent`、`memoryPercent`、`platforms`、`lastPingAt` 等 |
| 云 → 边 | `clawcommerce/nodes/{nodeId}/commands` | 下发指令；消息体为 **TaskCommand** JSON（见 `src/types/index.ts`） |

## Hook

- `src/hooks/useMQTT.ts`：`subscribe`、`publish`、单例连接、卸载时取消本组件订阅。
- Fleet 页订阅 `clawcommerce/nodes/+/status`，3 分钟无心跳将节点标为 OFFLINE。
- 抽屉内向 `clawcommerce/nodes/{targetNodeId}/commands` 发布整条 `TaskCommand`。

## 调试

Fleet 页顶栏右侧有半透明 **「模拟心跳」** 按钮，点击后对第一个节点做一次本地状态合并，用于无 Broker 时预览进度条动画。
