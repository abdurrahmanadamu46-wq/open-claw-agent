# ClawCommerce SLO 与监控指标定义

> 总负责人要求：99.99% 可用、API ≤300ms、错误率 ≤0.1% 等须有明确计算方式与告警策略，监控零死角。

---

## 1. SLO 目标表

| 指标 | 目标 | 统计窗口 | 计算方式 |
|------|------|----------|----------|
| **系统可用性** | 99.99% | 月度 | 1 − (不可用分钟数 / 当月总分钟数)。不可用定义：核心 API 健康检查连续 1 分钟失败或 5xx 率 >10% |
| **API P95 延迟** | ≤300ms | 1 分钟滚动 | 所有 ` /api/v1/*` 请求响应时间的 95 分位 |
| **API 错误率** | ≤0.1% | 1 分钟滚动 | (5xx 数 / 总请求数) × 100% |
| **Agent 内部 API** | P95 ≤500ms | 1 分钟 | execute/terminate 等内部调用 |
| **Web 首屏** | ≤1.5s | 用户会话 | Lighthouse 或 RUM 的 FCP/LCP（取更严） |
| **节点心跳** | 5 分钟内有心跳 | 实时 | 超 5 分钟无心跳视为不健康，触发告警与恢复流程 |

---

## 2. 必须暴露的指标（Prometheus）

**后端**

- `http_request_duration_seconds`（by path, method, status）
- `http_requests_total`（by path, method, status）
- `lead_submission_total`（by tenant, status）
- `campaign_created_total`（by tenant）
- `billing_deduction_total`（by tenant, result）

**Agent**

- `agent_node_allocation_total`（by result）
- `agent_node_heartbeat_last_timestamp_seconds`（by node_id）
- `agent_campaign_execute_duration_seconds`（by campaign_id）
- `agent_lead_push_total`（by result）

**基础设施**

- Redis：连接数、内存、命中率
- 数据库：连接数、慢查询、复制延迟（若适用）

---

## 3. 告警规则（示例）

| 告警名 | 条件 | 级别 | 处理 |
|--------|------|------|------|
| API 错误率过高 | 5xx 率 >0.5% 持续 5 分钟 | P1 | 值班 on-call，查日志与依赖 |
| API 延迟过高 | P95 >500ms 持续 5 分钟 | P2 | 分析慢请求与数据库/Redis |
| 可用性不足 | 健康检查连续 2 次失败 | P1 | 重启/扩容/回滚 |
| 节点失联 | 某节点超 5 分钟无心跳 | P2 | 自动恢复或人工隔离 |
| 线索推送失败率 | 失败率 >5% 持续 10 分钟 | P2 | 查 Webhook 与网络 |

---

## 4. Dashboard 与 Sentry

- **Grafana**：至少 1 个总览 Dashboard（API QPS/延迟/错误率、节点数、线索产出、任务状态分布）；1 个成本相关（资源用量、成本/线索趋势）。
- **Sentry**：前端 + 后端 + Agent 全栈接入；错误按 tenant/env 过滤；无敏感信息（手机号等）写入 event。

---

## 5. 验收

- 上线前 Checklist 中「监控 Dashboard 已接入生产」以本文档为准：上述指标已采集、Dashboard 可访问、至少 3 条核心告警已配置并测试触发。
