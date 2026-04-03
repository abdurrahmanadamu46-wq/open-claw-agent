# CODEX TASK: 事件主题流量监控（Event Bus Subject Traffic）

**优先级：P2**  
**来源：EMQX_BORROWING_ANALYSIS.md P2-#1（EMQX Dashboard 主题流量监控）**

---

## 背景

我们的 `webhook_event_bus.py` 是所有系统事件的枢纽，但目前没有流量统计能力——运营团队无法快速回答"今天告警触发了多少次"、"哪个主题消息量最高"、"边缘心跳频率是否正常"。借鉴 EMQX Dashboard 的主题流量监控设计，在 `observability_api.py` 中新增事件总线流量统计，配合前端表格展示，完成可观测性闭环。

---

## 一、后端：EventBus 流量计数器

```python
# dragon-senate-saas-v2/event_bus_metrics.py

import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List

# ── 数据结构 ───────────────────────────────────────────────

@dataclass
class SubjectStat:
    """单个 subject 的流量统计"""
    subject: str
    total_count: int = 0         # 历史总计数
    count_last_minute: int = 0   # 最近1分钟计数
    count_last_hour: int = 0     # 最近1小时计数
    last_published_at: float = 0.0
    # 滑动窗口：记录最近 60 分钟每分钟的计数
    minute_buckets: list = field(default_factory=lambda: [0] * 60)
    _bucket_ptr: int = 0         # 当前分钟指针


class EventBusMetrics:
    """
    事件总线流量计数器（线程安全）
    
    设计：
      - 按 subject 前缀聚合（system.edge.* / system.task.* / system.alert.*）
      - 滑动窗口记录每分钟计数（最近60分钟）
      - 轻量：仅内存操作，不影响 event_bus 性能
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._stats: Dict[str, SubjectStat] = defaultdict(lambda: None)
        self._last_minute_ts = int(time.time() // 60)

    def record(self, subject: str):
        """记录一次 event_bus.publish 调用（在 publish 函数中调用）"""
        now_minute = int(time.time() // 60)
        with self._lock:
            if subject not in self._stats:
                self._stats[subject] = SubjectStat(subject=subject)

            stat = self._stats[subject]
            stat.total_count += 1
            stat.last_published_at = time.time()

            # 滑动窗口：推进分钟桶
            if now_minute > self._last_minute_ts:
                minutes_passed = min(now_minute - self._last_minute_ts, 60)
                for i in range(minutes_passed):
                    ptr = (stat._bucket_ptr + i + 1) % 60
                    stat.minute_buckets[ptr] = 0  # 清空过期桶
                stat._bucket_ptr = now_minute % 60
                self._last_minute_ts = now_minute

            stat.minute_buckets[now_minute % 60] += 1

    def get_stats(self, prefix_filter: str = None) -> List[dict]:
        """
        返回所有 subject 的统计，支持前缀过滤
        prefix_filter="system.edge" → 只返回 system.edge.* 的主题
        """
        now_minute = int(time.time() // 60)
        with self._lock:
            result = []
            for subject, stat in self._stats.items():
                if prefix_filter and not subject.startswith(prefix_filter):
                    continue
                if stat is None:
                    continue

                # 计算最近1分钟、1小时
                last_1min = stat.minute_buckets[now_minute % 60]
                last_1hour = sum(stat.minute_buckets)

                result.append({
                    "subject": subject,
                    "total_count": stat.total_count,
                    "count_last_minute": last_1min,
                    "count_last_hour": last_1hour,
                    "rate_per_min": last_1min,
                    "last_published_at": stat.last_published_at,
                })

            # 按 total_count 降序
            result.sort(key=lambda x: x["total_count"], reverse=True)
            return result

    def get_prefix_aggregation(self) -> List[dict]:
        """
        按 subject 前缀聚合（tree view）
        system.edge.heartbeat  ─┐
        system.edge.offline    ─┤─ system.edge.*: 合计
        system.edge.connected  ─┘
        """
        stats = self.get_stats()
        prefix_map: Dict[str, dict] = {}
        for s in stats:
            parts = s["subject"].split(".")
            prefix = ".".join(parts[:2]) if len(parts) >= 2 else parts[0]
            if prefix not in prefix_map:
                prefix_map[prefix] = {
                    "prefix": prefix,
                    "total_count": 0,
                    "count_last_minute": 0,
                    "count_last_hour": 0,
                    "subjects": [],
                }
            prefix_map[prefix]["total_count"] += s["total_count"]
            prefix_map[prefix]["count_last_minute"] += s["count_last_minute"]
            prefix_map[prefix]["count_last_hour"] += s["count_last_hour"]
            prefix_map[prefix]["subjects"].append(s)

        return sorted(prefix_map.values(), key=lambda x: x["total_count"], reverse=True)


# 全局单例
_metrics = EventBusMetrics()

def get_event_bus_metrics() -> EventBusMetrics:
    return _metrics
```

