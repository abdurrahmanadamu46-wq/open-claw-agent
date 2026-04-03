# OpenObserve 借鉴分析报告
## https://github.com/openobserve/openobserve.git

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、OpenObserve 项目定性

```
OpenObserve（Rust+Vue3，25k+ Star，全栈可观测性平台）：
  定位：Logs + Metrics + Traces + Alerts 一体化可观测性平台
  核心能力：
    日志搜索：SQL 查询 + 全文搜索（超快，比 Elasticsearch 便宜 140x）
    Metrics：PromQL 兼容，时序指标存储
    Traces：分布式追踪（OpenTelemetry 标准）
    Alerts：告警规则 + 通知（Slack/Email/Webhook）
    Dashboard：可视化图表（折线/柱状/热力图）
    Pipelines：数据处理管道（Filter/Transform/Enrich）
    Multi-tenant：多租户完整隔离
    S3/GCS 存储后端：极低成本存储
    内置前端：Vue3 + ECharts，开箱即用
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_DISTRIBUTED_TRACING.md 已落地（Grafana/Signoz 分析中生成）：
  ✅ 分布式链路追踪（Traces）

CODEX_TASK_ALERT_ENGINE.md 已落地（Grafana/Signoz 分析中生成）：
  ✅ 告警引擎

CODEX_TASK_CHART_ANNOTATIONS.md 已落地：
  ✅ 图表注释

CODEX_TASK_EDGE_TELEMETRY_BUFFER.md 已落地：
  ✅ 边缘遥测缓冲

dragon-senate-saas-v2/observability_api.py 已存在：
  ✅ 可观测性 API 基础

dragon-senate-saas-v2/llm_call_logger.py 已存在：
  ✅ LLM 调用日志

CODEX_TASK_LANGFUSE_OBSERVABILITY.md 已落地：
  ✅ LLM 调用 Trace/Span 观测
```

---

## 三、OpenObserve 对我们的真实价值

### 核心判断

OpenObserve 是全栈可观测性平台，与我们已落地的 Grafana/Signoz/Langfuse 体系有大量重叠。精准差距在于：**结构化日志全文搜索**（龙虾任务日志 SQL 查询）、**数据处理管道**（日志 Enrich 注入 tenant_id/lobster_name）、**前端 Vue3 仪表板模式**。我们的 `dragon_dashboard.html` 是纯静态 HTML，缺少 OpenObserve 级别的动态查询能力。

---

### 3.1 支撑微服务 — 结构化日志全文搜索 API

**OpenObserve 日志搜索：**
```sql
-- OpenObserve SQL 模式日志查询
SELECT lobster_name, COUNT(*) as cnt, AVG(latency_ms) as avg_ms
FROM logs
WHERE timestamp > now() - interval '1 hour'
  AND status = 'error'
GROUP BY lobster_name
ORDER BY cnt DESC
```

**对我们的价值：**
```
我们的龙虾任务日志（llm_call_logger）写入 DB，但缺少 SQL 查询界面：
  运营无法快速回答："过去1小时inkwriter失败了多少次？"
  
借鉴 OpenObserve：
  在 dragon_dashboard.html 增加"日志查询"Tab：
    - SQL 编辑器（CodeMirror）
    - 时间范围选择器（过去1h/6h/24h/7d）
    - 结果表格（TanStack Table，已落地）
    - 一键导出 CSV（batch_export.py，已落地）
  
  后端：`observability_api.py` 新增 `/api/v1/logs/query` SQL 端点
  DB：复用现有 llm_call_logger 的结构化日志表
  
  实现位置：dragon-senate-saas-v2/log_query_api.py
  工程量：1天
```

**优先级：P1**（运维诊断的核心能力，目前完全缺失）

---

### 3.2 支撑微服务 — 日志数据处理管道（Log Pipeline / Enrich）

**OpenObserve Pipeline：**
```yaml
# OpenObserve 数据管道：自动给每条日志注入字段
steps:
  - type: enrich
    field: tenant_name
    from_lookup:
      source: "tenants"
      key: tenant_id
  - type: filter
    condition: "level != 'debug'"
  - type: transform
    script: |
      if record.latency_ms > 5000:
        record.is_slow = true
```

