# CODEX TASK: 事件 Subject 层级化命名规范

**优先级：P1**  
**来源：NATS_BORROWING_ANALYSIS.md P1-#1（NATS Subject Naming Convention）**

---

## 背景

我们的 `webhook_event_bus.py` 和 `lobster_mailbox.py` 目前使用扁平化事件名（如 `task_completed`、`lobster_ready`、`edge_disconnected`），存在三个问题：
1. 无法通配订阅（无法订阅"所有边缘事件"或"某租户的所有任务事件"）
2. 事件名无自描述性（无法从名称判断来源层级）
3. 未来引入真实 NATS 时需要大规模重命名

借鉴 NATS Subject 层级式命名（`a.b.c`），以极低成本升级事件系统的可扩展性。

---

## 一、命名规范定义

```python
# dragon-senate-saas-v2/event_subjects.py
# 事件 Subject 命名规范（NATS 风格）

"""
命名格式：{domain}.{qualifier...}.{action}

域（domain）：
  task      — 工作流/任务执行事件
  lobster   — 龙虾状态事件
  edge      — 边缘节点事件
  tenant    — 租户管理事件
  system    — 系统级事件

通配符（文档性质，记录订阅模式）：
  *  — 匹配单个层级（edge.*.connected）
  >  — 匹配后续所有层级（edge.>）
"""

class EventSubjects:
    """标准化事件 Subject 常量"""

    # ── 任务/工作流事件 ─────────────────────────────────────
    # task.{tenant_id}.{workflow_id}.execution.started
    TASK_EXECUTION_STARTED      = "task.{tenant_id}.{workflow_id}.execution.started"
    # task.{tenant_id}.{workflow_id}.execution.completed
    TASK_EXECUTION_COMPLETED    = "task.{tenant_id}.{workflow_id}.execution.completed"
    # task.{tenant_id}.{workflow_id}.execution.failed
    TASK_EXECUTION_FAILED       = "task.{tenant_id}.{workflow_id}.execution.failed"
    # task.{tenant_id}.{workflow_id}.step.{step_id}.started
    TASK_STEP_STARTED           = "task.{tenant_id}.{workflow_id}.step.{step_id}.started"
    # task.{tenant_id}.{workflow_id}.step.{step_id}.completed
    TASK_STEP_COMPLETED         = "task.{tenant_id}.{workflow_id}.step.{step_id}.completed"
    # task.{tenant_id}.{workflow_id}.step.{step_id}.failed
    TASK_STEP_FAILED            = "task.{tenant_id}.{workflow_id}.step.{step_id}.failed"

    # ── 龙虾状态事件 ────────────────────────────────────────
    # lobster.{lobster_id}.status.ready
    LOBSTER_STATUS_READY        = "lobster.{lobster_id}.status.ready"
    # lobster.{lobster_id}.status.busy
    LOBSTER_STATUS_BUSY         = "lobster.{lobster_id}.status.busy"
    # lobster.{lobster_id}.status.error
    LOBSTER_STATUS_ERROR        = "lobster.{lobster_id}.status.error"
    # lobster.{lobster_id}.skill.{skill_name}.invoked
    LOBSTER_SKILL_INVOKED       = "lobster.{lobster_id}.skill.{skill_name}.invoked"
    # lobster.{lobster_id}.quality.score_updated
    LOBSTER_QUALITY_UPDATED     = "lobster.{lobster_id}.quality.score_updated"

    # ── 边缘节点事件 ────────────────────────────────────────
    # edge.{edge_id}.connection.connected
    EDGE_CONNECTED              = "edge.{edge_id}.connection.connected"
    # edge.{edge_id}.connection.disconnected
    EDGE_DISCONNECTED           = "edge.{edge_id}.connection.disconnected"
    # edge.{edge_id}.task.assigned
    EDGE_TASK_ASSIGNED          = "edge.{edge_id}.task.assigned"
    # edge.{edge_id}.task.completed
    EDGE_TASK_COMPLETED         = "edge.{edge_id}.task.completed"
    # edge.{edge_id}.heartbeat
    EDGE_HEARTBEAT              = "edge.{edge_id}.heartbeat"
    # edge.all.config.broadcast （广播给所有 Edge）
    EDGE_CONFIG_BROADCAST       = "edge.all.config.broadcast"

    # ── 租户事件 ────────────────────────────────────────────
    # tenant.{tenant_id}.quota.exceeded
    TENANT_QUOTA_EXCEEDED       = "tenant.{tenant_id}.quota.exceeded"
    # tenant.{tenant_id}.concurrency.limit_reached
    TENANT_CONCURRENCY_LIMIT    = "tenant.{tenant_id}.concurrency.limit_reached"
    # tenant.{tenant_id}.plan.upgraded
    TENANT_PLAN_UPGRADED        = "tenant.{tenant_id}.plan.upgraded"

    # ── 系统事件 ────────────────────────────────────────────
    # system.alert.triggered
    SYSTEM_ALERT_TRIGGERED      = "system.alert.triggered"
    # system.provider.health_changed
    SYSTEM_PROVIDER_HEALTH      = "system.provider.health_changed"

    @staticmethod
    def format(template: str, **kwargs) -> str:
        """格式化 Subject（替换变量）"""
        return template.format(**kwargs)


# 通配订阅模式（文档性质）
class SubjectPatterns:
    """常用通配订阅模式"""
    ALL_EDGE_EVENTS         = "edge.>"           # 所有边缘事件
    ALL_TASK_EVENTS         = "task.>"           # 所有任务事件
    TENANT_ALL_TASKS        = "task.{tenant_id}.>"  # 某租户所有任务
    ALL_LOBSTER_STATUS      = "lobster.*.status.*"   # 所有龙虾状态变化
    ALL_EDGE_CONNECTIONS    = "edge.*.connection.*"  # 所有边缘连接事件
```

