# CODEX TASK: 边缘离线元数据缓存（MetaManager 模式）

**优先级：P1**  
**来源：KUBEEDGE_BORROWING_ANALYSIS.md P1-#1（KubeEdge MetaManager）**

---

## 背景

边缘节点在网络抖动期间（30秒~5分钟）当前完全停工：任务无法执行、配置无法读取。借鉴 KubeEdge MetaManager，边缘端本地 SQLite 缓存关键元数据，断网期间继续执行已有任务，重连后自动同步差量更新。

---

## 一、本地缓存数据模型

```python
# edge-runtime/edge_meta_cache.py

import sqlite3
import json
import time
import os
from dataclasses import dataclass, field, asdict
from typing import Optional, List
from pathlib import Path

CACHE_DB_PATH = Path(os.environ.get("EDGE_CACHE_DIR", "/var/edge/cache")) / "meta_cache.db"

@dataclass
class CachedLobsterConfig:
    """本地缓存的龙虾配置"""
    lobster_id: str
    config_version: str          # 版本号（用于与云端比较）
    config_json: str             # 完整配置 JSON
    synced_at: float             # 最后同步时间戳
    is_valid: bool = True        # 是否有效（云端标记废弃时置 False）

@dataclass  
class CachedPendingTask:
    """本地缓存的待执行任务"""
    task_id: str
    workflow_id: str
    step_id: str
    lobster_id: str
    skill_name: str
    input_data_json: str
    priority: int = 5
    received_at: float = field(default_factory=time.time)
    status: str = "pending"      # "pending" | "running" | "completed" | "failed"
    result_json: Optional[str] = None
    completed_at: Optional[float] = None

@dataclass
class CachedSkillRegistry:
    """本地缓存的技能注册表"""
    lobster_id: str
    registry_version: str
    skills_json: str             # skill 列表 JSON
    synced_at: float

class EdgeMetaCache:
    """边缘端元数据本地缓存（SQLite）"""

    def __init__(self, db_path: Path = CACHE_DB_PATH):
        CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS lobster_configs (
                    lobster_id TEXT PRIMARY KEY,
                    config_version TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    synced_at REAL NOT NULL,
                    is_valid INTEGER DEFAULT 1
                );
                
                CREATE TABLE IF NOT EXISTS pending_tasks (
                    task_id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    skill_name TEXT NOT NULL,
                    input_data_json TEXT NOT NULL,
                    priority INTEGER DEFAULT 5,
                    received_at REAL NOT NULL,
                    status TEXT DEFAULT 'pending',
                    result_json TEXT,
                    completed_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON pending_tasks(status, priority);
                
                CREATE TABLE IF NOT EXISTS skill_registry (
                    lobster_id TEXT PRIMARY KEY,
                    registry_version TEXT NOT NULL,
                    skills_json TEXT NOT NULL,
                    synced_at REAL NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS sync_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
            """)

    # ── 龙虾配置 CRUD ────────────────────────────────────────

    def save_lobster_config(self, cfg: CachedLobsterConfig):
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO lobster_configs
                VALUES (:lobster_id, :config_version, :config_json, :synced_at, :is_valid)
            """, asdict(cfg))

    def get_lobster_config(self, lobster_id: str) -> Optional[CachedLobsterConfig]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM lobster_configs WHERE lobster_id=? AND is_valid=1",
                (lobster_id,)
            ).fetchone()
            if row:
                return CachedLobsterConfig(**dict(row))
        return None

    def get_all_config_versions(self) -> dict[str, str]:
        """返回 {lobster_id: config_version}，用于与云端比较"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT lobster_id, config_version FROM lobster_configs WHERE is_valid=1"
            ).fetchall()
            return {r["lobster_id"]: r["config_version"] for r in rows}

    # ── 待执行任务 CRUD ──────────────────────────────────────

    def enqueue_task(self, task: CachedPendingTask):
        with self._conn() as conn:
            conn.execute("""
                INSERT OR IGNORE INTO pending_tasks
                VALUES (:task_id,:workflow_id,:step_id,:lobster_id,:skill_name,
                        :input_data_json,:priority,:received_at,:status,:result_json,:completed_at)
            """, asdict(task))

    def get_next_pending_task(self) -> Optional[CachedPendingTask]:
        """取优先级最高的待执行任务（FIFO within same priority）"""
        with self._conn() as conn:
            row = conn.execute("""
                SELECT * FROM pending_tasks
                WHERE status='pending'
                ORDER BY priority DESC, received_at ASC
                LIMIT 1
            """).fetchone()
            if row:
                return CachedPendingTask(**dict(row))
        return None

    def mark_task_running(self, task_id: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE pending_tasks SET status='running' WHERE task_id=?", (task_id,)
            )

    def mark_task_completed(self, task_id: str, result: dict):
        with self._conn() as conn:
            conn.execute("""
                UPDATE pending_tasks SET status='completed',
                result_json=?, completed_at=? WHERE task_id=?
            """, (json.dumps(result), time.time(), task_id))

    def mark_task_failed(self, task_id: str, error: str):
        with self._conn() as conn:
            conn.execute("""
                UPDATE pending_tasks SET status='failed',
                result_json=?, completed_at=? WHERE task_id=?
            """, (json.dumps({"error": error}), time.time(), task_id))

    def get_completed_tasks_for_sync(self) -> List[CachedPendingTask]:
        """获取已完成但未上报的任务（重连后批量上报）"""
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT * FROM pending_tasks
                WHERE status IN ('completed', 'failed')
                ORDER BY completed_at ASC
            """).fetchall()
            return [CachedPendingTask(**dict(r)) for r in rows]

    def delete_synced_tasks(self, task_ids: List[str]):
        """上报成功后删除本地记录"""
        with self._conn() as conn:
            placeholders = ",".join("?" * len(task_ids))
            conn.execute(
                f"DELETE FROM pending_tasks WHERE task_id IN ({placeholders})", task_ids
            )

    # ── 技能注册表 ───────────────────────────────────────────

    def save_skill_registry(self, reg: CachedSkillRegistry):
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO skill_registry
                VALUES (:lobster_id,:registry_version,:skills_json,:synced_at)
            """, asdict(reg))

    def get_skill_registry(self, lobster_id: str) -> Optional[CachedSkillRegistry]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM skill_registry WHERE lobster_id=?", (lobster_id,)
            ).fetchone()
            if row:
                return CachedSkillRegistry(**dict(row))
        return None

    # ── 同步元数据 ───────────────────────────────────────────

    def set_sync_meta(self, key: str, value: str):
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO sync_metadata VALUES (?,?,?)
            """, (key, value, time.time()))

    def get_sync_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM sync_metadata WHERE key=?", (key,)
            ).fetchone()
            return row["value"] if row else None

# 全局单例
_cache: Optional[EdgeMetaCache] = None

def get_edge_cache() -> EdgeMetaCache:
    global _cache
    if _cache is None:
        _cache = EdgeMetaCache()
    return _cache
```

