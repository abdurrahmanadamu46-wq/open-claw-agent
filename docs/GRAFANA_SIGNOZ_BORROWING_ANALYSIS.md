# Grafana + SigNoz 双项目借鉴分析报告
## https://github.com/grafana/grafana + https://github.com/SigNoz/signoz

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**  
**重要前置：CODEX_TASK_LANGFUSE_OBSERVABILITY.md 已落地（LLM调用日志/质量评分/数据集）**

---

## 一、两个项目定性

### Grafana
```
世界最流行的可观测性看板平台（75k+ Star）
  核心：时序数据可视化 + 多数据源 + 告警
  关键子系统：
    Explore         ← 临时查询探索界面
    Alerting        ← 统一告警规则引擎
    Panels          ← 20+ 图表类型
    Plugins         ← 数据源插件体系（Prometheus/Loki/ClickHouse...）
    RBAC            ← 多组织多角色权限
    Annotations     ← 事件标注（在图表上打标记）
    Variables       ← 看板变量（动态过滤）
    Unified Alerting → Grafana Mimir/OnCall
```

### SigNoz
```
开源全栈可观测性平台（19k+ Star），三大支柱：
  Traces    ← OpenTelemetry 分布式链路追踪
  Metrics   ← 指标监控（Prometheus 兼容）
  Logs      ← 结构化日志查询（ClickHouse 存储）
  
  关键差异（vs Grafana）：
    原生 OpenTelemetry 支持
    ClickHouse 作为统一存储（比 Loki 更快）
    Exceptions 自动聚合
    APM（应用性能监控）内置
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_LANGFUSE_OBSERVABILITY.md 已覆盖：
  ✅ LLM 调用日志记录（llm_call_logger.py）
  ✅ 质量评分评估（llm_quality_judge.py）
  ✅ 数据集管理（dataset_store.py）
  ✅ 可观测性 API（observability_api.py）
  ✅ 批量导出（batch_export.py）
  
CODEX_TASK_SHADCN_CHARTS.md 已覆盖：
  ✅ 执行趋势图（AreaChart）
  ✅ 质量评分图（LineChart）
  ✅ 龙虾雷达图（RadarChart）
```

**本次聚焦 Grafana/SigNoz 中我们真正缺失的3个高价值能力：**
1. **Alerting（告警规则引擎）** — 质量分下降/执行失败率超阈值时自动告警
2. **Annotations（事件标注）** — 在监控图上标记"部署/配置变更/龙虾版本升级"事件
3. **Distributed Tracing（分布式链路追踪）** — 跨龙虾/跨边缘节点的请求链路可视化

---

## 三、逐层对比分析

### 3.1 前端（Operations Console）

#### ❌ 略过：Grafana 面板（Panel）体系
我们用 shadcn/ui Charts（已在 CODEX_TASK_SHADCN_CHARTS.md 落地），不需要引入 Grafana 重型面板。

#### ❌ 略过：Grafana 数据源插件体系
我们的数据来自自有后端 API，不需要 Grafana 插件架构。

#### ✅ 强烈借鉴：Alerting — 告警规则引擎

**Grafana Unified Alerting 核心概念：**
```
Alert Rule（告警规则）：
  条件：avg(quality_score) < 7.0 持续 5 分钟
  评估间隔：每 1 分钟检查一次
  静默期：触发后 30 分钟不重复告警
  
Alert State 状态机：
  Normal → Pending（超阈值但未超持续时间）
  Pending → Firing（超阈值且持续时间满足）
  Firing → Normal（恢复正常）
  Firing → Silenced（手动静默）

Notification Channel（通知渠道）：
  Grafana：Email / Slack / PagerDuty / Webhook
  我们：企业微信 / 飞书 / 钉钉 / SMS
```

**对我们的价值：**
```
龙虾监控的告警场景（目前完全缺失）：

  质量告警：
    avg(quality_score, 30min) < 7.0 → 发送企业微信告警
    某龙虾连续 5 次质量分 < 6.0 → 立即告警（可能 Prompt 出问题）
    
  执行异常告警：
    错误率 > 10%（最近100次中 >10次失败）→ 告警
    执行超时率 > 5% → 告警
    龙虾 Heartbeat 连续 3 次丢失 → 紧急告警
    
  边缘节点告警：
    边缘节点离线超 5 分钟 → 告警
    边缘节点任务积压 > 100 → 告警
    
  配额告警：
    租户 API 调用量 > 配额 80% → 预警
    Token 消耗速率异常（比昨日同期高 3x）→ 告警
```

