# CODEX TASK: 向量记忆定期快照备份（Qdrant Snapshot → 已有备份系统）

**优先级：P2**  
**来源：QDRANT_BORROWING_ANALYSIS.md P2-#1（Qdrant Snapshot Backup）**

---

## 背景

我们的 Qdrant 向量库存储了龙虾记忆（`lobster_memory`）和企业记忆（`enterprise_memory`）等关键数据，但现有备份系统（`OPENCLAW_BACKUP`）只覆盖 Postgres/文件，未涵盖向量数据库。向量数据重建成本极高（需重新 embedding 所有历史内容），一旦丢失影响所有龙虾的"记忆"。借鉴 Qdrant Snapshot API，每日自动创建 Collection 快照并上传到备份存储，集成到已有备份调度系统。

---

## 一、Qdrant Snapshot 调用封装

```python
# dragon-senate-saas-v2/vector_snapshot_manager.py

import os
import time
import logging
import requests
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 需要备份的 Collection 列表
COLLECTIONS_TO_BACKUP = [
    "lobster_memory",
    "enterprise_memory",
    "lobster_profile",      # 如有
]


class VectorSnapshotManager:
    """
    Qdrant 向量数据库快照管理器
    
    流程：
      1. 调用 Qdrant API 创建 Collection 快照
      2. 下载快照文件到本地临时目录
      3. 上传到备份存储（本地目录 / S3 / 已有备份系统）
      4. 清理临时文件
      5. 保留最近 N 个快照版本，自动删除旧快照
    """

    def __init__(
        self,
        qdrant_url: str = None,
        backup_dir: str = None,
        keep_versions: int = 7,  # 保留最近7天快照
    ):
        self.qdrant_url = qdrant_url or os.environ.get("QDRANT_URL", "http://localhost:6333")
        self.backup_dir = Path(backup_dir or os.environ.get("VECTOR_BACKUP_DIR", "/backups/vector"))
        self.keep_versions = keep_versions
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    # ── 核心：创建 + 下载快照 ─────────────────────────────

    def snapshot_collection(self, collection_name: str) -> Optional[Path]:
        """
        为指定 Collection 创建快照并下载到本地
        返回：本地快照文件路径（失败返回 None）
        """
        try:
            # Step 1: 创建快照（Qdrant API）
            logger.info(f"[VectorBackup] 创建快照: {collection_name}")
            resp = requests.post(
                f"{self.qdrant_url}/collections/{collection_name}/snapshots",
                timeout=120,
            )
            resp.raise_for_status()
            snapshot_info = resp.json()["result"]
            snapshot_name = snapshot_info["name"]
            logger.info(f"[VectorBackup] 快照已创建: {snapshot_name}")

            # Step 2: 下载快照文件
            download_url = f"{self.qdrant_url}/collections/{collection_name}/snapshots/{snapshot_name}"
            local_path = self.backup_dir / f"{collection_name}_{snapshot_name}"

            logger.info(f"[VectorBackup] 下载快照: {local_path}")
            with requests.get(download_url, stream=True, timeout=300) as r:
                r.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)

            file_size_mb = local_path.stat().st_size / 1024 / 1024
            logger.info(f"[VectorBackup] 下载完成: {local_path} ({file_size_mb:.1f} MB)")
            return local_path

        except Exception as e:
            logger.error(f"[VectorBackup] 快照失败 {collection_name}: {e}")
            return None

    def snapshot_all(self) -> dict[str, Optional[Path]]:
        """备份所有 Collection"""
        results = {}
        for name in COLLECTIONS_TO_BACKUP:
            # 检查 Collection 是否存在
            try:
                resp = requests.get(f"{self.qdrant_url}/collections/{name}", timeout=10)
                if resp.status_code == 404:
                    logger.warning(f"[VectorBackup] Collection 不存在，跳过: {name}")
                    continue
            except Exception:
                continue
            results[name] = self.snapshot_collection(name)
        return results

    # ── 版本管理：保留最近 N 个快照 ──────────────────────

    def cleanup_old_snapshots(self, collection_name: str):
        """
        删除 Qdrant 服务端旧快照（只保留最新 N 个）
        """
        try:
            resp = requests.get(
                f"{self.qdrant_url}/collections/{collection_name}/snapshots",
                timeout=30,
            )
            resp.raise_for_status()
            snapshots = resp.json()["result"]

            # 按创建时间排序（最新在前）
            snapshots.sort(key=lambda x: x.get("creation_time", ""), reverse=True)

            # 删除超出保留数量的旧快照
            to_delete = snapshots[self.keep_versions:]
            for snap in to_delete:
                snap_name = snap["name"]
                del_resp = requests.delete(
                    f"{self.qdrant_url}/collections/{collection_name}/snapshots/{snap_name}",
                    timeout=30,
                )
                if del_resp.ok:
                    logger.info(f"[VectorBackup] 已删除旧快照: {snap_name}")

        except Exception as e:
            logger.warning(f"[VectorBackup] 清理旧快照失败 {collection_name}: {e}")

    # ── 完整备份流程 ─────────────────────────────────────

    def run_daily_backup(self) -> dict:
        """
        每日完整备份流程（由调度系统调用）
        
        返回：备份摘要 {"collection_name": {"status": "ok/failed", "path": ...}}
        """
        start_time = time.time()
        summary = {}

        for collection_name in COLLECTIONS_TO_BACKUP:
            # 1. 创建并下载快照
            path = self.snapshot_collection(collection_name)

            if path:
                # 2. 清理服务端旧快照
                self.cleanup_old_snapshots(collection_name)
                summary[collection_name] = {
                    "status": "ok",
                    "path": str(path),
                    "size_mb": round(path.stat().st_size / 1024 / 1024, 1),
                }
            else:
                summary[collection_name] = {"status": "failed"}

        elapsed = round(time.time() - start_time, 1)
        logger.info(f"[VectorBackup] 备份完成，耗时 {elapsed}s: {summary}")
        return {"elapsed_seconds": elapsed, "collections": summary}
```

