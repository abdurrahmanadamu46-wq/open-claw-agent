# HiClaw 借鉴 — 剩余 4 项 Codex 任务合集

> 本文件包含 CODEX-HC-03 ~ CODEX-HC-06，均来自 `docs/HICLAW_BORROWING_ANALYSIS.md`。
> 按优先级排序，可分别独立实施。

---

# CODEX-HC-03: Skill 目录标准化 (Gotchas + 按需加载 + 可执行脚本)

> **优先级**: P0 | **算力**: 低 | **来源**: HiClaw Skill 目录设计
> **增强**: CODEX-OCM-01（LobsterSkillRegistry）

## 背景

HiClaw 的每个 Skill 不是一个 JSON 条目，而是一个**目录**：
```
skills/task-management/
├── SKILL.md              ← 技能描述 + 何时使用 + Gotchas(陷阱清单)
├── references/           ← 按需加载的参考文档
└── scripts/              ← Agent 可直接调用的脚本
```

关键设计：
1. **Gotchas 节**：列出 LLM 常犯的错误和陷阱，防止重复踩坑
2. **按需加载**：Agent 不一次读所有参考文档，而是"读了再干"
3. **可执行脚本**：技能关联实际可执行的 shell/python 脚本

我们的 `LobsterSkillRegistry` (CODEX-OCM-01) 是代码级注册表，缺少这三个维度。

## 交付物

### 1. 扩展 Skill 目录结构

在 `packages/lobsters/lobster-{role}/skills/` 下为每个技能创建子目录：

```
packages/lobsters/lobster-radar/skills/
├── web-search/
│   ├── SKILL.md
│   ├── references/
│   │   └── search-api-guide.md
│   └── scripts/
│       └── agent-reach-search.sh
├── competitor-tracking/
│   ├── SKILL.md
│   ├── references/
│   │   ├── competitor-data-schema.md
│   │   └── scoring-criteria.md
│   └── scripts/
│       └── fetch-competitor-data.py
└── ...
```

### 2. SKILL.md 模板（含 Gotchas）

每个 SKILL.md 必须包含以下结构：

```markdown
---
name: web-search
description: 全网信号搜索，收集行业信号和竞品动态
bound_lobsters: [radar]
category: 信号采集
---

# 全网信号搜索

## 何时使用
- 当需要了解行业最新动态时
- 当需要搜索竞品信息时
- 当需要验证某个趋势是否真实时

## Gotchas（⚠️ 陷阱清单）

- **不要一次搜索太宽泛的关键词** — 会返回大量噪音，浪费 token。先用具体关键词，再逐步扩展
- **不要假设搜索结果的时效性** — 搜索引擎可能返回过时内容，始终检查日期
- **不要直接复制搜索结果作为输出** — 必须提炼、验证、标注来源
- **不要忽略负面信号** — 负面信号（差评、投诉、下架）往往比正面信号更有价值
- **搜索频率限制** — Agent Reach API 有请求限制，单次心跳周期不超过 10 次搜索

## 参考文档

| 文档 | 何时读取 |
|------|---------|
| `references/search-api-guide.md` | 首次使用或 API 报错时 |
| `references/scoring-criteria.md` | 需要对搜索结果评分时 |

## 可执行脚本

| 脚本 | 用途 |
|------|------|
| `scripts/agent-reach-search.sh` | 调用 Agent Reach API 执行搜索 |
```

### 3. `LobsterSkillRegistry` 扩展

在 `lobster_skill_registry.py` 的 `LobsterSkill` dataclass 中新增字段：

```python
@dataclass
class LobsterSkill:
    # ...现有字段...
    
    # 🆕 HiClaw 借鉴字段
    gotchas: list[str] = field(default_factory=list)  # 陷阱清单
    references: dict[str, str] = field(default_factory=dict)  # {文件名: 何时读取}
    scripts: dict[str, str] = field(default_factory=dict)  # {脚本名: 用途}
    skill_dir: str | None = None  # 技能目录路径
```

### 4. 每虾至少为 2 个核心技能创建完整 Skill 目录

