# CODEX TASK: 边缘主进程守护框架 + 双向认证

**优先级：P1**  
**来源：WAZUH_BORROWING_ANALYSIS.md P1-3 + P1-4**  
**借鉴自**：Wazuh `src/client-agent/`（多线程守护）+ `src/os_auth/`（证书认证）

---

## 背景

当前边缘节点 `marionette_executor.py` 是单线程启动，各模块串行运行，无子线程守护机制。  
若某个模块崩溃，整个边缘节点停止工作，只能人工重启。  
同时，边缘节点接入只靠 WSS token，无法防止伪造节点注入恶意数据。

---

## A. 边缘主进程守护框架

### `edge-runtime/edge_guardian.py`

```python
import asyncio
import threading
import logging
import time
from typing import Callable, Optional
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger("edge_guardian")


class ModuleStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    RESTARTING = "restarting"
    FAILED = "failed"


@dataclass
class EdgeModule:
    """边缘功能模块定义"""
    name: str
    run_fn: Callable            # 模块主循环函数（async）
    enabled: bool = True
    restart_on_failure: bool = True
    max_restarts: int = 5
    restart_delay: float = 3.0  # 重启等待秒数
    # 内部状态
    status: ModuleStatus = ModuleStatus.STOPPED
    restart_count: int = 0
    last_error: Optional[str] = None
    _task: Optional[asyncio.Task] = field(default=None, repr=False)


class EdgeGuardian:
    """
    边缘主进程守护框架
    借鉴 Wazuh client-agent 多线程守护模式：
    - 每个功能模块独立协程
    - 主循环监控各模块健康
    - 模块崩溃自动重启（有上限）
    - 优雅关闭（SIGTERM）
    """

    def __init__(self, node_id: str, cloud_url: str):
        self.node_id = node_id
        self.cloud_url = cloud_url
        self._modules: dict[str, EdgeModule] = {}
        self._running = False

    def register(self, module: EdgeModule):
        """注册功能模块"""
        self._modules[module.name] = module
        logger.info(f"[Guardian] 注册模块: {module.name}")

    async def start(self):
        """启动所有模块并守护"""
        self._running = True
        logger.info(f"[Guardian] 边缘节点 {self.node_id} 启动，共 {len(self._modules)} 个模块")

        # 启动所有启用的模块
        for module in self._modules.values():
            if module.enabled:
                await self._start_module(module)

        # 守护主循环
        while self._running:
            await self._health_check()
            await asyncio.sleep(5)

    async def _start_module(self, module: EdgeModule):
        """启动单个模块协程"""
        module.status = ModuleStatus.RUNNING
        module._task = asyncio.create_task(
            self._run_with_guard(module),
            name=f"module_{module.name}"
        )

    async def _run_with_guard(self, module: EdgeModule):
        """带守护的模块运行器"""
        while self._running and module.enabled:
            try:
                logger.info(f"[{module.name}] 启动")
                await module.run_fn()
                logger.warning(f"[{module.name}] 正常退出")
                break
            except asyncio.CancelledError:
                break
            except Exception as e:
                module.last_error = str(e)
                module.restart_count += 1
                logger.error(f"[{module.name}] 崩溃: {e}，重启次数: {module.restart_count}")

                if module.restart_on_failure and module.restart_count <= module.max_restarts:
                    module.status = ModuleStatus.RESTARTING
                    await asyncio.sleep(module.restart_delay)
                    logger.info(f"[{module.name}] 正在重启...")
                else:
                    module.status = ModuleStatus.FAILED
                    logger.error(f"[{module.name}] 已达最大重启次数，放弃")
                    break

    async def _health_check(self):
        """健康检查：检测 FAILED 模块并上报云端"""
        for name, module in self._modules.items():
            if module.status == ModuleStatus.FAILED:
                logger.critical(f"[Guardian] 模块 {name} 永久失败，已上报云端")
                # TODO: 通过 WSS 上报云端告警

    async def stop(self):
        """优雅关闭"""
        self._running = False
        for module in self._modules.values():
            if module._task and not module._task.done():
                module._task.cancel()
        await asyncio.gather(*[m._task for m in self._modules.values() if m._task], return_exceptions=True)
        logger.info("[Guardian] 边缘节点已关闭")

    def status_report(self) -> dict:
        """返回所有模块状态快照（上报云端用）"""
        return {
            "node_id": self.node_id,
            "modules": {
                name: {
                    "status": m.status,
                    "restart_count": m.restart_count,
                    "last_error": m.last_error,
                }
                for name, m in self._modules.items()
            }
        }


# 默认边缘守护实例构建
def build_default_guardian(node_id: str, cloud_url: str) -> EdgeGuardian:
    """
    构建标准边缘守护实例，注册所有内置模块
    """
    from edge_runtime.wss_receiver import wss_receiver_loop
    from edge_runtime.edge_heartbeat import heartbeat_loop
    from edge_runtime.marionette_executor import executor_loop
    from edge_runtime.context_navigator import context_loop

    guardian = EdgeGuardian(node_id=node_id, cloud_url=cloud_url)
    guardian.register(EdgeModule(name="wss_receiver", run_fn=wss_receiver_loop))
    guardian.register(EdgeModule(name="heartbeat", run_fn=heartbeat_loop))
    guardian.register(EdgeModule(name="marionette", run_fn=executor_loop))
    guardian.register(EdgeModule(name="context_nav", run_fn=context_loop))
    return guardian
```