---

## 二、webhook_event_bus.py 改造

```python
# dragon-senate-saas-v2/webhook_event_bus.py
# 改造：使用层级化 Subject 替代扁平化事件名

from .event_subjects import EventSubjects

class WebhookEventBus:
    """事件总线（内存 Pub/Sub，Subject 风格路由）"""

    def __init__(self):
        # 订阅者：{subject_pattern: [callbacks]}
        # 支持精确匹配和 > 通配
        self._subscribers: dict[str, list] = {}

    def subscribe(self, subject_pattern: str, callback):
        """订阅 Subject（支持 > 通配）"""
        if subject_pattern not in self._subscribers:
            self._subscribers[subject_pattern] = []
        self._subscribers[subject_pattern].append(callback)

    async def publish(self, subject: str, data: dict):
        """发布事件到 Subject"""
        matched_callbacks = []
        for pattern, callbacks in self._subscribers.items():
            if self._matches(pattern, subject):
                matched_callbacks.extend(callbacks)

        for cb in matched_callbacks:
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(subject, data)
                else:
                    cb(subject, data)
            except Exception as e:
                logger.error(f"[EventBus] 事件处理失败 subject={subject}: {e}")

    @staticmethod
    def _matches(pattern: str, subject: str) -> bool:
        """
        Subject 匹配（支持 > 通配）
        "edge.>"       匹配 "edge.node1.connected"
        "edge.*.connection.*" 匹配 "edge.node1.connection.connected"
        精确匹配       匹配完整 subject
        """
        if pattern == subject:
            return True
        if pattern.endswith(">"):
            prefix = pattern[:-1]  # 去掉 ">"
            return subject.startswith(prefix)
        # * 通配（单层）
        pattern_parts = pattern.split(".")
        subject_parts = subject.split(".")
        if len(pattern_parts) != len(subject_parts):
            return False
        return all(p == s or p == "*" for p, s in zip(pattern_parts, subject_parts))


# 全局事件总线实例
event_bus = WebhookEventBus()


# ── 便捷发布函数 ─────────────────────────────────────────────

async def publish_task_started(tenant_id: str, workflow_id: str, execution_id: str):
    subject = EventSubjects.format(
        EventSubjects.TASK_EXECUTION_STARTED,
        tenant_id=tenant_id, workflow_id=workflow_id,
    )
    await event_bus.publish(subject, {
        "execution_id": execution_id,
        "tenant_id": tenant_id,
        "workflow_id": workflow_id,
        "ts": time.time(),
    })

async def publish_edge_connected(edge_id: str, edge_info: dict):
    subject = EventSubjects.format(EventSubjects.EDGE_CONNECTED, edge_id=edge_id)
    await event_bus.publish(subject, {"edge_id": edge_id, **edge_info, "ts": time.time()})

async def publish_edge_heartbeat(edge_id: str):
    subject = EventSubjects.format(EventSubjects.EDGE_HEARTBEAT, edge_id=edge_id)
    await event_bus.publish(subject, {"edge_id": edge_id, "ts": time.time()})
```

---

## 三、lobster_mailbox.py 改造