| 龙虾 | 技能 1 | 技能 2 |
|------|--------|--------|
| radar | web-search | competitor-tracking |
| strategist | goal-decompose | calendar-plan |
| inkwriter | copy-generate | compliance-check |
| visualizer | storyboard | ai-image |
| dispatcher | schedule-publish | account-rotate |
| echoer | reply-generate | dm-reply |
| catcher | lead-score | crm-sync |
| abacus | roi-calc | attribution |
| followup | sop-generate | multi-touch |

## 验收标准

1. 18 个 Skill 目录已创建（每虾 2 个），每个包含 SKILL.md
2. 每个 SKILL.md 包含至少 3 条 Gotchas
3. `LobsterSkill` 新增 `gotchas`/`references`/`scripts` 字段
4. 现有测试不受影响

---

# CODEX-HC-04: 边缘执行端容器生命周期管理

> **优先级**: P1 | **算力**: 中 | **来源**: HiClaw worker-lifecycle.json + lifecycle-worker.sh
> **增强**: CODEX-MC-01（BaseLobster 生命周期字段 → 扩展到边缘端）

## 背景

HiClaw 的 `worker-lifecycle.json` + `lifecycle-worker.sh` 实现了完整的容器生命周期：
- 状态同步（running/stopped/missing）
- 空闲超时自动停止（节省资源）
- 任务分配时自动唤醒（按需启动）
- 异常容器自动重建

我们的边缘执行端（BBP/提线木偶）当前没有生命周期管理——启动后一直运行，没有空闲休眠机制。

## 交付物

### 1. `edge-runtime/edge-lifecycle.json`（运行时状态文件）

```json
{
  "$schema": "edge-lifecycle-v1",
  "updated_at": null,
  "endpoints": {
    "edge_douyin_01": {
      "type": "bbp",
      "platform": "douyin",
      "container_state": "stopped",
      "last_active": null,
      "idle_since": null,
      "idle_timeout_minutes": 30,
      "auto_stop": true,
      "auto_restart_on_task": true,
      "ws_connected": false,
      "error_count": 0,
      "last_error": null,
      "success_rate_24h": null
    }
  }
}
```

### 2. `edge-runtime/lifecycle_manager.py`

