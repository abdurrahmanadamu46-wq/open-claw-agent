# Phase D Week 3+ 想法收敛与落地蓝图

更新时间：2026-03-19  
目标：把你新增的 `Behavior OS + Elastic Memory + 评分闭环` 从“设计存在”推进到“执行闭环”。

## 1. 新增能力重述（你这轮的核心增量）

1. 行为操作系统（Behavior OS）从任务执行升级为“人设-意图-路径”生成。
2. 弹性记忆模块（LobsterMemoryEngine）引入设备级记忆检索与回放偏置。
3. 行为评分系统（Scoring + Pool）形成执行结果的正反馈学习闭环。
4. 前端进入 Week 3 生产化：fleet/campaign/dashboard 从 mock 迁移到真接口主路。

## 2. 当前最关键的系统主链路（收敛版）

1. Web 侧创建/触发动作（campaign/fleet/mission）。
2. Backend 统一接入（鉴权 + tenant scope + traceId）。
3. Behavior Controller 生成 `persona + intent + behavior_path`。
4. Behavior Engine 在生成路径前检索 `memory(node_id, current_task)`。
5. Engine 融合 `intent bias + memory bias + persona preference` 得到最终行为偏置。
6. Dispatcher 下发到边缘节点执行。
7. 边缘上报行为日志到 `/behavior/log`。
8. Scoring 产出分值并写入池（高分模板可变异复用）。
9. 下次生成时从 memory/pool 回流，形成可解释迭代。

## 3. 本轮已推进的代码级收口

1. `BehaviorEngineService` 已接入 `LobsterMemoryClientService`：
   - 增加记忆检索、偏置提取、偏置融合。
   - 新增 `generatePathWithContext()`，返回 `memoryHits` 与 `blendedBias`。
2. `BehaviorController` 已对齐：
   - `/behavior/path` 支持 `node_id/current_task/persona_id`。
   - `/behavior/session` 支持 `node_id/current_task`。
   - 返回值增加 `memory_hits`、`blended_bias` 方便观测与调优。

## 4. 你这个想法下一步最值得做的三件事（优先级）

1. D5-08（优先）：稳定 E2E 核心旅程并 CI 阻断（登录/大盘/fleet/campaign/mission）。
2. Memory-Behavior 可观测性：把 `memory_hits`、`blended_bias` 进 structured log 与 trace 聚合。
3. 策略可控化：把 bias 融合权重抽成配置（按租户/行业模板可调）。

## 5. 风险与边界（避免后续返工）

1. 强制 tenant scope：memory 检索必须 node/tenant 绑定，避免跨租户上下文污染。
2. 回放污染风险：低质量行为不可进入高分池，建议设最低分与冷却窗口。
3. 训练数据漂移：高分模板要保留版本号与来源，支持回滚（避免劣化扩散）。

## 6. Definition of Done（你这套想法完成态）

1. 主链路可追踪：任意行为会话可通过 traceId 还原“生成-执行-评分-回流”。
2. 可控可调：行为偏置融合权重可配置且可灰度。
3. 可观测可审计：memory 命中、评分分布、模板采样命中率有稳定指标面板。
4. 可回归：核心旅程 E2E 进入 CI 阻断，失败可定位到具体链路环节。