---

## 二、集成到已有备份调度系统

```python
# dragon-senate-saas-v2/backup_scheduler.py（在已有备份系统中新增向量备份任务）

from .vector_snapshot_manager import VectorSnapshotManager

# 在已有的每日备份任务中新增向量备份
async def daily_backup_job():
    """已有：Postgres + 文件备份"""
    await backup_postgres()
    await backup_files()

    # ← 新增：向量数据库快照
    vector_mgr = VectorSnapshotManager()
    result = vector_mgr.run_daily_backup()

    # 上报备份结果到审计日志
    from .tenant_audit_log import log_system_event
    log_system_event(
        action="vector_backup_completed",
        detail=result,
    )
```

---

## 三、备份 API（运维界面）

```python
# dragon-senate-saas-v2/api_governance_routes.py（新增）

from .vector_snapshot_manager import VectorSnapshotManager, COLLECTIONS_TO_BACKUP

@router.post("/admin/vector-backup/trigger")
async def trigger_vector_backup(ctx=Depends(get_admin_context)):
    """手动触发向量备份（运维应急）"""
    mgr = VectorSnapshotManager()
    result = mgr.run_daily_backup()
    return result

@router.get("/admin/vector-backup/snapshots/{collection_name}")
async def list_vector_snapshots(collection_name: str, ctx=Depends(get_admin_context)):
    """列出指定 Collection 的所有快照"""
    import requests
    resp = requests.get(f"{mgr.qdrant_url}/collections/{collection_name}/snapshots")
    return {"snapshots": resp.json().get("result", [])}
```

---

## 四、Cron 调度（每日凌晨3点）

```yaml
# dragon-senate-saas-v2/cron_jobs.yaml（新增向量备份任务）
jobs:
  - name: vector_snapshot_backup
    schedule: "0 3 * * *"   # 每天凌晨3点
    command: "python -m dragon_senate_saas_v2.vector_snapshot_manager"
    timeout: 600             # 10分钟超时
    on_failure: notify_ops   # 失败通知运维
```

---

## 验收标准

**后端（dragon-senate-saas-v2/vector_snapshot_manager.py）：**
- [ ] `VectorSnapshotManager.snapshot_collection(name)`：创建快照 + 流式下载到本地
- [ ] `snapshot_all()`：遍历 `COLLECTIONS_TO_BACKUP`，跳过不存在的 Collection
- [ ] `cleanup_old_snapshots(name)`：保留最新 N 个，自动删除服务端旧快照
- [ ] `run_daily_backup()`：完整流程 + 返回摘要 JSON（状态/路径/大小）
- [ ] 环境变量配置：`QDRANT_URL` / `VECTOR_BACKUP_DIR`

**集成（backup_scheduler.py）：**
- [ ] 在已有每日备份 Job 中调用 `run_daily_backup()`
- [ ] 备份结果写入审计日志

**API（api_governance_routes.py）：**
- [ ] `POST /admin/vector-backup/trigger`：手动触发（管理员）
- [ ] `GET /admin/vector-backup/snapshots/{collection}`：列出快照版本

**调度：**
- [ ] Cron 每日凌晨3点执行
- [ ] 失败时触发运维通知

---

*Codex Task | 来源：QDRANT_BORROWING_ANALYSIS.md P2-#1 | 2026-04-02*