```python
"""
lifecycle_manager.py — 边缘执行端生命周期管理器

借鉴 HiClaw 的 worker-lifecycle.json + lifecycle-worker.sh 模式。
"""
import json
import time
import asyncio
import logging
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

logger = logging.getLogger("edge_lifecycle")

LIFECYCLE_PATH = Path("edge-runtime/edge-lifecycle.json")
IDLE_CHECK_INTERVAL_SEC = 60


def load_lifecycle(path: Path = LIFECYCLE_PATH) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"$schema": "edge-lifecycle-v1", "updated_at": None, "endpoints": {}}


def save_lifecycle(data: dict[str, Any], path: Path = LIFECYCLE_PATH) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def mark_active(endpoint_id: str, path: Path = LIFECYCLE_PATH) -> None:
    """Mark an endpoint as active (call on task execution or WS message)."""
    data = load_lifecycle(path)
    ep = data.get("endpoints", {}).get(endpoint_id)
    if ep:
        ep["last_active"] = datetime.now(timezone.utc).isoformat()
        ep["idle_since"] = None
        ep["container_state"] = "running"
        save_lifecycle(data, path)


def mark_idle(endpoint_id: str, path: Path = LIFECYCLE_PATH) -> None:
    """Mark an endpoint as idle."""
    data = load_lifecycle(path)
    ep = data.get("endpoints", {}).get(endpoint_id)
    if ep and ep.get("idle_since") is None:
        ep["idle_since"] = datetime.now(timezone.utc).isoformat()
        save_lifecycle(data, path)


def mark_stopped(endpoint_id: str, path: Path = LIFECYCLE_PATH) -> None:
    """Mark an endpoint as stopped."""
    data = load_lifecycle(path)
    ep = data.get("endpoints", {}).get(endpoint_id)
    if ep:
        ep["container_state"] = "stopped"
        ep["ws_connected"] = False
        save_lifecycle(data, path)


def ensure_ready(endpoint_id: str, path: Path = LIFECYCLE_PATH) -> str:
    """
    Ensure an endpoint is ready for task execution.
    Returns: "ready" | "started" | "failed"
    """
    data = load_lifecycle(path)
    ep = data.get("endpoints", {}).get(endpoint_id)
    if ep is None:
        return "failed"
    
    if ep.get("container_state") == "running" and ep.get("ws_connected"):
        return "ready"
    
    if ep.get("auto_restart_on_task"):
        # 尝试唤醒（实际实现需要调用 Docker API 或发送 WSS 唤醒信号）
        ep["container_state"] = "starting"
        ep["idle_since"] = None
        save_lifecycle(data, path)
        logger.info("Waking up endpoint %s", endpoint_id)
        return "started"
    
    return "failed"


def check_idle_timeout(path: Path = LIFECYCLE_PATH) -> list[str]:
    """Check for idle endpoints that should be auto-stopped. Returns list of stopped endpoint IDs."""
    data = load_lifecycle(path)
    stopped = []
    now = datetime.now(timezone.utc)
    for ep_id, ep in data.get("endpoints", {}).items():
        if ep.get("container_state") != "running" or not ep.get("auto_stop"):
            continue
        idle_since = ep.get("idle_since")
        if idle_since is None:
            continue
        idle_time = datetime.fromisoformat(idle_since.replace("Z", "+00:00"))
        timeout_min = ep.get("idle_timeout_minutes", 30)
        if (now - idle_time).total_seconds() > timeout_min * 60:
            ep["container_state"] = "stopped"
            ep["ws_connected"] = False
            stopped.append(ep_id)
            logger.info("Auto-stopped idle endpoint %s (idle for %d min)", ep_id, timeout_min)
    if stopped:
        save_lifecycle(data, path)
    return stopped


def get_edge_summary(path: Path = LIFECYCLE_PATH) -> list[dict[str, Any]]:
    """Return edge endpoint summaries for dashboard."""
    data = load_lifecycle(path)
    return [
        {
            "endpoint_id": ep_id,
            "type": ep.get("type"),
            "platform": ep.get("platform"),
            "container_state": ep.get("container_state"),
            "ws_connected": ep.get("ws_connected"),
            "last_active": ep.get("last_active"),
            "error_count": ep.get("error_count", 0),
        }
        for ep_id, ep in data.get("endpoints", {}).items()
    ]
```

### 3. 整合到 HeartbeatEngine 第 6 步

在 CODEX-HC-01 的 `heartbeat_engine.py` 的 `_check_edge_runtime()` 方法中，改为读取 `edge-lifecycle.json`：

```python
def _check_edge_runtime(self) -> list[dict]:
    from lifecycle_manager import check_idle_timeout, get_edge_summary
    findings = []
    
    # 检查并自动停止空闲端点
    stopped = check_idle_timeout()
    for ep_id in stopped:
        findings.append({
            "severity": "info",
            "lobster": "dispatcher",
            "message": f"边缘端 {ep_id} 因空闲超时已自动休眠",
        })
    
    # 检查连接状态
    for ep in get_edge_summary():
        if ep["container_state"] == "running" and not ep["ws_connected"]:
            findings.append({
                "severity": "warning",
                "lobster": "dispatcher",
                "message": f"边缘端 {ep['endpoint_id']} 容器运行但 WSS 断连",
            })
    return findings
```

## 验收标准

1. `edge-runtime/edge-lifecycle.json` 模板文件已创建
2. `edge-runtime/lifecycle_manager.py` 所有函数可用
3. `check_idle_timeout()` 正确检测并标记超时端点
4. `ensure_ready()` 可以唤醒已停止的端点
5. HeartbeatEngine 第 6 步读取 edge-lifecycle 状态

## 前端对齐

```typescript
GET /api/edge/lifecycle   // 返回边缘端点生命周期状态

interface EdgeEndpoint {
  endpoint_id: string;
  type: "bbp" | "marionette";
  platform: string;
  container_state: "running" | "stopped" | "starting" | "error";
  ws_connected: boolean;
  last_active: string | null;
  error_count: number;
}
```

