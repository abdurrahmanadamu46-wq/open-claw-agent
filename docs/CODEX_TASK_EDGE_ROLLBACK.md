# CODEX TASK: 边缘端 A/B 版本回滚（升级失败自动恢复上一版本）

**优先级：P1**  
**来源：MENDER_BORROWING_ANALYSIS.md P1-#2（Mender A/B Rollback）**

---

## 背景

边缘节点升级 `edge-runtime` 新版本时，若新版本启动失败（进程崩溃/健康检查超时），当前没有回滚机制，节点将处于故障状态直到人工介入。借鉴 Mender A/B 分区模式，边缘端本地保留上一个稳定版本，升级失败时自动回滚，并通过 Device Twin 将 actual state 上报云端以触发告警。

---

## 一、边缘端版本管理器

```python
# edge-runtime/edge_version_manager.py

import os
import shutil
import subprocess
import time
import json
from pathlib import Path
from typing import Optional

EDGE_VERSIONS_DIR = Path(os.environ.get("EDGE_VERSIONS_DIR", "/var/edge/versions"))
CURRENT_SYMLINK   = EDGE_VERSIONS_DIR / "current"    # → /var/edge/versions/v2.3.0/
BACKUP_SYMLINK    = EDGE_VERSIONS_DIR / "backup"     # → /var/edge/versions/v2.2.0/
STATE_FILE        = EDGE_VERSIONS_DIR / "version_state.json"

MAX_STARTUP_WAIT_SEC = 30   # 新版本启动超时（秒）
HEALTH_CHECK_RETRIES = 3    # 健康检查重试次数

class EdgeVersionManager:
    """边缘端 A/B 版本管理（current / backup 双版本回滚）"""

    def __init__(self):
        EDGE_VERSIONS_DIR.mkdir(parents=True, exist_ok=True)

    # ── 版本状态 ─────────────────────────────────────────────

    def get_current_version(self) -> Optional[str]:
        if CURRENT_SYMLINK.exists():
            return CURRENT_SYMLINK.resolve().name
        return None

    def get_backup_version(self) -> Optional[str]:
        if BACKUP_SYMLINK.exists():
            return BACKUP_SYMLINK.resolve().name
        return None

    def get_state(self) -> dict:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text())
        return {"status": "stable", "upgrade_attempt": None}

    def _save_state(self, state: dict):
        STATE_FILE.write_text(json.dumps(state, indent=2))

    # ── 安装新版本 ───────────────────────────────────────────

    def install_version(self, version: str, package_path: str) -> bool:
        """
        安装新版本到独立目录（不影响当前运行）
        package_path: 下载好的 .tar.gz 包路径
        """
        version_dir = EDGE_VERSIONS_DIR / version
        if version_dir.exists():
            logger.info(f"[VersionMgr] {version} 已安装，跳过")
            return True

        try:
            version_dir.mkdir(parents=True)
            subprocess.run(
                ["tar", "-xzf", package_path, "-C", str(version_dir)],
                check=True, capture_output=True,
            )
            logger.info(f"[VersionMgr] {version} 安装完成: {version_dir}")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"[VersionMgr] {version} 安装失败: {e.stderr}")
            shutil.rmtree(version_dir, ignore_errors=True)
            return False

    # ── A/B 切换（升级）────────────────────────────────────

    async def upgrade_to(self, new_version: str, deployment_id: str) -> bool:
        """
        升级到新版本：
        1. 保存当前为 backup
        2. 切换 current → new_version
        3. 启动新版本
        4. 健康检查
        5. 失败 → 自动回滚
        """
        current = self.get_current_version()
        logger.info(f"[VersionMgr] 升级: {current} → {new_version} (deployment={deployment_id})")

        # 记录升级开始状态
        self._save_state({
            "status": "upgrading",
            "from_version": current,
            "to_version": new_version,
            "deployment_id": deployment_id,
            "started_at": time.time(),
        })

        # Step 1: 保存当前版本为 backup
        if current and (EDGE_VERSIONS_DIR / current).exists():
            if BACKUP_SYMLINK.exists() or BACKUP_SYMLINK.is_symlink():
                BACKUP_SYMLINK.unlink()
            BACKUP_SYMLINK.symlink_to(EDGE_VERSIONS_DIR / current)
            logger.info(f"[VersionMgr] backup → {current}")

        # Step 2: 切换 current → new_version
        new_dir = EDGE_VERSIONS_DIR / new_version
        if not new_dir.exists():
            logger.error(f"[VersionMgr] {new_version} 目录不存在，请先 install_version()")
            await self._report_result(deployment_id, success=False, error="version_not_installed")
            return False

        if CURRENT_SYMLINK.exists() or CURRENT_SYMLINK.is_symlink():
            CURRENT_SYMLINK.unlink()
        CURRENT_SYMLINK.symlink_to(new_dir)
        logger.info(f"[VersionMgr] current → {new_version}")

        # Step 3: 重启边缘运行时
        restart_ok = self._restart_edge_runtime()
        if not restart_ok:
            logger.error("[VersionMgr] 新版本启动失败，执行回滚")
            await self.rollback(deployment_id, reason="startup_failed")
            return False

        # Step 4: 健康检查
        health_ok = await self._wait_for_health()
        if not health_ok:
            logger.error("[VersionMgr] 健康检查超时，执行回滚")
            await self.rollback(deployment_id, reason="health_check_timeout")
            return False

        # Step 5: 升级成功
        self._save_state({
            "status": "stable",
            "current_version": new_version,
            "backup_version": current,
            "upgraded_at": time.time(),
        })
        logger.info(f"[VersionMgr] ✅ 升级成功: {new_version}")
        await self._report_result(deployment_id, success=True)
        return True

    # ── 回滚 ─────────────────────────────────────────────────

    async def rollback(self, deployment_id: str, reason: str = "manual"):
        """回滚到 backup 版本"""
        backup = self.get_backup_version()
        if not backup:
            logger.error("[VersionMgr] 无 backup 版本，无法回滚")
            await self._report_result(deployment_id, success=False,
                                      error=f"no_backup_version: {reason}")
            return False

        logger.warning(f"[VersionMgr] 执行回滚 → {backup}，原因={reason}")

        # 切换 current → backup
        if CURRENT_SYMLINK.exists() or CURRENT_SYMLINK.is_symlink():
            CURRENT_SYMLINK.unlink()
        CURRENT_SYMLINK.symlink_to(EDGE_VERSIONS_DIR / backup)

        self._restart_edge_runtime()

        self._save_state({
            "status": "rolled_back",
            "current_version": backup,
            "rollback_reason": reason,
            "rolled_back_at": time.time(),
            "deployment_id": deployment_id,
        })

        await self._report_result(
            deployment_id, success=False,
            error=reason, rolled_back_to=backup,
        )
        return True

    # ── 启动/健康检查 ─────────────────────────────────────────

    def _restart_edge_runtime(self) -> bool:
        """重启 edge-runtime 进程"""
        try:
            # 停止当前进程
            subprocess.run(["systemctl", "stop", "edge-runtime"], timeout=10,
                           capture_output=True)
            time.sleep(2)
            # 启动新版本
            result = subprocess.run(["systemctl", "start", "edge-runtime"], timeout=15,
                                    capture_output=True)
            return result.returncode == 0
        except Exception as e:
            logger.error(f"[VersionMgr] 重启失败: {e}")
            return False

    async def _wait_for_health(self) -> bool:
        """等待新版本通过健康检查"""
        import aiohttp
        health_url = "http://localhost:8090/health"
        for attempt in range(HEALTH_CHECK_RETRIES):
            await asyncio.sleep(MAX_STARTUP_WAIT_SEC / HEALTH_CHECK_RETRIES)
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(health_url, timeout=5) as resp:
                        if resp.status == 200:
                            logger.info(f"[VersionMgr] 健康检查通过（第{attempt+1}次）")
                            return True
            except Exception:
                pass
            logger.warning(f"[VersionMgr] 健康检查未通过（{attempt+1}/{HEALTH_CHECK_RETRIES}）")
        return False

    async def _report_result(self, deployment_id: str, success: bool,
                              error: str = None, rolled_back_to: str = None):
        """向云端上报升级结果"""
        from .wss_receiver import get_wss_client
        wss = get_wss_client()
        payload = {
            "type": "upgrade_result",
            "deployment_id": deployment_id,
            "success": success,
            "current_version": self.get_current_version(),
            "ts": time.time(),
        }
        if error:
            payload["error"] = error
        if rolled_back_to:
            payload["rolled_back_to"] = rolled_back_to
        await wss.send(payload)


# 全局单例
_version_mgr: Optional[EdgeVersionManager] = None

def get_version_manager() -> EdgeVersionManager:
    global _version_mgr
    if _version_mgr is None:
        _version_mgr = EdgeVersionManager()
    return _version_mgr
```