---

## 二、集成到边缘运行时（offline-first 逻辑）

```python
# edge-runtime/wss_receiver.py — 云端消息处理（在线时更新缓存）

from .edge_meta_cache import get_edge_cache, CachedLobsterConfig, CachedPendingTask, CachedSkillRegistry
import json, time

cache = get_edge_cache()

class WSSReceiver:

    async def on_config_update(self, msg: dict):
        """收到云端配置推送 → 更新本地缓存"""
        cache.save_lobster_config(CachedLobsterConfig(
            lobster_id=msg["lobster_id"],
            config_version=msg["version"],
            config_json=json.dumps(msg["config"]),
            synced_at=time.time(),
        ))
        logger.info(f"[MetaCache] 配置已缓存: {msg['lobster_id']} v{msg['version']}")

    async def on_task_assigned(self, msg: dict):
        """收到云端任务下发 → 先入本地队列"""
        task = CachedPendingTask(
            task_id=msg["task_id"],
            workflow_id=msg["workflow_id"],
            step_id=msg["step_id"],
            lobster_id=msg["lobster_id"],
            skill_name=msg["skill_name"],
            input_data_json=json.dumps(msg["input"]),
            priority=msg.get("priority", 5),
            received_at=time.time(),
        )
        cache.enqueue_task(task)
        logger.info(f"[MetaCache] 任务已入本地队列: {msg['task_id']}")

    async def on_skill_registry_update(self, msg: dict):
        """收到技能注册表更新 → 缓存本地"""
        cache.save_skill_registry(CachedSkillRegistry(
            lobster_id=msg["lobster_id"],
            registry_version=msg["version"],
            skills_json=json.dumps(msg["skills"]),
            synced_at=time.time(),
        ))


# edge-runtime/marionette_executor.py — 任务执行（离线也能工作）

class MarionetteExecutor:

    def get_lobster_config(self, lobster_id: str) -> dict:
        """优先从本地缓存读取（离线状态也能工作）"""
        cfg = cache.get_lobster_config(lobster_id)
        if cfg:
            return json.loads(cfg.config_json)
        raise RuntimeError(f"本地无 {lobster_id} 配置缓存，请联网后重试")

    async def execute_pending_tasks_loop(self):
        """持续从本地队列取任务执行（不依赖云端连接）"""
        while True:
            task = cache.get_next_pending_task()
            if task:
                cache.mark_task_running(task.task_id)
                try:
                    config = self.get_lobster_config(task.lobster_id)
                    result = await self._execute_skill(
                        lobster_id=task.lobster_id,
                        skill_name=task.skill_name,
                        input_data=json.loads(task.input_data_json),
                        config=config,
                    )
                    cache.mark_task_completed(task.task_id, result)
                    logger.info(f"[Executor] 任务完成（本地）: {task.task_id}")
                except Exception as e:
                    cache.mark_task_failed(task.task_id, str(e))
                    logger.error(f"[Executor] 任务失败: {task.task_id} — {e}")
            else:
                await asyncio.sleep(1)  # 无任务时等待1秒
```

