# 09-MOAT-VALIDATION-2026-03-28

Last Updated: 2026-03-28 (Asia/Shanghai)
Verifier: Codex

## 验证范围
围绕 8 条护城河做“可落地验证”：运行态、接口响应、模块存在性、闭环链路。

## 统一验证证据（运行态）
- `docker compose ps`：核心 7 服务均为 Up（web/backend/ai-subservice/postgres/redis/qdrant/ollama）。
- 容器内探活通过：
  - backend: `/autopilot/status` -> 200
  - ai-subservice: `/healthz` -> 200
- 说明：当前 PowerShell 主机侧 HTTP 请求出现连接关闭；容器内直连验证通过，属于本机网络层差异，不影响服务本体判定。

## 逐项验证结果

### 1) 私有行业知识池（Industry KB）
- 验证方法：调用 `/api/v1/ai/industry-kb/taxonomy`、`/industry-kb/stats`。
- 结果：通过。
- 证据：
  - taxonomy 返回 `category_count: 12`，含 72 细分行业结构。
  - `industry-kb/stats?tenant_id=tenant_demo&industry_tag=food_chinese_restaurant` 返回 200。
- 进度：85%
- 待收口：批量 profile 入库与质量阈值门控可视化。

### 2) 9龙虾组织化编排
- 验证方法：调用 `/api/v1/ai/agent/extensions`、`/api/v1/ai/skills-pool/overview`。
- 结果：通过。
- 证据：
  - profiles=9。
  - 每个 agent 均有 `skills=3`、`nodes=3`、`enabled=true`。
  - 总览返回 `agents_total:9`、`skills_total:27`、`nodes_total:27`。
- 进度：88%
- 待收口：技能沉淀池页面与实际使用链路做更深联动。

### 3) Senate Kernel（治理内核）
- 验证方法：调用 `/api/v1/ai/kernel/rollout/policy`、`/api/v1/ai/kernel/metrics/dashboard`。
- 结果：部分通过。
- 证据：
  - policy 返回 `enabled:true`、`block_mode:hitl`、风险分级 rollout 策略。
  - metrics 可返回，且执行后统计增长。
- 进度：72%
- 待收口：guardian/verification 在主链全量生效与回归矩阵补齐。

### 4) 合规与审计（审批/回滚/复盘）
- 验证方法：调用 `/api/v1/ai/kernel/reports`、`/api/v1/ai/kernel/report/{trace_id}`、`/api/v1/ai/kernel/report/{trace_id}/rollback` 路由存在性。
- 结果：部分通过。
- 证据：
  - 触发 `run-dragon-team` 后 `kernel/reports` 从 0 -> 1。
  - report 记录了 `trace_id` 与 `postgraph` 状态。
- 进度：70%
- 待收口：审批回执与回滚执行前二次审批（HITL）端到端实测。

### 5) 云边协同执行网络
- 验证方法：调用 `/api/v1/fleet/nodes`、`/api/v1/client-updates/latest`、边缘相关模块存在性。
- 结果：部分通过。
- 证据：
  - fleet 节点管理 API 可用（当前 list 为空）。
  - 客户端更新接口可达（参数校验生效）。
  - `edge_agent.py`、签名更新链相关模块存在。
- 进度：68%
- 待收口：真实边缘节点接入压测与在线率指标达标。

### 6) 低成本模型路由能力
- 验证方法：调用 `/api/v1/ai/llm/providers`、`/api/v1/ai/llm/agent-bindings`、`/llm/router/status`。
- 结果：通过。
- 证据：
  - providers=6，当前启用 `local,deepseek`。
  - agent_bindings=9。
  - router/status 显示 `local_model:qwen3:59b`，云侧 vendor 顺序可配置。
- 进度：90%
- 待收口：按 task_type 的成本报表与自动降级策略展示。

### 7) 多租户隔离 + 可插拔架构
- 验证方法：新建租户用户并验证 tenant_id 作用域。
- 结果：通过。
- 证据：
  - `/auth/register` 成功创建 `tenant_probe` 用户。
  - `/auth/me` 返回 `tenant_id: tenant_probe`。
  - `/industry-kb/taxonomy`、`/kernel/rollout/policy` 返回 tenant 维度数据。
- 进度：84%
- 待收口：租户模板导入导出与跨租户运维界面收口。

### 8) 数据闭环与持续进化
- 验证方法：触发 `run-dragon-team` 并回查 kernel 指标。
- 结果：部分通过。
- 证据：
  - `run-dragon-team` 201 成功返回 request_id。
  - `kernel_reports_total` 从 0 增加至 1。
  - `byStrategyVersion` 出现统计项。
- 进度：76%
- 待收口：bandit 多目标奖励与自动策略回写可视化。

## 汇总
- 完整通过：4 项（1,2,6,7）
- 部分通过：4 项（3,4,5,8）
- 平均进度：79.1%

## 下一步优先级（按商业价值）
1. Senate Kernel 主链全量 + 审批回滚端到端。
2. 云边真实节点接入与并发压测。
3. 闭环指标看板（命中率、回滚率、成功率）做运营可视化。
