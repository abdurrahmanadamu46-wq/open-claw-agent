# CODEX-SS-01: per-peer 会话隔离

> **编号**: CODEX-SS-01
> **优先级**: P1
> **算力**: 中
> **来源**: awesome-openclaw-usecases-zh (电商多Agent `dmScope: per-peer` + Cron `session: isolated`)
> **前端对齐**: 渠道管理页增加「会话隔离模式」下拉选项
> **关联**: CODEX-TD-02 (Cron Scheduler 的 isolated session 依赖本任务)

---

## 一、背景

当前 `ws_connection_manager.py` 管理 WebSocket 连接，但**所有用户共享同一对话上下文**。
电商多 Agent 用例展示了两种隔离模式的关键需求：

| 模式 | 配置 | 效果 | 场景 |
|------|------|------|------|
| `per-peer` | `dmScope: "per-peer"` | 每个用户独立会话，历史互不干扰 | 多用户同时使用同一龙虾 |
| `isolated` | `session: "isolated"` | 一次性隔离会话，不读/不写主对话历史 | Cron 定时任务 |
| `shared` | `session: "shared"` | 复用当前对话上下文 | 手动触发的跟进操作 |

---

## 二、目标

增强 `ws_connection_manager.py` 和 `lobster_runner.py`，支持 per-peer 会话隔离 + isolated 会话模式。

---

## 三、需要修改/新建的文件

### 3.1 `dragon-senate-saas-v2/session_manager.py`（新建）

```python
"""
CODEX-SS-01: 会话隔离管理器

支持三种会话模式:
1. per-peer: 每个用户 (peer_id) 独立会话
2. isolated: 一次性隔离会话，不污染主对话历史
3. shared: 共享当前对话上下文 (默认行为)
"""

import hashlib
import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("session_manager")


@dataclass
class SessionContext:
    """会话上下文"""
    session_id: str
    peer_id: str            # 用户标识 (如 senderOpenId)
    lobster_id: str
    tenant_id: str = "default"
    channel: str = "websocket"
    mode: str = "shared"    # shared | per-peer | isolated
    messages: list = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_active_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    message_count: int = 0


class SessionManager:
    """
    会话隔离管理器。

    用法:
        sm = SessionManager(storage_dir="data/sessions")
        session = sm.get_or_create(peer_id="user-123", lobster_id="echoer", mode="per-peer")
        sm.append_message(session.session_id, role="user", content="你好")
        history = sm.get_history(session.session_id)
    """

    def __init__(self, storage_dir: str = "data/sessions"):
        self._storage = Path(storage_dir)
        self._storage.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, SessionContext] = {}

    def _make_session_id(self, peer_id: str, lobster_id: str, mode: str, tenant_id: str) -> str:
        """根据模式生成 session_id"""
        if mode == "isolated":
            # isolated 模式: 每次创建新的唯一会话
            ts = datetime.now(timezone.utc).isoformat()
            return hashlib.sha256(f"isolated:{peer_id}:{lobster_id}:{ts}".encode()).hexdigest()[:16]
        elif mode == "per-peer":
            # per-peer 模式: 同一用户+同一龙虾 = 同一会话
            return hashlib.sha256(f"peer:{tenant_id}:{peer_id}:{lobster_id}".encode()).hexdigest()[:16]
        else:
            # shared 模式: 同一龙虾的所有用户共享
            return hashlib.sha256(f"shared:{tenant_id}:{lobster_id}".encode()).hexdigest()[:16]

    def get_or_create(
        self,
        peer_id: str,
        lobster_id: str,
        mode: str = "per-peer",
        channel: str = "websocket",
        tenant_id: str = "default",
    ) -> SessionContext:
        """获取或创建会话"""
        session_id = self._make_session_id(peer_id, lobster_id, mode, tenant_id)

        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.last_active_at = datetime.now(timezone.utc).isoformat()
            return session

        # 尝试从磁盘加载
        session_file = self._storage / f"{session_id}.json"
        if session_file.exists() and mode != "isolated":
            try:
                data = json.loads(session_file.read_text(encoding="utf-8"))
                session = SessionContext(**data)
                self._sessions[session_id] = session
                logger.info(f"Loaded session {session_id} for peer={peer_id} lobster={lobster_id}")
                return session
            except Exception as e:
                logger.warning(f"Failed to load session {session_id}: {e}")

        # 创建新会话
        session = SessionContext(
            session_id=session_id,
            peer_id=peer_id,
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            channel=channel,
            mode=mode,
        )
        self._sessions[session_id] = session
        logger.info(f"Created {mode} session {session_id} for peer={peer_id} lobster={lobster_id}")
        return session

    def append_message(self, session_id: str, role: str, content: str):
        """添加消息到会话"""
        session = self._sessions.get(session_id)
        if not session:
            logger.warning(f"Session {session_id} not found")
            return
        session.messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        session.message_count += 1
        session.last_active_at = datetime.now(timezone.utc).isoformat()

        # isolated 模式不持久化
        if session.mode != "isolated":
            self._persist(session)

    def get_history(self, session_id: str, limit: int = 50) -> list[dict]:
        """获取会话历史"""
        session = self._sessions.get(session_id)
        if not session:
            return []
        return session.messages[-limit:]

    def clear_session(self, session_id: str):
        """清除会话"""
        if session_id in self._sessions:
            del self._sessions[session_id]
        session_file = self._storage / f"{session_id}.json"
        if session_file.exists():
            session_file.unlink()

    def list_sessions(self, peer_id: Optional[str] = None, lobster_id: Optional[str] = None) -> list[dict]:
        """列出会话"""
        results = []
        for s in self._sessions.values():
            if peer_id and s.peer_id != peer_id:
                continue
            if lobster_id and s.lobster_id != lobster_id:
                continue
            results.append({
                "session_id": s.session_id,
                "peer_id": s.peer_id,
                "lobster_id": s.lobster_id,
                "mode": s.mode,
                "message_count": s.message_count,
                "last_active_at": s.last_active_at,
            })
        return results

    def _persist(self, session: SessionContext):
        """持久化到磁盘"""
        path = self._storage / f"{session.session_id}.json"
        path.write_text(
            json.dumps(asdict(session), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
```

