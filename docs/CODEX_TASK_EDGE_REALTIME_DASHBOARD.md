# CODEX TASK: 实时边缘节点指标仪表盘

**优先级：P1**  
**来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#3（MeshCentral 实时设备状态仪表盘）**

---

## 背景

我们的 `edge_heartbeat` 已采集边缘节点指标（CPU/内存/任务数），但前端缺少实时聚合展示页面。借鉴 MeshCentral 设备实时仪表盘设计，在前端实现边缘节点总览 + 单节点详情，消费已有的 heartbeat 数据，无需新增后端采集逻辑。

---

## 一、后端聚合 API（云端）

```python
# dragon-senate-saas-v2/api_edge_metrics.py

from fastapi import APIRouter, Depends
from .tenant_context import get_tenant_context

router = APIRouter(prefix="/api/v1")

@router.get("/edges/metrics/overview")
async def edge_metrics_overview(ctx=Depends(get_tenant_context)):
    """
    边缘节点总览指标（前端轮询，每5秒刷新）
    消费 edge_heartbeat 最新记录
    """
    nodes = db.list_edge_nodes(tenant_id=ctx.tenant_id)
    online = [n for n in nodes if n.is_online]
    offline = [n for n in nodes if not n.is_online]

    # 从心跳表取最新指标
    heartbeats = {n.edge_id: db.get_latest_heartbeat(n.edge_id) for n in online}

    return {
        "total": len(nodes),
        "online": len(online),
        "offline": len(offline),
        "avg_cpu_pct": _avg([h.cpu_pct for h in heartbeats.values() if h]),
        "avg_mem_pct": _avg([h.mem_pct for h in heartbeats.values() if h]),
        "total_pending_tasks": sum(h.pending_tasks for h in heartbeats.values() if h),
        "nodes": [
            {
                "edge_id": n.edge_id,
                "name": n.name,
                "is_online": n.is_online,
                "tags": n.tags or [],
                "version": heartbeats.get(n.edge_id, {}).get("version"),
                "cpu_pct": heartbeats.get(n.edge_id, {}).get("cpu_pct"),
                "mem_pct": heartbeats.get(n.edge_id, {}).get("mem_pct"),
                "pending_tasks": heartbeats.get(n.edge_id, {}).get("pending_tasks", 0),
                "last_seen": n.last_heartbeat_at,
            }
            for n in nodes
        ],
    }

@router.get("/edges/{edge_id}/metrics/history")
async def edge_metrics_history(
    edge_id: str,
    minutes: int = 60,
    ctx=Depends(get_tenant_context),
):
    """单节点历史指标（折线图数据，最近N分钟）"""
    records = db.get_heartbeat_history(edge_id, minutes=minutes)
    return {
        "edge_id": edge_id,
        "points": [
            {
                "ts": r.ts,
                "cpu_pct": r.cpu_pct,
                "mem_pct": r.mem_pct,
                "pending_tasks": r.pending_tasks,
            }
            for r in records
        ],
    }

def _avg(values: list) -> float:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else 0.0
```

---

## 二、前端总览仪表盘

