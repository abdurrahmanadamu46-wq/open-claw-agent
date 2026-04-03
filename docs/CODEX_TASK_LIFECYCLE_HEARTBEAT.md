# Codex 任务：Agent 心跳与生命周期增强 (CODEX-MC-01)

> ⚠️ **整合提示**: 本任务聚焦**运行时健康监控**（状态机 + 心跳检测循环 + 错误持久化）。
> 与此互补的 **CODEX-AA-01** (`docs/CODEX_TASK_LOBSTER_SOUL_SYSTEM.md`) 中的 `heartbeat.json` 聚焦**业务层唤醒检查清单**（on_wake / periodic / stand_down）。
> 两者不冲突：MC-01 解决"龙虾是否还活着"，AA-01 解决"龙虾醒来该干什么"。建议先实施 MC-01，再实施 AA-01。
>
> ⚠️ **HiClaw 升级提示**: 本任务的心跳检测循环已被 **CODEX-HC-01** (`docs/CODEX_TASK_COMMANDER_HEARTBEAT_7STEP.md`) 升级为 **7 步管理例会**。
> 实施时：MC-01 的 BaseLobster 生命周期字段仍需落地，但 `_heartbeat_check_loop` 逻辑合入 HC-01 的 `HeartbeatEngine`。

## 任务目标

借鉴 OpenClaw Mission Control 的 `AgentLifecycleOrchestrator` 模式，给我们的龙虾系统添加：
1. `BaseLobster` 生命周期字段 (generation/heartbeat/deadline/error)
2. `LobsterPoolManager` 心跳检测循环
3. `LobsterRunner` 错误持久化

**不要创建新文件**，只修改以下现有文件。

---

## 文件 1：修改 `dragon-senate-saas-v2/lobsters/base_lobster.py`

### 当前状态
`BaseLobster` 类有 `role_id`, `role_card`, `prompt_kit`, `memory_policy` 等属性，但**没有任何运行时生命周期字段**。

### 需要添加的字段和方法

在 `BaseLobster.__init__` 中添加以下实例属性：

```python
# ── Lifecycle fields (inspired by Mission Control AgentLifecycleOrchestrator) ──
self.lifecycle_generation: int = 0          # 每次状态变更递增，防止过期操作
self.status: str = "idle"                   # idle | provisioning | online | busy | error | offline
self.last_seen_at: float | None = None      # time.monotonic() 时间戳
self.checkin_deadline_at: float | None = None  # 心跳超时截止时间
self.last_error: str | None = None          # 最近一次执行错误
self.error_count: int = 0                   # 累计错误次数
self.run_count: int = 0                     # 累计执行次数
self.created_at: float = time.monotonic()   # 创建时间
```

需要在文件顶部 `import time`。

添加以下方法到 `BaseLobster` 类：

```python
def heartbeat(self) -> None:
    """Record a heartbeat — call this when the lobster completes work or checks in."""
    self.last_seen_at = time.monotonic()

def mark_busy(self) -> None:
    """Transition to busy status."""
    self.status = "busy"
    self.lifecycle_generation += 1
    self.heartbeat()

def mark_online(self) -> None:
    """Transition to online (idle-ready) status."""
    self.status = "online"
    self.last_error = None
    self.heartbeat()

def mark_error(self, error: str) -> None:
    """Record an error and transition to error status."""
    self.status = "error"
    self.last_error = error
    self.error_count += 1
    self.lifecycle_generation += 1
    self.heartbeat()

def mark_offline(self) -> None:
    """Transition to offline status."""
    self.status = "offline"
    self.lifecycle_generation += 1

def record_run(self, *, success: bool, error: str | None = None) -> None:
    """Record a completed run."""
    self.run_count += 1
    if success:
        self.mark_online()
    else:
        self.mark_error(error or "unknown_error")

def is_alive(self, timeout_sec: float = 120.0) -> bool:
    """Check if lobster has checked in within timeout window."""
    if self.last_seen_at is None:
        return self.status == "idle"  # never started = considered alive if idle
    return (time.monotonic() - self.last_seen_at) < timeout_sec

def lifecycle_snapshot(self) -> dict[str, Any]:
    """Return a snapshot of lifecycle state for diagnostics/dashboard."""
    return {
        "role_id": self.role_id,
        "display_name": self.display_name,
        "zh_name": self.zh_name,
        "status": self.status,
        "lifecycle_generation": self.lifecycle_generation,
        "last_seen_at": self.last_seen_at,
        "checkin_deadline_at": self.checkin_deadline_at,
        "last_error": self.last_error,
        "error_count": self.error_count,
        "run_count": self.run_count,
        "is_alive": self.is_alive(),
    }
```