---

## 二、集成到 webhook_event_bus.py

```python
# dragon-senate-saas-v2/webhook_event_bus.py（改造 publish）

from .event_bus_metrics import get_event_bus_metrics

class EventBus:

    async def publish(self, subject: str, data: dict):
        """发布事件（新增流量统计）"""
        # ← 新增：记录流量（不影响原有逻辑）
        get_event_bus_metrics().record(subject)

        # 原有逻辑：推送给所有订阅者
        subscribers = self._get_subscribers(subject)
        for sub in subscribers:
            try:
                await sub.handler(subject, data)
            except Exception as e:
                logger.error(f"[EventBus] 订阅者处理失败: {subject} → {e}")
```

---

## 三、API

```python
# dragon-senate-saas-v2/observability_api.py（新增接口）

from .event_bus_metrics import get_event_bus_metrics

@router.get("/observability/event-bus/subjects")
async def list_event_bus_subjects(
    prefix: str = None,
    ctx=Depends(get_tenant_context),
):
    """
    列出所有 event bus subject 的流量统计
    ?prefix=system.edge  → 只看边缘相关主题
    """
    metrics = get_event_bus_metrics()
    return {
        "subjects": metrics.get_stats(prefix_filter=prefix),
        "total_subjects": len(metrics._stats),
    }

@router.get("/observability/event-bus/prefix-summary")
async def event_bus_prefix_summary(ctx=Depends(get_tenant_context)):
    """
    按 subject 前缀聚合的流量汇总（tree view）
    """
    metrics = get_event_bus_metrics()
    return {
        "prefixes": metrics.get_prefix_aggregation(),
    }

@router.get("/observability/event-bus/top")
async def event_bus_top_subjects(
    limit: int = 10,
    ctx=Depends(get_tenant_context),
):
    """最繁忙的 N 个 subject（按 total_count 降序）"""
    metrics = get_event_bus_metrics()
    return {
        "top_subjects": metrics.get_stats()[:limit],
    }
```

---

## 四、前端展示

```typescript
// web/src/app/observability/event-bus/page.tsx

export function EventBusTrafficPage() {
  const [prefix, setPrefix] = useState<string>("");
  const { data } = useQuery({
    queryKey: ["event-bus-subjects", prefix],
    queryFn: () => api.getEventBusSubjects({ prefix: prefix || undefined }),
    refetchInterval: 10000,  // 每10秒刷新
  });

  const { data: summary } = useQuery({
    queryKey: ["event-bus-prefix-summary"],
    queryFn: api.getEventBusPrefixSummary,
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">事件总线流量</h1>
        <span className="text-xs text-muted-foreground">每10秒刷新</span>
      </div>

      {/* 前缀聚合卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summary?.prefixes.map(p => (
          <Card key={p.prefix} className="p-3 cursor-pointer hover:bg-muted/50"
            onClick={() => setPrefix(p.prefix)}>
            <div className="text-xs text-muted-foreground font-mono">{p.prefix}.*</div>
            <div className="text-xl font-bold mt-1">{p.count_last_hour.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">近1小时</div>
            <div className="text-xs mt-1">
              <span className="text-green-600">{p.count_last_minute}</span>
              <span className="text-muted-foreground"> msg/min</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Subject 明细表 */}
      <div className="flex gap-2 items-center">
        <Input
          value={prefix}
          onChange={e => setPrefix(e.target.value)}
          placeholder="按前缀筛选（如 system.edge）"
          className="w-64 h-8 text-sm"
        />
        {prefix && (
          <Button size="sm" variant="ghost" onClick={() => setPrefix("")}>
            清除
          </Button>
        )}
      </div>

      <DataTable
        data={data?.subjects || []}
        columns={[
          {
            header: "Subject",
            cell: (row) => (
              <span className="font-mono text-xs">{row.subject}</span>
            ),
          },
          {
            header: "近1分钟",
            cell: (row) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{row.count_last_minute}</span>
                <div className="w-16 bg-muted rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full"
                    style={{ width: `${Math.min(100, row.count_last_minute * 2)}%` }}
                  />
                </div>
              </div>
            ),
          },
          {
            header: "近1小时",
            accessor: "count_last_hour",
            cell: (row) => row.count_last_hour.toLocaleString(),
          },
          {
            header: "总计",
            accessor: "total_count",
            cell: (row) => row.total_count.toLocaleString(),
          },
          {
            header: "最后发布",
            cell: (row) => formatRelativeTime(row.last_published_at),
          },
        ]}
      />
    </div>
  );
}
```

