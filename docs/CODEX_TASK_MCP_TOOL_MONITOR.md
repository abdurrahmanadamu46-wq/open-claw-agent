# CODEX TASK: MCP 工具调用实时监控面板（Tool Call Monitor）

**优先级：P1**  
**来源：TOOLHIVE_BORROWING_ANALYSIS.md P1-#2（ToolHive Tool Call Dashboard）**

---

## 背景

`llm_call_logger.py` 记录了 LLM 调用，但没有专门的工具调用监控。运营无法回答"这周龙虾调用了多少次 web_search？哪个龙虾工具失败率最高？最慢的工具是哪个？"。借鉴 ToolHive 工具监控，在 MCP Gateway 中间件埋点，并在 `dragon_dashboard.html` 增加工具调用面板。

---

## 一、数据采集（MCP Gateway 中间件）

```python
# dragon-senate-saas-v2/mcp_tool_monitor.py

import time
import logging
from dataclasses import dataclass, field
from collections import defaultdict, deque
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ToolCallRecord:
    """单次工具调用记录"""
    lobster_name: str
    tool_name: str
    tenant_id: str
    success: bool
    latency_ms: int
    error: Optional[str] = None
    params_hash: str = ""   # 参数哈希（便于调试，不存明文）
    timestamp: float = field(default_factory=time.time)


class McpToolMonitor:
    """
    MCP 工具调用监控器
    
    在 MCP Gateway 的每次工具调用前后埋点：
      before: 记录开始时间
      after:  计算延迟，写入记录，更新统计
    
    使用方式：
      monitor = McpToolMonitor()
      
      # 在工具调用包装器中：
      token = monitor.start_call(lobster_name, tool_name, tenant_id)
      try:
          result = await actual_tool_call(...)
          monitor.end_call(token, success=True)
      except Exception as e:
          monitor.end_call(token, success=False, error=str(e))
    """

    WINDOW_SIZE = 1000  # 内存中保留最近1000条记录

    def __init__(self):
        self._records: deque[ToolCallRecord] = deque(maxlen=self.WINDOW_SIZE)
        # 工具级实时统计（内存缓存，用于 Dashboard 快速读取）
        self._stats: dict[str, dict] = defaultdict(lambda: {
            "total": 0, "success": 0, "failed": 0,
            "latencies": deque(maxlen=100),  # 最近100次延迟
        })
        self._pending: dict[str, dict] = {}  # token → {start_time, ...}

    def start_call(self, lobster_name: str, tool_name: str, tenant_id: str) -> str:
        """记录工具调用开始，返回 token"""
        import uuid
        token = str(uuid.uuid4())
        self._pending[token] = {
            "lobster_name": lobster_name,
            "tool_name": tool_name,
            "tenant_id": tenant_id,
            "start_time": time.time(),
        }
        return token

    def end_call(
        self, token: str, success: bool = True,
        error: Optional[str] = None, params_hash: str = ""
    ):
        """记录工具调用结束"""
        if token not in self._pending:
            return
        ctx = self._pending.pop(token)
        latency_ms = int((time.time() - ctx["start_time"]) * 1000)

        record = ToolCallRecord(
            lobster_name=ctx["lobster_name"],
            tool_name=ctx["tool_name"],
            tenant_id=ctx["tenant_id"],
            success=success,
            latency_ms=latency_ms,
            error=error,
            params_hash=params_hash,
        )
        self._records.append(record)

        # 更新统计
        key = f"{ctx['lobster_name']}:{ctx['tool_name']}"
        stat = self._stats[key]
        stat["total"] += 1
        if success:
            stat["success"] += 1
        else:
            stat["failed"] += 1
        stat["latencies"].append(latency_ms)

        # 慢工具告警（> 5秒）
        if latency_ms > 5000:
            logger.warning(
                f"[ToolMonitor] 慢工具告警: {ctx['lobster_name']} → "
                f"{ctx['tool_name']} 耗时 {latency_ms}ms"
            )

    # ── 统计查询接口（供 Dashboard API 调用）──────────────

    def get_top_tools(self, limit: int = 10) -> list[dict]:
        """调用次数 Top N 工具"""
        tool_counts: dict[str, int] = defaultdict(int)
        for r in self._records:
            tool_counts[r.tool_name] += 1
        sorted_tools = sorted(tool_counts.items(), key=lambda x: -x[1])
        return [{"tool": k, "count": v} for k, v in sorted_tools[:limit]]

    def get_lobster_heatmap(self) -> list[dict]:
        """各龙虾 × 工具 调用热力图数据"""
        heat: dict[tuple, int] = defaultdict(int)
        for r in self._records:
            heat[(r.lobster_name, r.tool_name)] += 1
        return [
            {"lobster": k[0], "tool": k[1], "count": v}
            for k, v in sorted(heat.items(), key=lambda x: -x[1])
        ]

    def get_failure_rates(self) -> list[dict]:
        """各工具失败率"""
        results = []
        for key, stat in self._stats.items():
            if stat["total"] == 0:
                continue
            lobster, tool = key.split(":", 1)
            failure_rate = round(stat["failed"] / stat["total"] * 100, 1)
            avg_latency = (
                round(sum(stat["latencies"]) / len(stat["latencies"]))
                if stat["latencies"] else 0
            )
            results.append({
                "lobster": lobster,
                "tool": tool,
                "total": stat["total"],
                "failed": stat["failed"],
                "failure_rate_pct": failure_rate,
                "avg_latency_ms": avg_latency,
            })
        return sorted(results, key=lambda x: -x["failure_rate_pct"])

    def get_recent_calls(self, limit: int = 50) -> list[dict]:
        """最近N次工具调用记录"""
        recent = list(self._records)[-limit:]
        return [
            {
                "lobster": r.lobster_name,
                "tool": r.tool_name,
                "success": r.success,
                "latency_ms": r.latency_ms,
                "error": r.error,
                "timestamp": r.timestamp,
            }
            for r in reversed(recent)
        ]


# 全局单例
mcp_tool_monitor = McpToolMonitor()
```