---

## 文件 2：修改 `dragon-senate-saas-v2/lobster_pool_manager.py`

### 当前状态
`lobster_pool_manager.py` 是一个 ~500 行的 SQLite 分析仪表盘模块，包含：
- `LOBSTER_REGISTRY` (9虾身份表)
- `ensure_lobster_pool_schema()` (SQLite DDL)
- `record_lobster_run()` (运行记录)
- `pool_overview()` (总览)
- `lobster_detail()` (单虾详情)
- `score_task()` (任务评分)
- `routing_history()` (路由历史)
- `pool_metrics()` (成本追踪)

**它没有心跳检测和实时生命周期管理。**

### 需要添加的功能

在文件末尾添加以下新部分：

```python
# ---------------------------------------------------------------------------
# 心跳检测 & 生命周期管理 (借鉴 Mission Control lifecycle_orchestrator)
# ---------------------------------------------------------------------------

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from lobsters.base_lobster import BaseLobster

# 活跃龙虾实例注册表（内存）
_ACTIVE_LOBSTERS: dict[str, "BaseLobster"] = {}
_HEARTBEAT_TASK: asyncio.Task[None] | None = None

HEARTBEAT_CHECK_INTERVAL_SEC = 30.0
HEARTBEAT_TIMEOUT_SEC = 120.0


def register_active_lobster(lobster: "BaseLobster") -> None:
    """Register a lobster instance for heartbeat monitoring."""
    _ACTIVE_LOBSTERS[lobster.role_id] = lobster
    lobster.mark_online()


def unregister_active_lobster(role_id: str) -> None:
    """Remove a lobster from heartbeat monitoring."""
    lobster = _ACTIVE_LOBSTERS.pop(role_id, None)
    if lobster is not None:
        lobster.mark_offline()


def get_active_lobster(role_id: str) -> "BaseLobster | None":
    """Get a registered active lobster by role_id."""
    return _ACTIVE_LOBSTERS.get(role_id)


def active_lobster_snapshot() -> list[dict[str, Any]]:
    """Return lifecycle snapshots for all active lobsters."""
    return [lobster.lifecycle_snapshot() for lobster in _ACTIVE_LOBSTERS.values()]


async def _heartbeat_check_loop() -> None:
    """Background loop that checks lobster heartbeats and marks stale ones."""
    while True:
        await asyncio.sleep(HEARTBEAT_CHECK_INTERVAL_SEC)
        now = time.monotonic()
        for role_id, lobster in list(_ACTIVE_LOBSTERS.items()):
            if lobster.status in ("offline", "idle"):
                continue
            if not lobster.is_alive(timeout_sec=HEARTBEAT_TIMEOUT_SEC):
                lobster.mark_error(f"heartbeat_timeout: no checkin for {HEARTBEAT_TIMEOUT_SEC}s")
                # Record to SQLite for dashboard visibility
                record_lobster_run(
                    lobster_id=role_id,
                    status="timeout",
                    error=f"Heartbeat timeout after {HEARTBEAT_TIMEOUT_SEC}s",
                    duration_ms=0,
                )


def start_heartbeat_monitor() -> None:
    """Start the background heartbeat check loop (call once at app startup)."""
    global _HEARTBEAT_TASK
    if _HEARTBEAT_TASK is None or _HEARTBEAT_TASK.done():
        loop = asyncio.get_event_loop()
        _HEARTBEAT_TASK = loop.create_task(_heartbeat_check_loop())


def stop_heartbeat_monitor() -> None:
    """Stop the background heartbeat check loop."""
    global _HEARTBEAT_TASK
    if _HEARTBEAT_TASK is not None and not _HEARTBEAT_TASK.done():
        _HEARTBEAT_TASK.cancel()
        _HEARTBEAT_TASK = None
```

