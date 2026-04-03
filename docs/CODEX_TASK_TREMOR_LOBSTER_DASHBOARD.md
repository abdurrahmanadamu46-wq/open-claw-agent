# CODEX TASK: Tremor 龙虾运营监控大盘
**任务ID**: CODEX-TREMOR-P1-001  
**优先级**: 🟠 P1（运营可视化：10只龙虾运行状态、任务执行、边缘节点一屏可见）  
**依赖文件**: `dragon-senate-saas-v2/dragon_dashboard.html`（当前粗糙原型）  
**参考项目**: Tremor（https://github.com/tremorlabs/tremor）— React 数据可视化组件库  
**预计工期**: 2天

---

## 一、当前痛点

**`dragon_dashboard.html` 现状**：一个单文件 HTML，无组件化，无实时数据。

**运营日常需要一屏看到**：
- 10只龙虾当前状态（空闲/忙碌/异常/熔断）
- 今日任务执行量（成功/失败/排队中）
- 边缘节点在线数 & 健康状态
- LLM Token 消耗 & 成本趋势
- 告警事件列表

**Tremor 优势**（vs 自己画 ECharts）：
- 专为 Dashboard 设计的 React 组件（BarChart, AreaChart, KPI Card, Badge...）
- 基于 Tailwind CSS，风格统一
- 开箱即用的数据卡片、趋势图、状态表格
- 小型项目不需要 Grafana 重型方案

---

## 二、龙虾大盘布局设计

```
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw 龙虾参谋部 — 运营大盘                              │
├─────────┬──────────┬──────────┬──────────┬──────────────────┤
│ 总任务数 │ 成功率    │ 在线节点  │ Token消耗 │ 告警数           │
│  1,247  │  94.2%   │  12/15   │ ¥328.50  │ 3 ⚠️            │
├─────────┴──────────┴──────────┴──────────┴──────────────────┤
│                                                             │
│  ┌─ 龙虾状态卡片（10只）─────────────────────────────────┐   │
│  │ 🦞陈总 ● 忙碌  │ 🦞苏丝 ● 空闲  │ 🦞墨小鸦 ● 忙碌    │   │
│  │ 🦞老建 ● 空闲  │ 🦞林涛 ● 空闲  │ 🦞影子 ● 忙碌      │   │
│  │ 🦞铁狗 ● 空闲  │ 🦞阿声 ● 熔断⚡ │ 🦞算无遗策 ● 空闲  │   │
│  │ 🦞小锤 ● 空闲  │                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ 任务趋势（AreaChart）─────────────────────────────────┐  │
│  │  📈 24h 任务执行量趋势（成功/失败/排队）                  │  │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ 边缘节点表格（Table）──────────────────────────────────┐ │
│  │ 节点ID  | IP          | 状态  | 活跃任务 | 最后心跳      │ │
│  │ edge-01 | 10.0.1.101  | ✅   | 3       | 5s ago       │ │
│  │ edge-02 | 10.0.1.102  | ⚠️   | 0       | 45s ago      │ │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ 告警事件流（List）─────────────────────────────────────┐ │
│  │ 🔴 21:03 阿声(echoer) 熔断触发 — 连续3次LLM超时        │ │
│  │ 🟡 20:47 edge-03 心跳超时 — 可能离线                    │ │
│  │ 🟡 20:15 Token消耗超日预算80%                           │ │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、核心组件实现

```tsx
// src/dashboard/LobsterDashboard.tsx

import {
  Card,
  Metric,
  Text,
  AreaChart,
  BarChart,
  Badge,
  BadgeDelta,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Grid,
  Col,
  Title,
  Flex,
} from "@tremor/react";

// ═══ KPI 卡片行 ═══
function KPICards({ stats }) {
  return (
    <Grid numItemsSm={2} numItemsLg={5} className="gap-4">
      <Card>
        <Text>总任务数</Text>
        <Metric>{stats.totalTasks}</Metric>
        <BadgeDelta deltaType="increase" size="xs">+12%</BadgeDelta>
      </Card>
      <Card>
        <Text>成功率</Text>
        <Metric>{stats.successRate}%</Metric>
        <BadgeDelta deltaType={stats.successRate > 90 ? "increase" : "decrease"}>
          {stats.successRate > 90 ? "健康" : "需关注"}
        </BadgeDelta>
      </Card>
      <Card>
        <Text>在线节点</Text>
        <Metric>{stats.onlineNodes}/{stats.totalNodes}</Metric>
      </Card>
      <Card>
        <Text>Token消耗（¥）</Text>
        <Metric>¥{stats.tokenCost}</Metric>
      </Card>
      <Card>
        <Text>活跃告警</Text>
        <Metric>{stats.activeAlerts}</Metric>
        <Badge color={stats.activeAlerts > 0 ? "red" : "green"}>
          {stats.activeAlerts > 0 ? "需处理" : "正常"}
        </Badge>
      </Card>
    </Grid>
  );
}