---

## 二、集成到 wss_receiver.py

```python
# edge-runtime/wss_receiver.py — 接收 upgrade_request 消息

from .edge_version_manager import get_version_manager

class WSSReceiver:

    async def on_upgrade_request(self, msg: dict):
        """
        收到云端升级指令：
        msg = {
          "type": "upgrade_request",
          "deployment_id": "xxx",
          "target_version": "v2.3.0",
          "download_url": "https://cdn.openclaw.ai/edge-runtime-v2.3.0.tar.gz",
          "rollback_on_failure": True,
        }
        """
        version_mgr = get_version_manager()
        target_version = msg["target_version"]
        deployment_id = msg["deployment_id"]
        download_url = msg.get("download_url")

        current = version_mgr.get_current_version()
        if current == target_version:
            logger.info(f"[Upgrade] 当前已是 {target_version}，跳过")
            await version_mgr._report_result(deployment_id, success=True)
            return

        # Step 1: 下载新版本包
        if download_url:
            package_path = await self._download_package(target_version, download_url)
            if not package_path:
                await version_mgr._report_result(deployment_id, success=False,
                                                  error="download_failed")
                return
            # Step 2: 安装
            if not version_mgr.install_version(target_version, package_path):
                await version_mgr._report_result(deployment_id, success=False,
                                                  error="install_failed")
                return

        # Step 3: A/B 切换 + 健康检查（失败自动回滚）
        success = await version_mgr.upgrade_to(target_version, deployment_id)
        if not success:
            logger.warning(f"[Upgrade] {target_version} 升级失败，已自动回滚")

        # Step 4: 上报 actual state（供 Device Twin 对比）
        await self._report_actual_state()

    async def _download_package(self, version: str, url: str) -> Optional[str]:
        """下载升级包，返回本地路径"""
        import aiohttp
        dest = f"/tmp/edge-runtime-{version}.tar.gz"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return None
                    with open(dest, "wb") as f:
                        async for chunk in resp.content.iter_chunked(8192):
                            f.write(chunk)
            logger.info(f"[Upgrade] 下载完成: {dest}")
            return dest
        except Exception as e:
            logger.error(f"[Upgrade] 下载失败: {e}")
            return None
```