---

## 二、Dashboard API 路由

```python
# dragon-senate-saas-v2/observability_api.py（新增工具监控路由）

from .mcp_tool_monitor import mcp_tool_monitor

@router.get("/api/v1/monitor/tools/top")
async def get_top_tools(limit: int = 10, ctx=Depends(get_tenant_context)):
    return mcp_tool_monitor.get_top_tools(limit)

@router.get("/api/v1/monitor/tools/heatmap")
async def get_tool_heatmap(ctx=Depends(get_tenant_context)):
    return mcp_tool_monitor.get_lobster_heatmap()

@router.get("/api/v1/monitor/tools/failures")
async def get_tool_failures(ctx=Depends(get_tenant_context)):
    return mcp_tool_monitor.get_failure_rates()

@router.get("/api/v1/monitor/tools/recent")
async def get_recent_tool_calls(limit: int = 50, ctx=Depends(get_tenant_context)):
    return mcp_tool_monitor.get_recent_calls(limit)
```

---

## 三、Dashboard 前端面板（dragon_dashboard.html 新增 Tab）

```html
<!-- dragon_dashboard.html 新增"工具调用"Tab -->

<!-- Tab 按钮 -->
<button class="tab-btn" onclick="switchTab('tools')">🔧 工具调用</button>

<!-- Tab 内容 -->
<div id="tab-tools" class="tab-panel" style="display:none">
  <div class="grid grid-3">
    <!-- Top 10 工具 -->
    <div class="card">
      <h3>🏆 调用 Top 10 工具</h3>
      <div id="top-tools-list"></div>
    </div>
    <!-- 工具失败率 -->
    <div class="card">
      <h3>❌ 工具失败率排行</h3>
      <div id="failure-rate-list"></div>
    </div>
    <!-- 最近调用 -->
    <div class="card">
      <h3>📋 最近50次调用</h3>
      <div id="recent-calls-list"></div>
    </div>
  </div>
  <!-- 龙虾×工具热力图 -->
  <div class="card" style="margin-top:16px">
    <h3>🔥 龙虾×工具 调用热力图</h3>
    <div id="tool-heatmap"></div>
  </div>
</div>

<script>
async function loadToolMonitor() {
  const [top, failures, recent, heatmap] = await Promise.all([
    fetch('/api/v1/monitor/tools/top').then(r => r.json()),
    fetch('/api/v1/monitor/tools/failures').then(r => r.json()),
    fetch('/api/v1/monitor/tools/recent').then(r => r.json()),
    fetch('/api/v1/monitor/tools/heatmap').then(r => r.json()),
  ]);

  // Top 工具渲染
  document.getElementById('top-tools-list').innerHTML =
    top.map(t => `<div class="stat-row">
      <span>${t.tool}</span>
      <span class="badge">${t.count}次</span>
    </div>`).join('');

  // 失败率渲染
  document.getElementById('failure-rate-list').innerHTML =
    failures.slice(0, 10).map(f => `<div class="stat-row ${f.failure_rate_pct > 20 ? 'alert' : ''}">
      <span>${f.lobster}/${f.tool}</span>
      <span class="badge ${f.failure_rate_pct > 20 ? 'badge-red' : ''}">${f.failure_rate_pct}%</span>
    </div>`).join('');
}
</script>
```

---

## 验收标准

- [ ] `McpToolMonitor.start_call()` / `end_call()`：token 机制埋点
- [ ] `get_top_tools()`：调用次数排行
- [ ] `get_lobster_heatmap()`：龙虾×工具热力图数据
- [ ] `get_failure_rates()`：失败率 + 平均延迟
- [ ] `get_recent_calls()`：最近50条调用日志
- [ ] 慢工具告警（> 5秒写入 warning 日志）
- [ ] 4个 Dashboard API 路由注册
- [ ] `dragon_dashboard.html` 新增"工具调用"Tab
- [ ] 与 `mcp_tool_policy.py`（ToolPermissionPolicy）联动：拒绝的调用也被记录

---

*Codex Task | 来源：TOOLHIVE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