---

# CODEX-HC-05: 透明通信可观察房间

> **优先级**: P1 | **算力**: 中 | **来源**: HiClaw Matrix Room 透明通信模式
> **增强**: 现有 `lobster_event_bus.py`

## 背景

HiClaw 所有 Agent 通信发生在 Matrix 房间中，人类实时可见——没有隐藏通信。我们的 `lobster_event_bus.py` 在内存中传递事件，人类只能通过审计日志事后查看。

完全迁移到 Matrix 不现实，但可以在现有 EventBus 上增加"可观察"层。

## 交付物

### 1. `dragon-senate-saas-v2/lobster_observation_room.py`

```python
"""
lobster_observation_room.py — 龙虾通信可观察房间

借鉴 HiClaw 的 Matrix Room 透明通信模式。
在现有 lobster_event_bus 上增加"可观察"层，让人类可以实时看到龙虾间通信。
"""
import asyncio
import json
import logging
from typing import Any, Callable, Optional
from datetime import datetime, timezone
from collections import defaultdict

logger = logging.getLogger("observation_room")

# 按龙虾 ID 存储消息历史（环形缓冲，最多 200 条）
MAX_HISTORY = 200
_room_history: dict[str, list[dict]] = defaultdict(list)

# WebSocket 订阅者（前端实时监听）
_ws_subscribers: dict[str, list[Callable]] = defaultdict(list)


def record_event(
    source_lobster: str,
    target_lobster: str | None,
    event_type: str,
    payload: dict[str, Any],
    *,
    room_id: str | None = None,
) -> dict[str, Any]:
    """
    Record a lobster communication event to the observation room.
    Call this from lobster_event_bus whenever an event is published.
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source_lobster,
        "target": target_lobster,
        "event_type": event_type,
        "payload": payload,
        "room_id": room_id or f"room:{source_lobster}",
    }
    
    # 记录到发送方房间
    _append_to_room(source_lobster, entry)
    # 如果有目标，也记录到目标方房间
    if target_lobster and target_lobster != source_lobster:
        _append_to_room(target_lobster, entry)
    # 记录到全局房间
    _append_to_room("__global__", entry)
    
    # 通知 WebSocket 订阅者
    _notify_subscribers(source_lobster, entry)
    if target_lobster:
        _notify_subscribers(target_lobster, entry)
    _notify_subscribers("__global__", entry)
    
    return entry


def get_room_history(
    lobster_id: str,
    limit: int = 50,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """Get recent messages from a lobster's observation room."""
    history = _room_history.get(lobster_id, [])
    if since:
        history = [e for e in history if e["timestamp"] > since]
    return history[-limit:]


def get_global_history(limit: int = 100) -> list[dict[str, Any]]:
    """Get recent messages from the global observation room."""
    return get_room_history("__global__", limit)


def subscribe(lobster_id: str, callback: Callable[[dict], None]) -> Callable:
    """Subscribe to a lobster's room for real-time updates. Returns unsubscribe function."""
    _ws_subscribers[lobster_id].append(callback)
    def unsubscribe():
        _ws_subscribers[lobster_id].remove(callback)
    return unsubscribe


def get_active_rooms() -> list[dict[str, Any]]:
    """List all rooms with recent activity."""
    rooms = []
    for room_id, history in _room_history.items():
        if room_id == "__global__":
            continue
        rooms.append({
            "room_id": room_id,
            "message_count": len(history),
            "last_activity": history[-1]["timestamp"] if history else None,
            "subscribers": len(_ws_subscribers.get(room_id, [])),
        })
    return sorted(rooms, key=lambda r: r.get("last_activity") or "", reverse=True)


# ── Internal ──

def _append_to_room(room_id: str, entry: dict) -> None:
    history = _room_history[room_id]
    history.append(entry)
    if len(history) > MAX_HISTORY:
        _room_history[room_id] = history[-MAX_HISTORY:]


def _notify_subscribers(room_id: str, entry: dict) -> None:
    for callback in _ws_subscribers.get(room_id, []):
        try:
            callback(entry)
        except Exception as exc:
            logger.warning("Subscriber error in room %s: %s", room_id, exc)
```