```typescript
// web/src/app/edges/dashboard/page.tsx

export function EdgeDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["edge-metrics-overview"],
    queryFn: api.getEdgeMetricsOverview,
    refetchInterval: 5000,   // 每5秒自动刷新
  });
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const filteredNodes = useMemo(() => {
    if (!tagFilter.length) return data?.nodes || [];
    return (data?.nodes || []).filter(n =>
      tagFilter.every(t => n.tags.includes(t))
    );
  }, [data, tagFilter]);

  return (
    <div className="space-y-4">
      {/* 顶部汇总卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard title="总节点" value={data?.total} icon={<Server />} />
        <MetricCard title="在线" value={data?.online}
          icon={<Circle className="text-green-500" />} trend="online" />
        <MetricCard title="平均 CPU" value={`${data?.avg_cpu_pct}%`}
          icon={<Cpu />} alert={data?.avg_cpu_pct > 80} />
        <MetricCard title="待处理任务" value={data?.total_pending_tasks}
          icon={<ListTodo />} />
      </div>

      {/* 标签筛选器（来自 CODEX_TASK_EDGE_NODE_TAGS） */}
      <EdgeTagFilter onChange={setTagFilter} />

      {/* 节点列表（实时指标） */}
      {isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredNodes.map(node => (
            <EdgeNodeCard key={node.edge_id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

// 单节点卡片
function EdgeNodeCard({ node }: { node: EdgeNodeMetric }) {
  return (
    <Card className={cn("p-4", !node.is_online && "opacity-50 border-dashed")}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-medium text-sm">{node.name}</div>
          <div className="text-xs text-muted-foreground font-mono">{node.edge_id.slice(-8)}</div>
        </div>
        <Badge variant={node.is_online ? "default" : "secondary"}>
          {node.is_online ? "● 在线" : "○ 离线"}
        </Badge>
      </div>

      {node.is_online && (
        <>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">CPU</span>
              <span className={cn("font-mono", node.cpu_pct > 80 && "text-red-500")}>
                {node.cpu_pct}%
              </span>
            </div>
            <Progress value={node.cpu_pct}
              className={cn("h-1", node.cpu_pct > 80 && "[&>div]:bg-red-500")} />

            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">内存</span>
              <span className={cn("font-mono", node.mem_pct > 85 && "text-orange-500")}>
                {node.mem_pct}%
              </span>
            </div>
            <Progress value={node.mem_pct}
              className={cn("h-1", node.mem_pct > 85 && "[&>div]:bg-orange-500")} />
          </div>

          <div className="flex justify-between items-center mt-3 text-xs">
            <span className="text-muted-foreground">
              待处理 <span className="font-mono text-foreground">{node.pending_tasks}</span>
            </span>
            <span className="text-muted-foreground">
              {node.version || "—"}
            </span>
          </div>
        </>
      )}

      {!node.is_online && (
        <div className="text-xs text-muted-foreground mt-2">
          最后在线：{formatRelativeTime(node.last_seen)}
        </div>
      )}

      {/* 标签 */}
      <div className="flex flex-wrap gap-1 mt-2">
        {(node.tags || []).slice(0, 3).map(t => (
          <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>
        ))}
        {node.tags?.length > 3 && (
          <Badge variant="outline" className="text-[10px] px-1 py-0">+{node.tags.length - 3}</Badge>
        )}
      </div>
    </Card>
  );
}
```

---

## 三、单节点详情页（历史折线图）

```typescript
// web/src/app/edges/[edgeId]/metrics/page.tsx

export function EdgeMetricsDetailPage({ params }: { params: { edgeId: string } }) {
  const [range, setRange] = useState(60); // 分钟
  const { data } = useQuery({
    queryKey: ["edge-metrics-history", params.edgeId, range],
    queryFn: () => api.getEdgeMetricsHistory(params.edgeId, range),
    refetchInterval: 30000,
  });

  const chartData = data?.points || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">节点指标 — {params.edgeId}</h2>
        <Select value={String(range)} onValueChange={v => setRange(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">近30分钟</SelectItem>
            <SelectItem value="60">近1小时</SelectItem>
            <SelectItem value="360">近6小时</SelectItem>
            <SelectItem value="1440">近24小时</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* CPU 折线图（复用 CODEX_TASK_SHADCN_CHARTS 已落地图表）*/}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">CPU 使用率</h3>
        <LineChart data={chartData} xKey="ts" yKey="cpu_pct"
          color="hsl(var(--primary))" unit="%" threshold={80} />
      </Card>

      {/* 内存折线图 */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">内存使用率</h3>
        <LineChart data={chartData} xKey="ts" yKey="mem_pct"
          color="hsl(var(--chart-2))" unit="%" threshold={85} />
      </Card>

      {/* 待处理任务趋势 */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">待处理任务数</h3>
        <BarChart data={chartData} xKey="ts" yKey="pending_tasks"
          color="hsl(var(--chart-3))" />
      </Card>
    </div>
  );
}
```

---

## 验收标准

**后端（dragon-senate-saas-v2/api_edge_metrics.py）：**
- [ ] `GET /edges/metrics/overview`：汇总（总/在/离）+ 节点列表（含CPU/内存/任务/版本/标签）
- [ ] `GET /edges/{edge_id}/metrics/history`：历史心跳记录（?minutes=60）
- [ ] 消费已有 `edge_heartbeat` 表，无需新增采集
- [ ] 按租户隔离（tenant_context）

**前端（web/src/app/edges/dashboard/）：**
- [ ] 4个汇总卡片：总节点/在线/平均CPU/待处理任务
- [ ] 节点卡片网格：在线节点实时 CPU/内存进度条（超阈值变红/橙）
- [ ] 离线节点显示最后在线时间（半透明）
- [ ] 标签筛选（集成 `EdgeTagFilter`，来自 EDGE_NODE_TAGS）
- [ ] 每5秒自动刷新（`refetchInterval: 5000`）
- [ ] 单节点详情页：CPU/内存/任务折线图（30min/1h/6h/24h）
- [ ] 时间范围选择器（Select 组件）

---

*Codex Task | 来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
