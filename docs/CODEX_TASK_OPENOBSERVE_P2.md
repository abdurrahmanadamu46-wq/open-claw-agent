# CODEX TASK: OpenObserve P2 合并（Dashboard 模板 + 边缘 OTel）

**优先级：P2**  
**来源：OPENOBSERVE_BORROWING_ANALYSIS.md P2-#3 + P2-#4**

---

## P2-3：Dashboard 多视图模板切换

### 背景

`dragon_dashboard.html` 固定布局，不同角色（运营/技术/老板）需要不同视图。借鉴 OpenObserve 多 Dashboard 能力，预置3套视图模板，用 localStorage 存储用户偏好。

### 实现

```javascript
// dragon_dashboard.html 新增（Dashboard 模板系统）

const DASHBOARD_TEMPLATES = {
  "ops": {
    label: "📊 运营视图",
    cards: ["lobster-status", "task-count", "success-rate", "top-tools", "recent-tasks"],
  },
  "tech": {
    label: "🔧 技术视图",
    cards: ["latency-chart", "error-rate", "tool-failures", "edge-nodes", "log-query"],
  },
  "boss": {
    label: "💼 老板视图",
    cards: ["daily-tasks", "cost-today", "tenant-count", "revenue-mtd"],
  },
};

function switchDashboardView(viewKey) {
  const template = DASHBOARD_TEMPLATES[viewKey];
  if (!template) return;
  
  // 隐藏所有卡片，只显示当前视图的卡片
  document.querySelectorAll('.dashboard-card').forEach(card => {
    card.style.display = template.cards.includes(card.dataset.cardId) ? '' : 'none';
  });
  
  // 保存用户偏好
  localStorage.setItem('dashboard_view', viewKey);
  
  // 更新按钮状态
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewKey);
  });
}

// 页面加载时恢复用户偏好
document.addEventListener('DOMContentLoaded', () => {
  const savedView = localStorage.getItem('dashboard_view') || 'ops';
  switchDashboardView(savedView);
});
```

```html
<!-- dragon_dashboard.html 视图切换工具栏（顶部）-->
<div class="view-switcher">
  <button class="view-btn" data-view="ops" onclick="switchDashboardView('ops')">📊 运营视图</button>
  <button class="view-btn" data-view="tech" onclick="switchDashboardView('tech')">🔧 技术视图</button>
  <button class="view-btn" data-view="boss" onclick="switchDashboardView('boss')">💼 老板视图</button>
</div>

<!-- 每张卡片标注所属视图 data-card-id -->
<div class="dashboard-card" data-card-id="lobster-status">...</div>
<div class="dashboard-card" data-card-id="latency-chart">...</div>
```

### 验收标准

- [ ] 3套预置视图：ops / tech / boss
- [ ] `switchDashboardView()` 控制卡片显示/隐藏
- [ ] `localStorage` 持久化用户偏好
- [ ] 视图切换按钮 active 状态高亮
- [ ] 所有现有卡片标注 `data-card-id`

---

## P2-4：边缘节点 OpenTelemetry Span 上报

### 背景

`marionette_executor.py` 执行任务没有 Trace，云端无法看到边缘任务链路。借鉴 OpenObserve OTel 标准，在边缘节点引入 `opentelemetry-python`，与已落地的分布式追踪基础设施联动。

### 实现

```python
# edge-runtime/edge_telemetry.py

import logging
import os
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

# ── 懒加载 OTel（不强制依赖）──────────────────────────────

def _init_tracer():
    """初始化 OTel Tracer（失败时返回空实现）"""
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        otlp_endpoint = os.environ.get(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://localhost:4318/v1/traces"
        )
        edge_token = os.environ.get("EDGE_TOKEN", "")

        provider = TracerProvider()
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=otlp_endpoint,
                    headers={"Authorization": f"Bearer {edge_token}"},
                )
            )
        )
        trace.set_tracer_provider(provider)
        tracer = trace.get_tracer("edge-runtime")
        logger.info(f"[EdgeTelemetry] OTel 初始化成功 → {otlp_endpoint}")
        return tracer

    except ImportError:
        logger.warning("[EdgeTelemetry] opentelemetry 未安装，Span 上报已禁用")
        return _NoopTracer()


class _NoopTracer:
    """空实现 Tracer（opentelemetry 未安装时使用）"""
    def start_as_current_span(self, name, **kwargs):
        from contextlib import nullcontext
        return nullcontext()


# 全局 Tracer（模块级单例）
_tracer = None

def get_tracer():
    global _tracer
    if _tracer is None:
        _tracer = _init_tracer()
    return _tracer


# ── marionette_executor.py 集成示意 ─────────────────────────

# async def execute_task(task: dict) -> dict:
#     tracer = get_tracer()
#     with tracer.start_as_current_span("edge.execute_task") as span:
#         span.set_attribute("task.id", task.get("task_id", ""))
#         span.set_attribute("task.type", task.get("task_type", ""))
#         span.set_attribute("edge.node_id", os.environ.get("EDGE_NODE_ID", ""))
#         try:
#             result = await _do_execute(task)
#             span.set_attribute("task.success", True)
#             return result
#         except Exception as e:
#             span.set_attribute("task.success", False)
#             span.set_attribute("task.error", str(e))
#             raise
```

### 验收标准

- [ ] `get_tracer()`：懒加载 OTel Tracer，安装失败时降级为 Noop
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT` 环境变量配置端点
- [ ] `EDGE_TOKEN` 环境变量作为 Bearer Token
- [ ] `marionette_executor.py` 集成 `start_as_current_span("edge.execute_task")`
- [ ] Span 属性：`task.id` / `task.type` / `edge.node_id` / `task.success`
- [ ] 不强制依赖 opentelemetry（未安装时不报错，Noop 降级）

---

*Codex Task | 来源：OPENOBSERVE_BORROWING_ANALYSIS.md P2-#3+4 | 2026-04-02*