**对我们的价值：**
```
我们的 llm_call_logger.py 写入的日志字段不统一：
  有些有 tenant_id，有些没有 lobster_name
  边缘日志缺少 region/node_id 字段
  
借鉴 OpenObserve Pipeline 思路：
  在 llm_call_logger.py 中新增"日志 Enrich 管道"：
    1. 自动注入标准字段：tenant_id / lobster_name / session_id / node_id
    2. 自动计算派生字段：is_slow（latency > 5s）/ is_error / cost_usd
    3. 过滤 debug 日志（生产环境）
  
  实现：LogEnrichPipeline 类，作为 llm_call_logger 的前置处理
  工程量：0.5天
```

**优先级：P1**（日志质量基础，影响所有监控指标的准确性）

---

### 3.3 前端 — 可拖拽 Dashboard 布局（Dynamic Dashboard）

**OpenObserve Dashboard：**
```
OpenObserve 的 Dashboard 特点：
  - 组件可拖拽调整位置和大小（react-grid-layout / vue-grid-layout）
  - 用户可保存自定义 Dashboard 布局
  - 支持变量（如选择 lobster_name 后所有图表联动过滤）
  - 支持时间范围全局同步
```

**对我们的价值：**
```
我们的 dragon_dashboard.html 是固定布局的静态 HTML：
  运营无法自定义关注的指标
  不同角色（运营/技术/老板）需要不同的 Dashboard 视图
  
借鉴 OpenObserve：
  引入 Dashboard 模板系统：
    预置3套模板：运营视图 / 技术视图 / 老板视图
    用户可以在这3套中切换
    每套模板的卡片顺序/显示字段可本地存储（localStorage）
  
  技术：仅需 CSS Grid 重构 + localStorage 存储用户偏好
  不引入复杂拖拽库（保持简单）
  
  实现：dragon_dashboard.html + preferences_api.py
  工程量：1天
```

**优先级：P2**（体验优化，不影响核心功能）

---

### 3.4 边缘层 — 边缘节点 OpenTelemetry 上报

**OpenObserve OTel 接入：**
```python
# OpenObserve 支持 OTLP 协议接收 Trace/Log/Metrics
# 边缘节点可以用 opentelemetry-python SDK 上报

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 边缘节点配置（上报到 OpenObserve / 我们的云端）
provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(
            endpoint="https://api.openclaw.ai/otlp/v1/traces",
            headers={"Authorization": f"Bearer {edge_token}"},
        )
    )
)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("edge-runtime")

# 在 marionette_executor.py 中使用
with tracer.start_as_current_span("execute_task") as span:
    span.set_attribute("task_id", task_id)
    span.set_attribute("edge_node_id", node_id)
    # ... 执行任务
```

**对我们的价值：**
```
我们的边缘层（edge-runtime）目前没有标准的可观测性上报：
  marionette_executor.py 的执行结果只通过 WSS 回传
  没有 Span/Trace，无法在云端看到边缘任务的执行链路
  
借鉴 OpenObserve OTel 标准：
  在 edge-runtime 引入 opentelemetry-python
  marionette_executor.py 每次任务执行生成 Span
  Span 上报到 CODEX_TASK_DISTRIBUTED_TRACING（已落地）的收集器
  
  实现位置：edge-runtime/edge_telemetry.py
  工程量：0.5天（复用已落地的分布式追踪基础设施）
```

**优先级：P2**（边缘可观测性增强，与已落地的分布式追踪联动）

---

## 四、对比总结

| 维度 | OpenObserve | 我们 | 胜负 | 行动 |
|-----|-------------|------|------|------|
| **结构化日志 SQL 查询** | ✅ | 无查询界面 | OpenObserve 胜 | **P1** |
| **日志 Enrich 管道** | ✅ | 字段不统一 | OpenObserve 胜 | **P1** |
| **可拖拽 Dashboard** | ✅ | 固定布局 | OpenObserve 胜 | **P2** |
| **边缘 OTel 上报** | ✅ | 无 | OpenObserve 胜 | **P2** |
| 分布式 Traces | ✅ | ✅ 已落地 | 平 | — |
| 告警引擎 | ✅ | ✅ 已落地 | 平 | — |
| LLM 专项观测 | ❌ | ✅ Langfuse 已落地 | 我们胜 | — |

---

## 五、借鉴清单

### P1（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **日志 SQL 查询 API + 前端查询界面** | 1天 |
| 2 | **日志 Enrich 管道**（自动注入标准字段 + 派生字段）| 0.5天 |

### P2（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 3 | **Dashboard 模板切换**（运营/技术/老板 三套视图）| 1天 |
| 4 | **边缘 OTel Span 上报**（marionette_executor 链路追踪）| 0.5天 |

---

*分析基于 OpenObserve main 分支（2026-04-02）*