// ═══ 龙虾状态卡片 ═══
const LOBSTER_STATUS_COLOR = {
  idle: "green",
  busy: "yellow", 
  error: "red",
  circuit_open: "red",
};

function LobsterStatusGrid({ lobsters }) {
  return (
    <Card>
      <Title>🦞 龙虾参谋状态</Title>
      <Grid numItemsSm={3} numItemsLg={5} className="gap-3 mt-4">
        {lobsters.map((l) => (
          <Card key={l.id} className="p-3">
            <Flex justifyContent="between">
              <Text className="font-bold">{l.name_zh}</Text>
              <Badge color={LOBSTER_STATUS_COLOR[l.status]}>
                {l.status === "idle" ? "空闲" :
                 l.status === "busy" ? "忙碌" :
                 l.status === "circuit_open" ? "熔断" : "异常"}
              </Badge>
            </Flex>
            <Text className="text-xs mt-1">
              今日: {l.tasks_today}次 | 成功: {l.success_rate}%
            </Text>
          </Card>
        ))}
      </Grid>
    </Card>
  );
}

// ═══ 任务趋势图 ═══
function TaskTrendChart({ chartData }) {
  return (
    <Card>
      <Title>📈 24h 任务执行趋势</Title>
      <AreaChart
        className="h-72 mt-4"
        data={chartData}
        index="hour"
        categories={["成功", "失败", "排队"]}
        colors={["emerald", "red", "yellow"]}
        valueFormatter={(v) => `${v} 次`}
      />
    </Card>
  );
}

// ═══ 边缘节点表格 ═══
function EdgeNodeTable({ nodes }) {
  return (
    <Card>
      <Title>🖥️ 边缘节点</Title>
      <Table className="mt-4">
        <TableHead>
          <TableRow>
            <TableHeaderCell>节点ID</TableHeaderCell>
            <TableHeaderCell>IP</TableHeaderCell>
            <TableHeaderCell>状态</TableHeaderCell>
            <TableHeaderCell>活跃任务</TableHeaderCell>
            <TableHeaderCell>最后心跳</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {nodes.map((n) => (
            <TableRow key={n.node_id}>
              <TableCell>{n.node_id}</TableCell>
              <TableCell>{n.ip}</TableCell>
              <TableCell>
                <Badge color={n.status === "online" ? "green" : "red"}>
                  {n.status === "online" ? "在线" : "离线"}
                </Badge>
              </TableCell>
              <TableCell>{n.active_jobs?.length || 0}</TableCell>
              <TableCell>{n.last_heartbeat_ago}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ═══ 数据获取 Hook ═══
function useDashboardData() {
  // 每5秒轮询 /api/dashboard/stats
  // SSE/WebSocket 实时推送龙虾状态变更
  // 对接: observability_api.py + edge_registry.py
}
```

---

## 四、后端 API 对接

```python
# dragon-senate-saas-v2/api_dashboard.py（新建）

@app.get("/api/dashboard/stats")
async def get_dashboard_stats():
    """大盘 KPI 数据"""
    return {
        "totalTasks": await task_queue.count_today(),
        "successRate": await task_queue.success_rate_today(),
        "onlineNodes": await edge_registry.get_node_count(),
        "totalNodes": 15,
        "tokenCost": await llm_call_logger.cost_today(),
        "activeAlerts": await alert_engine.active_count(),
    }

@app.get("/api/dashboard/lobsters")
async def get_lobster_status():
    """10只龙虾实时状态"""
    return await lobster_pool_manager.all_status()

@app.get("/api/dashboard/edge-nodes")
async def get_edge_nodes():
    """边缘节点列表"""
    return await edge_registry.list_online_nodes()
```

---

## 五、验收标准

- [ ] KPI 卡片行：总任务数、成功率、在线节点、Token消耗、告警数
- [ ] 10只龙虾状态卡片：显示名字、状态Badge、今日任务数
- [ ] 24h 任务趋势 AreaChart：成功/失败/排队三条线
- [ ] 边缘节点 Table：节点ID、IP、状态、活跃任务、最后心跳
- [ ] 告警事件流：最近10条告警，红/黄分级
- [ ] 自动刷新：5秒轮询 or SSE 实时推送
- [ ] 移动端响应式（Grid 自适应 sm/md/lg）