---

## 五、单元测试

```python
# dragon-senate-saas-v2/tests/test_event_bus_metrics.py

import time
from unittest.mock import patch
from dragon_senate_saas_v2.event_bus_metrics import EventBusMetrics

def test_record_increments_total():
    m = EventBusMetrics()
    m.record("system.edge.heartbeat")
    m.record("system.edge.heartbeat")
    m.record("system.alert.triggered")
    stats = {s["subject"]: s for s in m.get_stats()}
    assert stats["system.edge.heartbeat"]["total_count"] == 2
    assert stats["system.alert.triggered"]["total_count"] == 1

def test_prefix_filter():
    m = EventBusMetrics()
    m.record("system.edge.heartbeat")
    m.record("system.task.dispatched")
    edge_stats = m.get_stats(prefix_filter="system.edge")
    assert all(s["subject"].startswith("system.edge") for s in edge_stats)
    assert len(edge_stats) == 1

def test_prefix_aggregation():
    m = EventBusMetrics()
    m.record("system.edge.heartbeat")
    m.record("system.edge.offline")
    m.record("system.task.dispatched")
    agg = {p["prefix"]: p for p in m.get_prefix_aggregation()}
    assert agg["system.edge"]["total_count"] == 2
    assert agg["system.task"]["total_count"] == 1

def test_sorted_by_total_count():
    m = EventBusMetrics()
    for _ in range(5): m.record("system.edge.heartbeat")
    for _ in range(2): m.record("system.alert.triggered")
    stats = m.get_stats()
    assert stats[0]["subject"] == "system.edge.heartbeat"
    assert stats[1]["subject"] == "system.alert.triggered"
```

---

## 验收标准

**后端（dragon-senate-saas-v2/event_bus_metrics.py）：**
- [ ] `EventBusMetrics.record(subject)`：线程安全计数，更新 total/分钟桶
- [ ] `get_stats(prefix_filter)`：返回所有 subject 统计，支持前缀过滤
- [ ] `get_prefix_aggregation()`：按 subject 前两段前缀聚合
- [ ] 滑动窗口：60个分钟桶，过期桶自动清零
- [ ] 全局单例 `get_event_bus_metrics()`

**集成：**
- [ ] `webhook_event_bus.publish()` 调用 `metrics.record(subject)`（< 3行改动）

**API（observability_api.py）：**
- [ ] `GET /observability/event-bus/subjects`：subject 流量列表（?prefix 过滤）
- [ ] `GET /observability/event-bus/prefix-summary`：前缀聚合汇总
- [ ] `GET /observability/event-bus/top`：最繁忙 Top N

**前端：**
- [ ] 前缀聚合卡片（点击可筛选明细）
- [ ] Subject 明细表（近1分钟/近1小时/总计/最后发布时间）
- [ ] 内联 mini-bar 直观展示相对流量
- [ ] 前缀输入框过滤
- [ ] 每10秒自动刷新

**单元测试：**
- [ ] record 累计 / 前缀过滤 / 聚合 / 排序 四项测试

---

*Codex Task | 来源：EMQX_BORROWING_ANALYSIS.md P2-#1 | 2026-04-02*