```python
# dragon-senate-saas-v2/lobster_mailbox.py
# 改造：龙虾间通信使用层级化 Subject

from .event_subjects import EventSubjects

class LobsterMailbox:
    """龙虾内部邮箱（基于 Subject 路由）"""

    def send_status(self, lobster_id: str, status: str, detail: dict = None):
        """发送龙虾状态变化事件"""
        status_map = {
            "ready": EventSubjects.LOBSTER_STATUS_READY,
            "busy": EventSubjects.LOBSTER_STATUS_BUSY,
            "error": EventSubjects.LOBSTER_STATUS_ERROR,
        }
        template = status_map.get(status, "lobster.{lobster_id}.status.{status}")
        subject = EventSubjects.format(template, lobster_id=lobster_id)
        event_bus.publish_sync(subject, {
            "lobster_id": lobster_id,
            "status": status,
            "detail": detail or {},
            "ts": time.time(),
        })

    def send_skill_invoked(self, lobster_id: str, skill_name: str, input_summary: str):
        """技能调用事件"""
        subject = EventSubjects.format(
            EventSubjects.LOBSTER_SKILL_INVOKED,
            lobster_id=lobster_id, skill_name=skill_name,
        )
        event_bus.publish_sync(subject, {
            "lobster_id": lobster_id,
            "skill_name": skill_name,
            "input_summary": input_summary,
            "ts": time.time(),
        })
```

---

## 四、AlertEngine 和其他订阅者改造

```python
# 改造前（扁平化）：
event_bus.subscribe("edge_disconnected", handle_edge_disconnect)
event_bus.subscribe("task_completed", handle_task_complete)

# 改造后（层级化 + 通配）：
event_bus.subscribe("edge.>.connection.disconnected", handle_edge_disconnect)
event_bus.subscribe("task.>", handle_any_task_event)
event_bus.subscribe(f"task.{tenant_id}.>", handle_tenant_task_events)
event_bus.subscribe("system.alert.triggered", handle_alert)

# 具体用例：
# 1. AlertEngine 订阅所有告警
event_bus.subscribe("system.alert.triggered", alert_engine.handle)

# 2. 边缘监控订阅所有边缘事件
event_bus.subscribe("edge.>", edge_monitor.handle)

# 3. 租户计费系统订阅特定租户的任务完成事件
event_bus.subscribe(f"task.{tenant_id}.*.execution.completed", billing.charge)

# 4. 并发控制器监听龙虾状态
event_bus.subscribe("lobster.*.status.*", concurrency_ctrl.update_lobster_status)
```

---

## 五、迁移策略（向后兼容）

```python
# 过渡期：旧事件名保留，新 Subject 并行发布
# 防止现有订阅者断裂

class WebhookEventBus:
    LEGACY_MAP = {
        # 旧名称 → 新 Subject（迁移期间同时触发两者）
        "task_completed":    "task.{tenant_id}.{workflow_id}.execution.completed",
        "edge_disconnected": "edge.{edge_id}.connection.disconnected",
        "lobster_ready":     "lobster.{lobster_id}.status.ready",
    }

    async def publish_legacy(self, old_event: str, data: dict):
        """迁移期兼容：发布旧事件名 + 对应新 Subject"""
        # 旧方式触发（向后兼容）
        await self.publish(old_event, data)
        # 新 Subject 触发（使用 data 中的字段填充）
        new_template = self.LEGACY_MAP.get(old_event)
        if new_template:
            try:
                new_subject = new_template.format(**data)
                await self.publish(new_subject, data)
            except KeyError:
                pass  # 缺少必要字段时跳过新 Subject
```

---

## 验收标准

- [ ] `event_subjects.py`：`EventSubjects` 常量类（含所有标准 Subject 模板）
- [ ] `SubjectPatterns`：常用通配订阅模式（文档 + 代码）
- [ ] `EventSubjects.format()` 静态方法（模板变量替换）
- [ ] `WebhookEventBus._matches()`：支持 `>` 和 `*` 通配匹配
- [ ] `webhook_event_bus.py` 改造：`publish()` 接受层级化 Subject
- [ ] `lobster_mailbox.py` 改造：使用 `EventSubjects` 常量
- [ ] `edge_heartbeat.py` 改造：使用 `EDGE_HEARTBEAT` Subject
- [ ] `AlertEngine` 订阅改为通配模式（`system.alert.triggered`）
- [ ] 迁移期 `publish_legacy()` 保留旧事件名向后兼容
- [ ] 所有新代码（LobsterRunner/并发控制/幂等服务）直接使用新 Subject

---

*Codex Task | 来源：NATS_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