**SigNoz 的 Alert Builder（比 Grafana 更简单的告警 UI）：**
```
Builder 模式：
  1. 选择指标：quality_score
  2. 设置聚合：avg by (lobster_name)
  3. 设置条件：< 7.0
  4. 设置持续时间：5m
  5. 设置通知：企业微信 Webhook
  → 不需要写 PromQL

我们参考 SigNoz 的 Alert Builder UI（更简单）
```

**优先级：P1**（生产级 SaaS 的必须能力，缺少告警=运营盲区）

#### ✅ 强烈借鉴：Annotations（事件标注）

**Grafana Annotations 机制：**
```
Annotations 是在时序图上打的垂直线标记：

  ────────────────────────────────────────────
  执行量 AreaChart
  ┆                          ↑
  ┆                    ┌─────┤ Prompt v2 升级
  ┆              ___   │ 8.3 │ 2026-04-02 14:00
  ┆____/\___/\/\/   \_/│_____│
  ────────────────────────────────────────────
      4/1    4/2    4/3 ↑
                        部署 v2.1.0

使用场景（我们的业务）：
  - Prompt 版本升级（自动在图上打标记）
  - 龙虾配置变更
  - 新龙虾上线
  - 边缘节点扩容
  - 系统部署
```

**对我们的价值：**
```
我们的 ExecutionTrendChart + QualityScoreChart 添加 Annotation：
  
  触发源：
    审计日志（LOBSTER_CONFIG_UPDATE / PROMPT_VERSION_CHANGE / DEPLOYMENT）
    → 自动在图表对应时间点添加垂直标注线
  
  效果：
    运营人员看到质量分突然下降 → 图上有标记"Prompt v2 升级 14:00"
    → 立刻知道原因，不用翻日志
    
  实现方式（简化版）：
    不需要 Grafana 的完整 Annotation API
    在 LineChart ReferenceLine 上渲染：
    <ReferenceLine x={event.timestamp} stroke="#888" strokeDasharray="2 2">
      <Label value={event.label} position="top" />
    </ReferenceLine>
```

**优先级：P1**（运营监控的关键能力，直接连接审计日志和图表）

#### ✅ 强烈借鉴：Distributed Tracing — 跨龙虾链路追踪

**SigNoz Traces 的核心（基于 OpenTelemetry）：**
```
一个工作流执行的链路图：

  Trace ID: abc123
  ┌─────────────────────────────────────────────────────────────┐
  │ [COMMANDER-CHEN] orchestrate_workflow     1200ms            │
  │   ├─ [STRATEGIST-SUSI] analyze_market      380ms           │
  │   ├─ [INKWRITER-MOXIAOYA] write_copy       620ms           │
  │   │    ├─ LLM Call Claude-3.5-sonnet       580ms          │
  │   │    └─ quality_judge                     40ms           │
  │   ├─ [VISUALIZER-SHADOW] design_banner     450ms           │
  │   └─ [DISPATCHER-LAOJIAN] schedule_post    80ms            │
  └─────────────────────────────────────────────────────────────┘
  
  每个 Span 包含：
    龙虾名称 / 技能名称 / 输入摘要 / 状态 / 耗时
    LLM调用：模型名 / Token数 / 质量分
    错误：错误类型 / 错误信息
```

**对我们的价值：**
```
目前龙虾执行只有单条记录，无法看到：
  - 工作流中各龙虾的耗时分布
  - 哪个龙虾是瓶颈
  - 跨边缘节点的调用链路
  - LLM 调用在总耗时中的比例

引入 OpenTelemetry SDK（Python）：
  每个龙虾执行 → 一个 Span
  工作流执行 → 父 Span（包含所有龙虾子 Span）
  LLM 调用 → LLM Span（含 Token/模型/延迟）
  
存储方案：
  选项 A：自托管 SigNoz（ClickHouse 存储）
  选项 B：使用 Jaeger（轻量级，适合早期）
  选项 C：直接用 Langfuse 的 Tracing（已有集成）★推荐
  
★ 最优方案：复用 Langfuse Tracing
  Langfuse 本身支持 Trace/Span 层级
  我们已有 llm_call_logger.py（Langfuse 已落地）
  在龙虾执行时创建父 Trace，每个技能执行创建 Span
  → 无需额外引入 SigNoz/Jaeger
```