### 2. 整合到 `lobster_event_bus.py`

在 `lobster_event_bus.py` 的 `publish()` 方法中增加观察室记录：

```python
from lobster_observation_room import record_event

def publish(self, event_type: str, source: str, target: str | None, payload: dict):
    # ...现有逻辑...
    
    # 🆕 记录到观察室
    record_event(source, target, event_type, payload)
```

### 3. 前端 WebSocket 端点

在 `app.py` 中新增 WebSocket 端点：

```python
@app.websocket("/ws/observation/{lobster_id}")
async def observation_ws(websocket, lobster_id: str):
    """Real-time observation room for a lobster's communications."""
    await websocket.accept()
    
    async def on_event(entry):
        await websocket.send_json(entry)
    
    unsubscribe = subscribe(lobster_id, on_event)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    finally:
        unsubscribe()
```

## 验收标准

1. `record_event()` 正确记录事件到源/目标/全局房间
2. `get_room_history()` 返回指定龙虾的通信记录
3. WebSocket 订阅者收到实时推送
4. `lobster_event_bus.py` 的 `publish()` 调用了 `record_event()`
5. `GET /api/observation/rooms` 返回活跃房间列表
6. `GET /api/observation/{lobster_id}/history` 返回房间历史

## 前端对齐

```typescript
// REST API
GET /api/observation/rooms                    // 活跃房间列表
GET /api/observation/{lobster_id}/history     // 房间历史消息

// WebSocket (实时推送)
WS  /ws/observation/{lobster_id}             // 订阅某龙虾的通信
WS  /ws/observation/__global__               // 订阅全局通信

interface ObservationEvent {
  timestamp: string;
  source: string;       // 发送方龙虾 ID
  target: string | null; // 接收方龙虾 ID
  event_type: string;
  payload: Record<string, any>;
  room_id: string;
}

interface ObservationRoom {
  room_id: string;
  message_count: number;
  last_activity: string | null;
  subscribers: number;
}
```

---

# CODEX-HC-06: YOLO 模式 / Autonomy 级别开关

> **优先级**: P1 | **算力**: 低 | **来源**: HiClaw yolo-mode + Clawith autonomy policy
> **整合**: 合并 Clawith 的 L1/L2/L3 和 HiClaw 的 yolo-mode

## 背景

HiClaw 通过一个文件 `yolo-mode` 的存在/缺失来切换 Manager 的自主模式。Clawith 有更细粒度的 L1/L2/L3 autonomy policy。我们当前只有审批门（approval gate），没有自主级别控制。

## 交付物

### 1. `dragon-senate-saas-v2/autonomy-config.json`

```json
{
  "$schema": "autonomy-config-v1",
  "autonomy_level": "L2",
  "levels": {
    "L1": {
      "description": "完全人工确认 — 每个龙虾动作都需要人类审批",
      "auto_approve": false,
      "auto_execute": false,
      "notify_on_action": true
    },
    "L2": {
      "description": "低风险自主 — 低风险动作自动执行，高风险需审批",
      "auto_approve": true,
      "auto_execute": true,
      "notify_on_action": true,
      "auto_approve_conditions": {
        "max_cost_per_action_usd": 1.0,
        "allowed_categories": ["信号采集", "数据分析", "内容生产"],
        "blocked_categories": ["发布", "删除", "支付"],
        "confidence_threshold": 0.8
      }
    },
    "L3": {
      "description": "全自主(YOLO) — 所有动作自动执行，仅事后通知",
      "auto_approve": true,
      "auto_execute": true,
      "notify_on_action": false,
      "notify_on_completion": true
    }
  },
  "per_lobster_overrides": {
    "dispatcher": "L1",
    "echoer": "L2"
  },
  "updated_at": null
}
```

### 2. `dragon-senate-saas-v2/autonomy_guard.py`

