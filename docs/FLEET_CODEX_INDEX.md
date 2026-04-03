# Fleet 借鉴落地索引

**分析日期**：2026-04-02  
**来源**：https://github.com/fleetdm/fleet（⭐6,201）  
**语言**：Go + TypeScript/React  
**定位**：开源端点设备管理平台（Orbit边缘agent + osquery实时查询 + GitOps配置 + 策略合规）

---

## 核心价值总结

```
Fleet 对我们的最大启发（按价值排序）：

1. 活动日志是系统级基础设施
   Fleet 的所有操作自动产生结构化 Activity（谁/什么时候/做了什么/详情）
   → 我们升级：ActivityStream（类型化 + Webhook推送 + 前端时间线UI）

2. Worker Job 注册模式比 if/else 更可扩展
   Fleet 每种后台任务是独立注册的 Job 类，类型安全，可热插拔
   → 我们升级：JobRegistry 替换 task_queue.py 的字符串分发

3. 动态标签是管理大量实体的核心工具
   Fleet Labels：条件自动维护成员，可用于筛选/规则条件/批量操作
   → 我们升级：DynamicLabel（龙虾/线索/边缘节点三类标签）

4. 边缘 Token 必须有轮换机制（安全基础）
   Fleet orbit token：24小时轮换，旧Token立即吊销
   → 我们升级：TokenRotator（80%有效期触发轮换）

5. 敏感配置不能明文存储
   Fleet：secret_variables（云端加密）+ keystore（边缘本地加密）
   → 我们升级：SecretVault + EdgeKeystore
```

---

## 已落地声明（跳过）

| Fleet 功能 | 我们已落地 |
|-----------|----------|
| 边缘心跳/在线状态 | `edge_heartbeat.py` |
| WSS 重连退避 | `CODEX_TASK_EDGE_WSS_BACKOFF.md` |
| 边缘节点标签（基础）| `CODEX_TASK_EDGE_NODE_TAGS.md` |
| 金丝雀部署 | `CODEX_TASK_EDGE_CANARY_DEPLOY.md` |
| 边缘回滚 | `CODEX_TASK_EDGE_ROLLBACK.md` |
| 实时仪表板 | `CODEX_TASK_EDGE_REALTIME_DASHBOARD.md` |
| 审计日志（基础）| `tenant_audit_log.py` |
| RBAC 权限 | `rbac_permission.py` |
| 告警引擎 | `CODEX_TASK_ALERT_ENGINE.md` |
| 规则/策略引擎 | `CODEX_TASK_LOBSTER_RULE_ENGINE.md` |
| GitOps 配置（基础）| `CODEX_TASK_YAML_WORKFLOW.md` |

---

## 生成文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `docs/FLEET_BORROWING_ANALYSIS.md` | 6层完整对比分析（前端/大脑/龙虾/L1.5/调度/边缘）| ✅ |
| `docs/CODEX_TASK_FLEET_P1.md` | **P1** ActivityStream + DynamicLabel + JobRegistry + TokenRotator | ✅ |
| `docs/CODEX_TASK_FLEET_P2.md` | **P2** LiveQueryEngine + EdgeKeystore + SecretVault + StatsAggregator + 活动UI | ✅ |

---

## P1 推荐执行顺序

```
1. ActivityStream（最高价值，系统可观测性的核心）
   ← 落地：dragon-senate-saas-v2/activity_stream.py
   ← 集成：lobster_runner.py 每次执行自动 record
   ← 集成：规则 CRUD API 自动 record
   ← 集成：边缘节点注册/下线自动 record

2. JobRegistry（替换 task_queue.py 的 if/else 分发）
   ← 落地：dragon-senate-saas-v2/job_registry.py
   ← 已注册：SendMessage / ExtractMemory / EvaluateLabels / WebhookDelivery

3. DynamicLabel（线索/龙虾/边缘节点动态分组）
   ← 落地：dragon-senate-saas-v2/dynamic_label.py
   ← Cron 每5分钟评估一次成员
   ← 预置标签：高意向线索 / 活跃龙虾 / 离线节点

4. TokenRotator（边缘 Token 安全轮换）
   ← 落地：edge-runtime/token_rotator.py
   ← 集成：edge_heartbeat.py 心跳循环中调用 rotate_if_needed()
```

---

## 逐层落地对照表

| 系统层 | Fleet 借鉴能力 | 落地文件 | 优先级 |
|--------|-------------|---------|-------|
| **前端** | 活动日志时间线 UI | `/settings/activities` | P2-5 |
| **前端** | 动态标签管理页 | `/settings/labels` | P1-2 |
| **大脑层** | 结构化活动流（ActivityStream）| `activity_stream.py` | P1-1 🔴 |
| **大脑层** | Job 注册中心（JobRegistry）| `job_registry.py` | P1-3 🔴 |
| **大脑层** | 执行统计聚合（StatsAggregator）| `stats_aggregator.py` | P2-4 |
| **L1.5微服务** | 动态标签（DynamicLabel）| `dynamic_label.py` | P1-2 🔴 |
| **L1.5微服务** | Secret 变量管理（SecretVault）| `secret_vault.py` | P2-3 |
| **云边调度** | Token 轮换（TokenRotator）| `token_rotator.py` | P1-4 🔴 |
| **云边调度** | 实时广播查询（LiveQueryEngine）| `live_query_engine.py` | P2-1 |
| **边缘层** | 本地 Keystore（EdgeKeystore）| `edge-runtime/keystore.py` | P2-2 |

---

## 与已有系统的协同链路

```
运营人员改了规则
       ↓
record_rule_changed() → ActivityStream.record()
       ↓
webhook_event_bus.py 推送到企微/飞书
       ↓
前端活动页实时显示（SSE）

龙虾执行完成
       ↓
record_lobster_executed() → ActivityStream.record()
       ↓
JobRegistry.dispatch("extract_memory", ...) → MemoryExtractor（mem0借鉴）
       ↓
StatsAggregator 每小时聚合统计
       ↓
前端龙虾统计卡片更新

边缘节点启动
       ↓
TokenRotator.rotate_if_needed()
       ↓
EdgeKeystore.set("edge_token", new_token)
       ↓
wss_receiver.py 使用新 Token 建立 WSS 连接
       ↓
ActivityStream.record(EDGE_NODE_ENROLLED)
```

---

## 独有优势（Fleet 没有的）

```
🦞 活动记录直接驱动龙虾行为调整（Fleet 的 activity 只做记录）
💰 活动记录包含 LLM 成本信息（tokens/cost，Fleet 无此维度）
📱 动态标签可用于中国 IM 渠道推送分组（Fleet 只管设备）
🧠 与 mem0 记忆层联动：活动触发记忆提取（Fleet 无 AI 记忆）
📊 统计聚合直接驱动龙虾进化（不只是看板数据）
```

---

*更新于 2026-04-02*