**优先级：P1**（工作流调试的核心能力，也是 SaaS 高级功能的差异化卖点）

---

### 3.2 云端大脑 + 9只龙虾

#### ✅ 强烈借鉴：SigNoz Exceptions — 自动聚合错误模式

**SigNoz Exceptions（错误聚合分析）：**
```
将相似错误合并成一个 Issue，展示：
  - 错误类型 + 堆栈指纹（同类错误只显示一次）
  - 发生次数 / 影响用户数 / 首次出现 / 最近出现
  - 错误率趋势（7天折线图）
  
类似 Sentry 的 Issue 聚合机制
```

**对我们的价值：**
```
龙虾执行错误目前只是一条一条记录，无聚合。

引入错误聚合：
  LLM Timeout × 128 次 → 一个 Issue（"LLM调用超时"）
  Context Too Long × 45 次 → 一个 Issue（"上下文过长"）
  Edge Node Offline × 23 次 → 一个 Issue（"边缘节点离线"）

Operations Console 新增 "错误分析" 页：
  按错误类型聚合 + 发生趋势 + 影响龙虾
  点击展开：最近 N 条原始错误记录（含输入/错误信息）
```

**优先级：P2**（比单条错误记录好用，但非紧急）

#### ✅ 可借鉴：Grafana 的 Rate/Error/Duration（RED 方法）

**Grafana 推广的 RED 方法论：**
```
每个服务的黄金指标：
  R - Rate（请求速率）：每分钟执行次数
  E - Error（错误率）：失败次数 / 总次数
  D - Duration（延迟）：P50/P90/P99 耗时

我们的龙虾监控目前只有总量和平均，缺少：
  P90/P99 耗时分位数（少数慢请求会拉高平均值）
  错误率趋势（不是绝对数量，是比例）
  
增加到 Dashboard KPI 卡片：
  当前错误率：2.3%（vs 昨日 1.8%）↑
  P90 耗时：1.8s（vs 昨日 1.2s）↑ ← 告警
  P99 耗时：4.2s（vs 昨日 2.8s）↑↑ ← 紧急告警
```

**优先级：P2**（指标完整性，丰富 KPI 卡片）

---

### 3.3 L2.5 支撑微服务集群

#### ✅ 强烈借鉴：SigNoz/Grafana 告警通知的 Notification Channel 体系

**Grafana AlertManager 通知渠道设计：**
```python
# 我们参考的设计模式
class NotificationChannel:
    channel_type: str  # "wechat_work" | "feishu" | "dingtalk" | "sms" | "email"
    config: dict       # 渠道配置（Webhook URL / 手机号等）
    severity_filter: str  # "critical" | "warning" | "all"
    
class AlertRule:
    name: str
    condition: str          # "avg(quality_score, 5m) < 7.0"
    eval_interval: int      # 评估间隔（秒）
    pending_period: int     # pending 后多久触发（秒）
    silence_period: int     # 触发后静默时长（秒）
    severity: str           # "critical" | "warning"
    notification_channels: List[str]  # 通知到哪些渠道
    lobster_filter: str     # 可选，只监控特定龙虾
    tenant_filter: str      # 可选，只监控特定租户
```

**优先级：P1**（告警系统的后端实现）

#### ✅ 可借鉴：SigNoz 的 ClickHouse 作为时序/日志统一存储

**SigNoz 架构：**
```
所有数据统一存储到 ClickHouse：
  Traces  → traces 表（列式压缩，支持亿级 Span 查询）
  Metrics → samples 表（时序数据）
  Logs    → logs 表（结构化日志）
  
查询性能（vs Elasticsearch/Loki）：
  10亿条日志的 group by 查询：ClickHouse 2s vs ES 30s
```

**对我们的价值：**
```
我们的 llm_call_logger 目前用 SQLite/PostgreSQL 存储 LLM 调用记录。
随着规模增长（日均数万次调用），需要评估迁移到 ClickHouse。

目前阶段（日调用 < 10万）：PostgreSQL 够用
未来阶段（日调用 > 100万）：考虑 ClickHouse 分区表

注：不在此阶段生成 Codex Task，记录为未来技术债。
```