---

## 三、重连后同步（上报结果 + 拉取差量）

```python
# edge-runtime/edge_sync_manager.py — 重连后自动同步

class EdgeSyncManager:

    def __init__(self, wss_client, cache: EdgeMetaCache):
        self.wss = wss_client
        self.cache = cache

    async def on_reconnected(self):
        """重连后执行同步流程"""
        logger.info("[SyncManager] 重连成功，开始同步...")
        
        # Step 1: 上报已完成的离线任务结果
        await self._upload_completed_tasks()
        
        # Step 2: 拉取配置差量（云端版本 vs 本地版本）
        await self._pull_config_delta()
        
        logger.info("[SyncManager] 同步完成")

    async def _upload_completed_tasks(self):
        """批量上报离线期间完成的任务"""
        tasks = self.cache.get_completed_tasks_for_sync()
        if not tasks:
            return
        
        batch = [
            {
                "task_id": t.task_id,
                "workflow_id": t.workflow_id,
                "status": t.status,
                "result": json.loads(t.result_json or "{}"),
                "completed_at": t.completed_at,
            }
            for t in tasks
        ]
        
        response = await self.wss.send_and_wait({
            "type": "batch_task_result_upload",
            "results": batch,
        })
        
        if response.get("accepted"):
            synced_ids = [t.task_id for t in tasks]
            self.cache.delete_synced_tasks(synced_ids)
            logger.info(f"[SyncManager] 上报 {len(synced_ids)} 个离线任务结果")

    async def _pull_config_delta(self):
        """拉取配置差量（只更新有变化的）"""
        local_versions = self.cache.get_all_config_versions()
        
        response = await self.wss.send_and_wait({
            "type": "config_delta_request",
            "local_versions": local_versions,
        })
        
        for update in response.get("updates", []):
            self.cache.save_lobster_config(CachedLobsterConfig(
                lobster_id=update["lobster_id"],
                config_version=update["version"],
                config_json=json.dumps(update["config"]),
                synced_at=time.time(),
            ))
            logger.info(f"[SyncManager] 配置已更新: {update['lobster_id']} → v{update['version']}")
```

---

## 四、云端 config_delta_request 处理

```python
# dragon-senate-saas-v2/api_edge_sync.py

@router.post("/edge/{edge_id}/config-delta")
async def config_delta(edge_id: str, body: ConfigDeltaRequest):
    """
    接收边缘端本地版本列表，返回需要更新的配置差量
    body.local_versions: { "lobster_id": "v2" }
    """
    cloud_configs = get_edge_lobster_configs(edge_id)  # 从云端DB读取
    updates = []
    
    for lobster_id, cloud_config in cloud_configs.items():
        local_ver = body.local_versions.get(lobster_id)
        if local_ver != cloud_config.version:
            # 版本不一致 → 下发最新配置
            updates.append({
                "lobster_id": lobster_id,
                "version": cloud_config.version,
                "config": cloud_config.to_dict(),
            })
    
    return {"updates": updates, "total": len(updates)}
```

---

## 验收标准

**本地缓存（edge-runtime/edge_meta_cache.py）：**
- [ ] SQLite 数据库初始化（3张表：lobster_configs / pending_tasks / skill_registry）
- [ ] `save_lobster_config()` / `get_lobster_config()` / `get_all_config_versions()`
- [ ] `enqueue_task()` / `get_next_pending_task()` / `mark_task_running/completed/failed()`
- [ ] `get_completed_tasks_for_sync()` / `delete_synced_tasks()`（重连后上报用）
- [ ] `save_skill_registry()` / `get_skill_registry()`
- [ ] `get_edge_cache()` 全局单例
- [ ] 数据库目录自动创建（不存在时）

**边缘运行时集成：**
- [ ] `wss_receiver.on_config_update()` 收到推送后写入本地缓存
- [ ] `wss_receiver.on_task_assigned()` 收到任务后入本地队列
- [ ] `marionette_executor.get_lobster_config()` 优先从本地缓存读取
- [ ] `marionette_executor.execute_pending_tasks_loop()` 持续消费本地队列（不依赖云连接）

**重连同步（edge-runtime/edge_sync_manager.py）：**
- [ ] `on_reconnected()` 触发：上报结果 → 拉取差量
- [ ] `_upload_completed_tasks()` 批量上报离线任务，成功后清理本地记录
- [ ] `_pull_config_delta()` 只拉取有版本差异的配置（节省带宽）
- [ ] 云端 `POST /edge/{id}/config-delta` API（版本对比返回差量）

---

*Codex Task | 来源：KUBEEDGE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