---

## 三、云端接收回报 + Device Twin 联动

```python
# dragon-senate-saas-v2/api_edge_deployment.py（续）

@router.post("/internal/edges/deployments/{deployment_id}/result")
async def edge_report_result(deployment_id: str, body: EdgeUpgradeResultBody):
    """
    边缘节点上报升级结果，联动：
    1. 更新 DeploymentRecord（成功/失败计数）
    2. 更新 DeviceTwin actual state（edge_version）
    """
    # 1. 更新部署记录
    await deploy_mgr.report_result(
        deployment_id=deployment_id,
        edge_id=body.edge_id,
        success=body.success,
        detail=body.dict(),
    )
    
    # 2. 更新 Device Twin actual state
    twin_mgr.update_actual_state_field(
        edge_id=body.edge_id,
        field="edge_version",
        value=body.current_version,
    )
    
    # 3. 如果回滚了 → 特殊告警
    if body.rolled_back_to:
        await event_bus.publish("system.alert.triggered", {
            "level": "warning",
            "title": f"边缘节点 {body.edge_id} 升级失败已回滚",
            "body": f"目标版本 {body.target_version} 升级失败（原因：{body.error}），"
                    f"已自动回滚至 {body.rolled_back_to}",
            "edge_id": body.edge_id,
        })
    
    return {"ok": True}
```

---

## 四、边缘端健康检查端点（新增）

```python
# edge-runtime/health.py — 提供给版本管理器的健康检查

from fastapi import FastAPI

health_app = FastAPI()

@health_app.get("/health")
async def health_check():
    """边缘运行时健康检查（版本管理器轮询）"""
    from .edge_meta_cache import get_edge_cache
    from .edge_version_manager import get_version_manager
    
    cache = get_edge_cache()
    vm = get_version_manager()
    
    return {
        "status": "ok",
        "version": vm.get_current_version(),
        "backup_version": vm.get_backup_version(),
        "pending_tasks": cache.count_pending_tasks(),
        "ts": time.time(),
    }
```

---

## 验收标准

**边缘端（edge-runtime/edge_version_manager.py）：**
- [ ] `install_version()`：解压安装包到 `/var/edge/versions/{version}/`
- [ ] `upgrade_to()`：backup ← current → new，重启，健康检查，失败回滚
- [ ] `rollback()`：current ← backup，重启，上报结果
- [ ] `_restart_edge_runtime()`：systemctl stop/start（可配置为 docker restart）
- [ ] `_wait_for_health()`：轮询 `/health` 端点，最多重试3次
- [ ] `_report_result()`：通过 WebSocket 上报升级结果（success/error/rolled_back_to）
- [ ] `version_state.json`：记录当前状态（stable/upgrading/rolled_back）
- [ ] `get_version_manager()` 全局单例

**wss_receiver.py 集成：**
- [ ] `on_upgrade_request()` 处理 `upgrade_request` 消息类型
- [ ] `_download_package()` 从 download_url 下载到 /tmp/
- [ ] 下载 → 安装 → A/B切换 全流程串联

**云端联动：**
- [ ] `edge_report_result` API：更新 DeploymentRecord + Device Twin actual state
- [ ] 回滚时触发 `system.alert.triggered` 警告事件

**边缘端健康检查：**
- [ ] `GET /health` 端点（返回 status/version/backup_version/pending_tasks）
- [ ] 端口 8090（可配置，不影响业务端口）

---

*Codex Task | 来源：MENDER_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