---

## B. 边缘节点双向认证

### `edge-runtime/edge_auth.py`

```python
import hashlib
import hmac
import time
import uuid
import json
from typing import Optional


class EdgeAuthManager:
    """
    边缘节点双向认证管理器
    借鉴 Wazuh os_auth 的注册协议：
    1. 边缘节点首次注册：发送 node_id + 公钥 → 云端签发证书
    2. 后续连接：使用证书+时间戳签名 → 云端验证（防重放）
    """

    def __init__(self, node_id: str, secret_key: str):
        self.node_id = node_id
        self._secret = secret_key

    def generate_auth_header(self) -> dict:
        """生成带时间戳 HMAC 签名的认证头"""
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex[:8]
        payload = f"{self.node_id}:{timestamp}:{nonce}"
        signature = hmac.new(
            self._secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        return {
            "X-Node-Id": self.node_id,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        }

    @staticmethod
    def verify_auth_header(headers: dict, secret_key: str, max_age: int = 30) -> bool:
        """云端验证边缘节点认证头（防重放：时间戳在 max_age 秒内有效）"""
        node_id = headers.get("X-Node-Id")
        timestamp = headers.get("X-Timestamp")
        nonce = headers.get("X-Nonce")
        signature = headers.get("X-Signature")

        if not all([node_id, timestamp, nonce, signature]):
            return False

        # 防重放：时间戳检查
        try:
            ts = int(timestamp)
        except ValueError:
            return False
        if abs(time.time() - ts) > max_age:
            return False

        # HMAC 验证
        payload = f"{node_id}:{timestamp}:{nonce}"
        expected = hmac.new(secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


class EdgeRegistration:
    """边缘节点注册流程（首次接入）"""

    @staticmethod
    async def register(cloud_url: str, node_id: str, node_meta: dict) -> dict:
        """向云端注册边缘节点，获取密钥"""
        import urllib.request
        payload = json.dumps({
            "node_id": node_id,
            "version": node_meta.get("version", "1.0"),
            "platform": node_meta.get("platform", "unknown"),
            "capabilities": node_meta.get("capabilities", []),
        }).encode()
        req = urllib.request.Request(
            f"{cloud_url}/api/v1/edge/register",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
        return result  # {"secret_key": "xxx", "node_token": "xxx"}
```

---

## 验收标准

### 边缘守护框架
- [ ] `EdgeModule` 注册后自动启动协程
- [ ] 模块崩溃后自动重启（最多 5 次）
- [ ] 达到最大重启次数后标记 `FAILED` 并上报
- [ ] `stop()` 优雅关闭所有模块协程
- [ ] `status_report()` 返回所有模块状态快照
- [ ] 替换 `marionette_executor.py` 的 `__main__` 入口，使用 `EdgeGuardian`

### 双向认证
- [ ] `generate_auth_header()` 生成含时间戳+HMAC 的认证头
- [ ] `verify_auth_header()` 验证签名 + 防重放（30秒窗口）
- [ ] WSS 握手时强制验证认证头（云端拦截中间件）
- [ ] `EdgeRegistration.register()` 完成首次注册流程

---

*Codex Task | 来源：WAZUH_BORROWING_ANALYSIS.md P1-3+P1-4 | 2026-04-02*
