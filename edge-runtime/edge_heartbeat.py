"""
EdgeHeartbeat — 边缘节点心跳机制
===================================
灵感来源：Temporal Activity Heartbeat
借鉴要点：
  - 边缘 MarionetteExecutor 执行任务时每 N 秒向云端上报心跳（task_id + progress）
  - 云端 dispatcher 检测到心跳超时 → 任务标记 stalled → 重新分配给在线节点
  - 边缘节点支持 Long Poll 主动拉取任务（比云端 Push 更可靠）

Temporal 概念映射：
  Activity.RecordHeartbeat()       → EdgeHeartbeat.send_heartbeat()
  Heartbeat timeout detection       → HeartbeatMonitor.check_stalled_tasks()
  Worker Poll (long poll)           → EdgeTaskPoller.poll()
  Worker graceful shutdown          → EdgeHeartbeat.graceful_shutdown()

⚠️ 架构铁律：
  边缘层不做视频合成，只做下载 + 发布 + 回传结果。
  本模块仅负责心跳上报和任务拉取，不包含业务逻辑。

使用方式（边缘 MarionetteExecutor）：
    heartbeat = EdgeHeartbeat(
        node_id="edge-node-001",
        cloud_api_url="https://api.openclaw.com",
        api_key="edge-secret-key",
    )
    # 启动后台心跳线程
    async with heartbeat.running(task_id="task-abc", capabilities=["douyin", "xiaohongshu"]):
        # 执行下载 + 发布
        await download_and_publish(bundle)
        heartbeat.report_progress(50, "下载完成")
        await publish_to_platform(bundle)
        heartbeat.report_progress(100, "发布成功")
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import threading
import urllib.request
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

# ─────────────────────────────────────────────────────────────────
# 配置常量
# ─────────────────────────────────────────────────────────────────

HEARTBEAT_INTERVAL_SEC = int(os.getenv("EDGE_HEARTBEAT_INTERVAL_SEC", "30"))
HEARTBEAT_TIMEOUT_SEC  = int(os.getenv("EDGE_HEARTBEAT_TIMEOUT_SEC", "90"))   # 超时3倍心跳间隔
POLL_INTERVAL_SEC      = int(os.getenv("EDGE_POLL_INTERVAL_SEC", "10"))       # Long Poll 轮询间隔
POLL_TIMEOUT_SEC       = int(os.getenv("EDGE_POLL_TIMEOUT_SEC", "30"))        # 单次 Long Poll 等待时长
CLOUD_API_URL          = os.getenv("CLOUD_API_URL", "http://localhost:8000")
EDGE_NODE_ID           = os.getenv("EDGE_NODE_ID", f"edge-{os.getpid()}")
EDGE_API_KEY           = os.getenv("EDGE_API_KEY", "")


# ─────────────────────────────────────────────────────────────────
# 数据模型
# ─────────────────────────────────────────────────────────────────

class HeartbeatStatus(str, Enum):
    alive    = "alive"      # 正常在线
    stalled  = "stalled"    # 心跳超时，任务可能已失败
    shutdown = "shutdown"   # 优雅退出中


@dataclass
class HeartbeatPayload:
    """心跳上报数据（对应 Temporal RecordHeartbeat details）"""
    node_id: str
    task_id: str
    progress: int                     # 0-100
    status: HeartbeatStatus
    message: str
    capabilities: list[str]           # 边缘节点支持的平台列表
    timestamp: str
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "task_id": self.task_id,
            "progress": self.progress,
            "status": self.status.value,
            "message": self.message,
            "capabilities": self.capabilities,
            "timestamp": self.timestamp,
            "meta": self.meta,
        }

    def to_json(self) -> bytes:
        return json.dumps(self.to_dict(), ensure_ascii=False).encode("utf-8")


@dataclass
class EdgeTaskPollResult:
    """Long Poll 拉取任务结果"""
    has_task: bool
    task_bundle: Optional[dict[str, Any]] = None
    poll_latency_ms: int = 0

    @property
    def task_id(self) -> Optional[str]:
        return self.task_bundle.get("task_id") if self.task_bundle else None


# ─────────────────────────────────────────────────────────────────
# EdgeHeartbeat — 边缘节点心跳管理器
# ─────────────────────────────────────────────────────────────────

class EdgeHeartbeat:
    """
    边缘节点心跳管理器（对应 Temporal Activity Heartbeat）。

    功能：
    1. 后台线程每 HEARTBEAT_INTERVAL_SEC 秒向云端上报心跳
    2. 支持 report_progress() 随时更新进度
    3. 支持 graceful_shutdown() 优雅退出（SIGTERM 处理）
    4. 支持 Long Poll 从云端拉取任务（比 Push 可靠）
    """

    def __init__(
        self,
        node_id: str = EDGE_NODE_ID,
        cloud_api_url: str = CLOUD_API_URL,
        api_key: str = EDGE_API_KEY,
        capabilities: Optional[list[str]] = None,
        heartbeat_interval: int = HEARTBEAT_INTERVAL_SEC,
    ) -> None:
        self.node_id = node_id
        self.cloud_api_url = cloud_api_url.rstrip("/")
        self.api_key = api_key
        self.capabilities = capabilities or ["douyin", "xiaohongshu", "kuaishou"]
        self.heartbeat_interval = heartbeat_interval

        # 当前任务状态
        self._current_task_id: str = ""
        self._current_progress: int = 0
        self._current_message: str = "idle"
        self._status: HeartbeatStatus = HeartbeatStatus.alive
        self._shutting_down: bool = False

        # 后台心跳线程
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # 注册 SIGTERM 处理（对应 Temporal Worker 优雅退出）
        self._register_signal_handlers()

    def _register_signal_handlers(self) -> None:
        """注册 SIGTERM/SIGINT 处理（对应 Temporal Worker 优雅退出）"""
        import signal

        def _handler(signum, frame):
            print(f"[EdgeHeartbeat] 收到信号 {signum}，开始优雅退出...")
            self._shutting_down = True
            self._status = HeartbeatStatus.shutdown
            self._stop_event.set()

        try:
            signal.signal(signal.SIGTERM, _handler)
            signal.signal(signal.SIGINT, _handler)
        except (OSError, ValueError):
            pass  # 非主线程无法注册信号

    # ── 心跳上报 ──────────────────────────────────────────────────

    def start_task(self, task_id: str, message: str = "started") -> None:
        """开始执行新任务，启动心跳线程"""
        self._current_task_id = task_id
        self._current_progress = 0
        self._current_message = message
        self._status = HeartbeatStatus.alive
        self._stop_event.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            daemon=True,
            name=f"heartbeat-{task_id[:8]}",
        )
        self._heartbeat_thread.start()
        print(f"[EdgeHeartbeat] 任务 {task_id} 心跳已启动（间隔={self.heartbeat_interval}s）")

    def stop_task(self) -> None:
        """任务结束，停止心跳线程"""
        self._stop_event.set()
        if self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=5)
        self._current_task_id = ""
        print(f"[EdgeHeartbeat] 心跳已停止")

    def report_progress(self, progress: int, message: str = "") -> None:
        """
        更新执行进度（对应 Temporal Activity.RecordHeartbeat(ctx, details)）。
        边缘 MarionetteExecutor 在每个关键里程碑调用此方法。
        """
        self._current_progress = max(0, min(100, progress))
        if message:
            self._current_message = message

    def _heartbeat_loop(self) -> None:
        """后台心跳线程主循环"""
        while not self._stop_event.is_set():
            self._send_heartbeat()
            self._stop_event.wait(timeout=self.heartbeat_interval)

    def _send_heartbeat(self) -> bool:
        """
        发送单次心跳到云端。
        对应 Temporal client.RecordActivityHeartbeat()。
        Returns: 是否成功
        """
        if not self._current_task_id:
            return False
        payload = HeartbeatPayload(
            node_id=self.node_id,
            task_id=self._current_task_id,
            progress=self._current_progress,
            status=self._status,
            message=self._current_message,
            capabilities=self.capabilities,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        url = f"{self.cloud_api_url}/api/edge/heartbeat"
        try:
            req = urllib.request.Request(
                url,
                data=payload.to_json(),
                headers={
                    "Content-Type": "application/json",
                    "X-Edge-Node-Id": self.node_id,
                    "X-Api-Key": self.api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                # 云端可以通过心跳响应发送取消指令（对应 Temporal heartbeat cancellation）
                if result.get("cancel"):
                    print(f"[EdgeHeartbeat] 云端要求取消任务 {self._current_task_id}")
                    self._stop_event.set()
                return True
        except Exception as e:
            print(f"[EdgeHeartbeat] 心跳发送失败: {e}")
            return False

    # ── Long Poll 任务拉取（对应 Temporal Task Queue Poll）────────

    def poll_task(self, timeout_sec: int = POLL_TIMEOUT_SEC) -> EdgeTaskPollResult:
        """
        Long Poll 从云端拉取待执行任务（对应 Temporal PollActivityTaskQueue）。
        边缘节点主动拉取比云端 Push 更可靠（边缘挂了不丢任务）。

        流程：
          1. 边缘节点发送 POST /api/edge/poll（携带 node_id + capabilities）
          2. 云端收到后：若有待分配任务 → 立即返回；若无 → 挂起 timeout_sec 秒等待
          3. 边缘收到任务后执行，执行完毕再次 poll
          4. 任务存在 Redis List，边缘 lpop 获取（若边缘挂了，任务留在 Redis，其他节点 lpop）
        """
        start = time.time()
        url = f"{self.cloud_api_url}/api/edge/poll"
        payload = json.dumps({
            "node_id": self.node_id,
            "capabilities": self.capabilities,
            "timeout_sec": timeout_sec,
        }, ensure_ascii=False).encode("utf-8")

        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Edge-Node-Id": self.node_id,
                    "X-Api-Key": self.api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_sec + 10) as resp:
                result = json.loads(resp.read())
                latency_ms = int((time.time() - start) * 1000)
                if result.get("task"):
                    return EdgeTaskPollResult(
                        has_task=True,
                        task_bundle=result["task"],
                        poll_latency_ms=latency_ms,
                    )
                return EdgeTaskPollResult(has_task=False, poll_latency_ms=latency_ms)
        except Exception as e:
            print(f"[EdgeHeartbeat] poll 失败: {e}")
            return EdgeTaskPollResult(has_task=False)

    def report_task_result(
        self,
        task_id: str,
        status: str,
        post_id: str = "",
        post_url: str = "",
        error_message: str = "",
        duration_sec: float = 0.0,
    ) -> bool:
        """
        回传任务执行结果到云端（对应 Temporal RespondActivityTaskCompleted/Failed）。
        """
        url = f"{self.cloud_api_url}/api/edge/result"
        payload = json.dumps({
            "task_id": task_id,
            "node_id": self.node_id,
            "status": status,
            "post_id": post_id,
            "post_url": post_url,
            "error_message": error_message,
            "duration_sec": duration_sec,
            "reported_at": datetime.now(timezone.utc).isoformat(),
        }, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Edge-Node-Id": self.node_id,
                    "X-Api-Key": self.api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read())
                return result.get("ok", False)
        except Exception as e:
            print(f"[EdgeHeartbeat] 回传结果失败: {e}")
            return False

    # ── 优雅退出（对应 Temporal Worker 优雅退出）──────────────────

    @property
    def is_shutting_down(self) -> bool:
        """是否正在优雅退出（SIGTERM 已收到）"""
        return self._shutting_down

    def graceful_shutdown(self, wait_sec: int = 60) -> None:
        """
        优雅退出：停止拉取新任务 → 等待当前任务完成 → 退出。
        对应 Temporal Worker 接收 SIGTERM 后的行为。
        """
        print(f"[EdgeHeartbeat] 优雅退出，最多等待 {wait_sec}s...")
        self._shutting_down = True
        self._status = HeartbeatStatus.shutdown
        # 等待当前心跳线程结束
        deadline = time.time() + wait_sec
        while self._current_task_id and time.time() < deadline:
            time.sleep(2)
        self.stop_task()
        print(f"[EdgeHeartbeat] 优雅退出完成")

    # ── 异步上下文管理器（便于 async with 使用）──────────────────

    @asynccontextmanager
    async def running(self, task_id: str, capabilities: Optional[list[str]] = None):
        """
        async with heartbeat.running(task_id) as hb:
            # 执行任务
            hb.report_progress(50, "下载完成")
        """
        if capabilities:
            self.capabilities = capabilities
        self.start_task(task_id)
        try:
            yield self
        finally:
            self.stop_task()


# ─────────────────────────────────────────────────────────────────
# HeartbeatMonitor — 云端心跳超时检测（在云端运行）
# ─────────────────────────────────────────────────────────────────

class HeartbeatMonitor:
    """
    云端心跳超时检测器（对应 Temporal 内部的 Heartbeat Timeout 检测）。
    由 dragon-senate-saas-v2 的 scheduler 或 bridge_protocol 调用。

    功能：
    - 存储边缘节点上报的心跳记录（写入 SQLite）
    - 定期扫描：超过 HEARTBEAT_TIMEOUT_SEC 未心跳的任务标记为 stalled
    - stalled 任务由 dispatcher 龙虾重新分配给其他在线边缘节点
    """

    def __init__(self, db_path: str = "./data/edge_heartbeat.sqlite") -> None:
        from pathlib import Path
        import sqlite3
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self):
        import sqlite3
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS edge_heartbeats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    progress INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'alive',
                    message TEXT DEFAULT '',
                    capabilities TEXT DEFAULT '[]',
                    timestamp TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_hb_task ON edge_heartbeats(task_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_hb_node ON edge_heartbeats(node_id, timestamp);

                CREATE TABLE IF NOT EXISTS edge_task_assignments (
                    task_id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL,
                    assigned_at TEXT NOT NULL,
                    last_heartbeat_at TEXT,
                    status TEXT DEFAULT 'running',
                    stall_count INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_assign_status ON edge_task_assignments(status);
            """)
            conn.commit()
        finally:
            conn.close()

    def record_heartbeat(self, payload: "HeartbeatPayload") -> None:
        """记录边缘节点心跳（由 /api/edge/heartbeat 路由调用）"""
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO edge_heartbeats
                   (node_id, task_id, progress, status, message, capabilities, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    payload.node_id, payload.task_id, payload.progress,
                    payload.status.value, payload.message,
                    json.dumps(payload.capabilities), payload.timestamp,
                )
            )
            conn.execute(
                """INSERT INTO edge_task_assignments (task_id, node_id, assigned_at, last_heartbeat_at, status)
                   VALUES (?, ?, ?, ?, 'running')
                   ON CONFLICT(task_id) DO UPDATE SET
                     last_heartbeat_at = excluded.last_heartbeat_at,
                     node_id = excluded.node_id""",
                (payload.task_id, payload.node_id, payload.timestamp, payload.timestamp)
            )
            conn.commit()
        finally:
            conn.close()

    def get_stalled_tasks(self, timeout_sec: int = HEARTBEAT_TIMEOUT_SEC) -> list[dict]:
        """
        获取心跳超时的任务列表（stalled）。
        dispatcher 龙虾据此将任务重新分配给其他在线边缘节点。
        """
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=timeout_sec)).isoformat()
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT * FROM edge_task_assignments
                   WHERE status = 'running'
                   AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)""",
                (cutoff,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def mark_stalled(self, task_id: str) -> None:
        """标记任务为 stalled（心跳超时）"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE edge_task_assignments SET status='stalled', stall_count=stall_count+1 WHERE task_id=?",
                (task_id,)
            )
            conn.commit()
        finally:
            conn.close()

    def mark_completed(self, task_id: str, status: str = "completed") -> None:
        """标记任务为已完成"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE edge_task_assignments SET status=? WHERE task_id=?",
                (status, task_id)
            )
            conn.commit()
        finally:
            conn.close()

    def get_online_nodes(self, timeout_sec: int = HEARTBEAT_TIMEOUT_SEC) -> list[dict]:
        """
        获取在线的边缘节点列表（最近 timeout_sec 内有心跳）。
        dispatcher 龙虾从此列表中按能力标签选择目标节点。
        """
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=timeout_sec)).isoformat()
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT node_id, MAX(timestamp) as last_seen, capabilities,
                          MAX(progress) as last_progress
                   FROM edge_heartbeats
                   WHERE timestamp >= ?
                   GROUP BY node_id
                   ORDER BY last_seen DESC""",
                (cutoff,)
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                try:
                    d["capabilities"] = json.loads(d.get("capabilities") or "[]")
                except Exception:
                    d["capabilities"] = []
                result.append(d)
            return result
        finally:
            conn.close()

    def check_and_handle_stalled(self) -> list[str]:
        """
        定期检查并处理 stalled 任务（由 cron / scheduler 每分钟调用）。
        Returns: 被标记为 stalled 的 task_id 列表
        """
        stalled = self.get_stalled_tasks()
        stalled_ids = []
        for task in stalled:
            self.mark_stalled(task["task_id"])
            stalled_ids.append(task["task_id"])
            print(f"[HeartbeatMonitor] 任务 {task['task_id']} 心跳超时，节点 {task['node_id']} 可能离线")
        return stalled_ids


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_monitor: HeartbeatMonitor | None = None


def get_heartbeat_monitor() -> HeartbeatMonitor:
    global _monitor
    if _monitor is None:
        _monitor = HeartbeatMonitor()
    return _monitor