### 同时修改 `lobster_health` 表 DDL

在 `ensure_lobster_pool_schema()` 的 `CREATE TABLE IF NOT EXISTS lobster_health` 中添加列：

```sql
lifecycle_generation INTEGER DEFAULT 0,
current_status TEXT DEFAULT 'idle',
last_error TEXT,
```

---

## 文件 3：修改 `dragon-senate-saas-v2/lobster_runner.py`

### 当前状态
`LobsterRunner` 已经有 Hook 系统 (`LobsterHook`, `CompositeHook`, `AuditHook`, `MetricsHook`)。

### 需要修改的地方

在 `LobsterRunner.execute` 方法中（或等效的 run 方法），在执行前后添加生命周期调用：

```python
# 执行前
lobster.mark_busy()
lobster.heartbeat()

# 执行成功后
lobster.record_run(success=True)

# 执行失败后 (在 except 块中)
lobster.record_run(success=False, error=str(exc))
```

**注意**：不要改变现有 Hook 调用顺序，生命周期调用应该在 Hook 之前/之后。

---

## 测试要求

在 `dragon-senate-saas-v2/tests/test_lifecycle_heartbeat.py` 新建测试文件：

```python
"""Tests for lifecycle heartbeat enhancements."""
import time
from lobsters.base_lobster import BaseLobster


class TestBaseLobsterLifecycle:
    def test_initial_status_is_idle(self):
        lobster = BaseLobster()
        assert lobster.status == "idle"
        assert lobster.lifecycle_generation == 0

    def test_mark_busy_increments_generation(self):
        lobster = BaseLobster()
        lobster.mark_busy()
        assert lobster.status == "busy"
        assert lobster.lifecycle_generation == 1
        assert lobster.last_seen_at is not None

    def test_mark_online_clears_error(self):
        lobster = BaseLobster()
        lobster.mark_error("test_error")
        assert lobster.last_error == "test_error"
        lobster.mark_online()
        assert lobster.last_error is None
        assert lobster.status == "online"

    def test_mark_error_increments_error_count(self):
        lobster = BaseLobster()
        lobster.mark_error("err1")
        lobster.mark_error("err2")
        assert lobster.error_count == 2
        assert lobster.last_error == "err2"

    def test_record_run_success(self):
        lobster = BaseLobster()
        lobster.record_run(success=True)
        assert lobster.run_count == 1
        assert lobster.status == "online"

    def test_record_run_failure(self):
        lobster = BaseLobster()
        lobster.record_run(success=False, error="boom")
        assert lobster.run_count == 1
        assert lobster.status == "error"
        assert lobster.last_error == "boom"

    def test_is_alive_true_for_recent_heartbeat(self):
        lobster = BaseLobster()
        lobster.heartbeat()
        assert lobster.is_alive(timeout_sec=10.0)

    def test_is_alive_false_for_stale(self):
        lobster = BaseLobster()
        lobster.last_seen_at = time.monotonic() - 200
        assert not lobster.is_alive(timeout_sec=120.0)

    def test_lifecycle_snapshot_returns_dict(self):
        lobster = BaseLobster()
        snap = lobster.lifecycle_snapshot()
        assert isinstance(snap, dict)
        assert "status" in snap
        assert "lifecycle_generation" in snap
        assert "is_alive" in snap

    def test_mark_offline(self):
        lobster = BaseLobster()
        lobster.mark_online()
        lobster.mark_offline()
        assert lobster.status == "offline"
```

---

## 验证标准

1. ✅ `BaseLobster` 有完整的生命周期字段和方法
2. ✅ `lobster_pool_manager.py` 有心跳检测循环和活跃龙虾注册表
3. ✅ `LobsterRunner` 在执行前后调用生命周期方法
4. ✅ 10 项单测全部通过
5. ✅ 不破坏现有功能（所有新字段有默认值）
6. ✅ 不引入新的外部依赖

## 不要做的事

- ❌ 不要创建新的独立模块文件（除了测试文件）
- ❌ 不要修改 `lobsters/__init__.py` 的导出
- ❌ 不要引入数据库（PostgreSQL/Redis）依赖
- ❌ 不要修改 `dragon_senate.py`