### 3.2 API 路由（添加到 `app.py`）

```python
from session_manager import SessionManager

session_mgr = SessionManager()

@app.get("/api/sessions")
async def list_sessions(peer_id: str = None, lobster_id: str = None):
    return {"sessions": session_mgr.list_sessions(peer_id, lobster_id)}

@app.get("/api/sessions/{session_id}/history")
async def get_session_history(session_id: str, limit: int = 50):
    return {"messages": session_mgr.get_history(session_id, limit)}

@app.delete("/api/sessions/{session_id}")
async def clear_session(session_id: str):
    session_mgr.clear_session(session_id)
    return {"status": "cleared"}
```

---

## 四、接入点

### 4.1 `ws_connection_manager.py` 集成

在消息处理中根据 peer_id 获取隔离会话：

```python
# 消息到达时
session = session_mgr.get_or_create(
    peer_id=message.sender_id,    # 用户唯一标识
    lobster_id=target_lobster,
    mode="per-peer",              # 渠道配置决定模式
    channel=message.channel,
)
history = session_mgr.get_history(session.session_id)
# 将 history 注入龙虾的 context
```

### 4.2 `cron_scheduler.py` 集成 (CODEX-TD-02)

Cron 调度器使用 isolated session：

```python
session = session_mgr.get_or_create(
    peer_id=f"cron-{task.task_id}",
    lobster_id=task.lobster_id,
    mode=task.session_mode,  # "isolated"
)
```

### 4.3 前端对齐清单

| API | 前端页面 | 功能 |
|-----|---------|------|
| `GET /api/sessions` | `web/src/app/operations/sessions/page.tsx` | 活跃会话列表(用户/龙虾/模式/消息数) |
| `GET /api/sessions/{id}/history` | 会话详情抽屉 | 对话历史时间线 |
| `DELETE /api/sessions/{id}` | 行操作 | 清除会话 |
| 渠道配置页 | 渠道管理增加字段 | `dmScope` 下拉: shared/per-peer |

---

## 五、与已有组件关系

| 组件 | 关系 |
|------|------|
| `ws_connection_manager.py` | **增强**: 消息路由时查询 session_manager |
| `lobster_runner.py` | **增强**: 运行任务时注入会话上下文 |
| `CODEX-TD-02 (cron_scheduler)` | **依赖**: isolated session 模式 |
| `lobster_event_bus.py` | 不受影响 |

---

## 六、验收标准

- [ ] per-peer 模式：不同用户的对话历史完全隔离
- [ ] isolated 模式：一次性会话不持久化，不污染其他会话
- [ ] shared 模式：兼容现有行为
- [ ] 会话持久化到磁盘，重启不丢失（isolated 除外）
- [ ] 3 个 API 端点正常工作
- [ ] 测试覆盖 ≥ 80%
