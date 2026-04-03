# Behavior OS — 行为引擎实现

本目录为 **行为操作系统（Behavior OS）** 的代码落点，与 `docs/行为操作系统_设计蓝图_合规边界内.md` 对齐。

## 三大引擎（已实现）

| 引擎 | 职责 | 实现 |
|------|------|------|
| **Persona Engine** | 人设生成 | `persona-engine.service.ts`（规则 + 确定性随机，seed 稳定人设） |
| **Intent Engine** | 动机生成 | `intent-engine.service.ts`（规则 + 标签匹配，输出 action_bias） |
| **Behavior Engine** | 行为路径生成 | `behavior-engine.service.ts`（状态机 Idle→Browse→Engage→Exit，生成 steps） |

## API（BehaviorController）

- `GET /behavior/persona?seed=xxx` — 生成人设
- `POST /behavior/intent` — Body: `{ persona, contentTags, goal? }`
- `POST /behavior/path` — Body: `{ persona, intent?, targetId?, commentContent?, sessionId? }`
- `POST /behavior/session` — 一键生成 Persona + Intent + BehaviorPath（Body: `seed, contentTags?, targetId?, tenant_id, campaign_id?, trace_id?`）
- `POST /behavior/interpret` — Body: `{ behavior_path }`，返回带 delayMs 的可执行步骤序列

## 事件总线与回访虾

- `BehaviorEventBus`（与架构图「事件驱动总线」对应）：
  - `high_intent_lead`：Catcher → FollowUp
  - `behavior_completed`：边缘上报 /behavior/log 后打分入池时发出
  - `behavior_path_generated`：Behavior Engine 产出路径/会话时发出（图中 BehaviorEngine → EventBus），供调度/统计/审计消费
- `BehaviorEventBusListener`：订阅 `high_intent_lead`，当前打日志，后续可接 Twilio / Realtime API。

## 边缘端 Runtime

- 仓库根 `src/agent/behavior-runtime.ts`：`interpret(path)`、`runPath(path, executor)`，与后端契约一致，供边缘按步执行并注入 RPA。

## 行为评分系统（自动进化）

- **BehaviorLogEntry**：`behavior-scoring.types.ts` — 边缘上报的日志结构（persona_id, session_id, path, duration_sec, effectiveness, node_health, risk_flags）。
- **ScoringEngineService**：多维度打分（Effectiveness / Human-likeness / Risk / Efficiency）与综合分，支持权重。
- **BehaviorPoolService**：高分行为入池（≥0.5），`getTemplates()` / `getTopScored()` / `sampleAndMutate()` 供生成与调度使用。
- **BehaviorLoggerService**：`log(entry)` → score → pool.add，形成闭环。
- **BehaviorEngineService**：`generatePath()` 时约 30% 概率从经验池 `sampleAndMutate()` 生成，实现自动进化。
- **API**：`POST /behavior/log`、`GET /behavior/pool`、`GET /behavior/pool/top`、`GET /behavior/scoring/weights`。
- 边缘上报：`src/agent/behavior-reporter.ts` 的 `reportBehaviorLog(baseUrl, payload)`。

详见：`docs/行为评分系统_设计.md`。

## 调度（与架构图点兵虾 → WSS → Behavior Runtime 对齐）

- 行为会话 payload：`behavior-dispatch.types.ts`（`BehaviorSessionPayload`）、网关 `lobster-sop.types.ts`（`BehaviorSessionDispatchPayload`）。
- **FleetWebSocketGateway.dispatchBehaviorSession(nodeId, payload)**：向指定节点发送 `execute_behavior_session` 事件，边缘收到后用 Behavior Runtime 解析 `behavior_path` 并执行；执行完成后可调用 `POST /behavior/log` 上报。
- 调度层（如 MatrixDispatchWorker 或独立行为调度服务）在需要时调用上述方法，将 Behavior Engine 产出的会话下发给节点。

## 2026-03-19 Update
- BehaviorEngine now supports memory-aware generation via 
ode_id + current_task.
- /behavior/path and /behavior/session return memory_hits and lended_bias for observability.