**优先级：P3（技术债备忘）**

---

### 3.4 云边调度层 + 边缘层

#### ✅ 强烈借鉴：SigNoz 的边缘采集器（OpenTelemetry Collector）

**SigNoz 部署模式：**
```
边缘节点                          云端
┌────────────────┐               ┌─────────────────┐
│ OTel Collector │ ──────────── │ SigNoz Backend  │
│  (轻量级代理)   │  压缩批量推送  │  (ClickHouse)   │
│  本地缓存 15s   │               │                 │
└────────────────┘               └─────────────────┘
边缘离线时：本地缓存，恢复连接后批量上传
```

**对我们的价值：**
```
我们的边缘节点（edge-runtime）执行龙虾任务时：
  目前：执行完毕后调用云端 API 上报结果
  
  借鉴 OTel Collector 模式：
    边缘节点内置轻量遥测缓存（EdgeTelemetryBuffer）
    批量收集：执行记录 + 错误 + 延迟指标
    每 15 秒或 100 条时批量推送到云端
    离线时本地持久化，恢复后重传
    
  vs 当前方案的优势：
    减少网络请求（批量 vs 逐条）
    网络抖动时不丢失数据
    压缩传输（减少带宽）
```

**优先级：P1**（边缘可靠性的核心改进，尤其是网络不稳定的边缘场景）

---

### 3.5 SaaS 系统整体

#### ✅ 可借鉴：Grafana 的多租户 RBAC 看板权限模型

**Grafana RBAC：**
```
Organization（组织） → Teams（团队） → Users（用户）
每个 Dashboard：
  View / Edit / Admin 三级权限
  可以按 Team 或 User 单独设置
  
对我们的价值：
  代理商（租户）的运营人员只能看自己租户的数据
  代理商管理员可以配置告警规则
  平台超管可以看所有租户的数据
  
注：CODEX_TASK_RESOURCE_RBAC.md 已落地基础 RBAC，
    此处聚焦"看板级别的细粒度权限"（哪些图表谁能看）
```

**优先级：P2**（中期功能，告警和追踪优先）

---

## 四、对比总结

| 维度 | Grafana/SigNoz | 我们 | 胜负 | 行动 |
|-----|---------|------|------|------|
| LLM 可观测性 | 无原生支持 | ✅ CODEX_TASK_LANGFUSE_OBSERVABILITY 已落地 | **我们胜** | — |
| 基础图表 | ✅ 完整 | ✅ CODEX_TASK_SHADCN_CHARTS 已落地 | **平** | — |
| **告警规则引擎** | ✅ 完整 AlertManager | 无告警 | **Grafana/SigNoz 胜** | **P1** |
| **图表事件标注** | ✅ Annotations | 无标注 | **Grafana 胜** | **P1** |
| **分布式链路追踪** | ✅ OTel Traces | 无 Trace | **SigNoz 胜** | **P1** |
| 错误聚合分析 | ✅ Exceptions | 单条记录 | **SigNoz 胜** | P2 |
| RED 指标（P90/P99）| ✅ 完整 | 仅均值 | **Grafana 胜** | P2 |
| **边缘遥测缓存** | ✅ OTel Collector | 逐条上报 | **SigNoz 胜** | **P1** |
| 多租户看板权限 | ✅ 细粒度 | 基础 RBAC | **Grafana 胜** | P2 |
| 业务 SaaS 功能 | ❌ 无 | ✅ 完整 | **我们胜** | — |

---

## 五、借鉴清单

### P1 新建 Codex Task（4个）

| # | 借鉴点 | 来源 | 工时 |
|---|--------|------|------|
| 1 | **告警规则引擎**（AlertRule + 通知渠道 + 状态机）| Grafana Unified Alerting + SigNoz Alert Builder | 3天 |
| 2 | **图表事件标注**（Annotation + 审计日志联动）| Grafana Annotations | 1天 |
| 3 | **分布式链路追踪**（复用 Langfuse Trace/Span）| SigNoz OTel Traces | 2天 |
| 4 | **边缘遥测批量上报**（EdgeTelemetryBuffer）| SigNoz OTel Collector 模式 | 1.5天 |

---

*分析基于 Grafana v10.x + SigNoz v0.45.x（2026-04-02）*