```python
"""
autonomy_guard.py — 自主级别守卫

根据 autonomy-config.json 判断龙虾动作是否需要人类审批。
"""
import json
from pathlib import Path
from typing import Any

CONFIG_PATH = Path("autonomy-config.json")


def load_autonomy_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"autonomy_level": "L2", "levels": {}, "per_lobster_overrides": {}}


def get_effective_level(lobster_id: str, path: Path = CONFIG_PATH) -> str:
    """Get the effective autonomy level for a lobster."""
    config = load_autonomy_config(path)
    override = config.get("per_lobster_overrides", {}).get(lobster_id)
    return override or config.get("autonomy_level", "L2")


def should_auto_approve(
    lobster_id: str,
    action_category: str,
    estimated_cost_usd: float = 0.0,
    confidence: float = 1.0,
    path: Path = CONFIG_PATH,
) -> tuple[bool, str]:
    """
    Determine if an action should be auto-approved.
    Returns: (approved: bool, reason: str)
    """
    config = load_autonomy_config(path)
    level = get_effective_level(lobster_id, path)
    level_config = config.get("levels", {}).get(level, {})
    
    if not level_config.get("auto_approve"):
        return False, f"Level {level}: 需要人工审批"
    
    # L3 (YOLO) — 全部自动通过
    if level == "L3":
        return True, "YOLO 模式: 自动通过"
    
    # L2 — 检查条件
    conditions = level_config.get("auto_approve_conditions", {})
    
    # 检查成本
    max_cost = conditions.get("max_cost_per_action_usd", 1.0)
    if estimated_cost_usd > max_cost:
        return False, f"成本 ${estimated_cost_usd:.2f} 超过阈值 ${max_cost:.2f}"
    
    # 检查类别
    blocked = conditions.get("blocked_categories", [])
    if action_category in blocked:
        return False, f"类别 '{action_category}' 在阻止列表中"
    
    allowed = conditions.get("allowed_categories", [])
    if allowed and action_category not in allowed:
        return False, f"类别 '{action_category}' 不在允许列表中"
    
    # 检查置信度
    threshold = conditions.get("confidence_threshold", 0.8)
    if confidence < threshold:
        return False, f"置信度 {confidence:.2f} 低于阈值 {threshold:.2f}"
    
    return True, f"Level {level}: 条件通过，自动执行"


def set_autonomy_level(level: str, path: Path = CONFIG_PATH) -> None:
    """Set global autonomy level."""
    config = load_autonomy_config(path)
    config["autonomy_level"] = level
    from datetime import datetime, timezone
    config["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def set_lobster_override(lobster_id: str, level: str, path: Path = CONFIG_PATH) -> None:
    """Set per-lobster autonomy level override."""
    config = load_autonomy_config(path)
    config.setdefault("per_lobster_overrides", {})[lobster_id] = level
    from datetime import datetime, timezone
    config["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
```

### 3. 整合到 `lobster_runner.py`

在执行前调用 autonomy guard：

```python
from autonomy_guard import should_auto_approve

# 在 Hook 之前检查
approved, reason = should_auto_approve(
    lobster_id=lobster.role_id,
    action_category=task.get("category", ""),
    estimated_cost_usd=estimated_cost,
    confidence=confidence_score,
)

if not approved:
    # 进入审批队列
    await submit_for_approval(task, reason)
    return {"status": "pending_approval", "reason": reason}
```

### 4. 测试

覆盖：
- L1 模式下所有动作被拒绝
- L2 模式下低风险通过、高风险被拒绝
- L3 模式下所有动作通过
- per_lobster_override 生效
- 成本/类别/置信度条件检查

## 验收标准

1. `autonomy-config.json` 包含 L1/L2/L3 三级定义
2. `should_auto_approve()` 正确按条件判断
3. `lobster_runner.py` 在执行前检查自主级别
4. `set_autonomy_level()` / `set_lobster_override()` 可动态切换

## 前端对齐

```typescript
GET  /api/autonomy                        // 返回当前自主级别配置
PUT  /api/autonomy/level                  // 设置全局自主级别
PUT  /api/autonomy/override/{lobster_id}  // 设置单虾自主级别

interface AutonomyConfig {
  autonomy_level: "L1" | "L2" | "L3";
  per_lobster_overrides: Record<string, "L1" | "L2" | "L3">;
}
```
