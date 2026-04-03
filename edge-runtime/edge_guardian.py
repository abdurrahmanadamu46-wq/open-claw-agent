"""
EdgeGuardian — process-level async module guardian for edge runtime.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable

logger = logging.getLogger("edge_guardian")


class ModuleStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    RESTARTING = "restarting"
    FAILED = "failed"


@dataclass(slots=True)
class EdgeModule:
    name: str
    run_fn: Callable[[], Awaitable[None]]
    stop_fn: Callable[[], Awaitable[None] | None] | None = None
    enabled: bool = True
    restart_on_failure: bool = True
    max_restarts: int = 5
    restart_delay_sec: float = 3.0
    status: ModuleStatus = ModuleStatus.STOPPED
    restart_count: int = 0
    last_error: str | None = None
    _task: asyncio.Task[None] | None = field(default=None, repr=False)


class EdgeGuardian:
    def __init__(
        self,
        *,
        node_id: str,
        cloud_url: str,
        health_interval_sec: float = 5.0,
        on_module_failed: Callable[[str, dict[str, Any]], Awaitable[None] | None] | None = None,
    ) -> None:
        self.node_id = node_id
        self.cloud_url = cloud_url
        self.health_interval_sec = health_interval_sec
        self.on_module_failed = on_module_failed
        self._modules: dict[str, EdgeModule] = {}
        self._running = False

    def register(self, module: EdgeModule) -> None:
        self._modules[module.name] = module
        logger.info("[Guardian] module registered: %s", module.name)

    async def start(self) -> None:
        self._running = True
        for module in self._modules.values():
            if module.enabled:
                await self._start_module(module)
        try:
            while self._running:
                await self._health_check()
                await asyncio.sleep(self.health_interval_sec)
        except asyncio.CancelledError:
            self._running = False
            raise

    async def stop(self) -> None:
        self._running = False
        tasks = [module._task for module in self._modules.values() if module._task is not None]
        for task in tasks:
            if task and not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for module in self._modules.values():
            if module.stop_fn is not None:
                try:
                    maybe = module.stop_fn()
                    if asyncio.iscoroutine(maybe):
                        await maybe
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[Guardian] stop_fn failed for %s: %s", module.name, exc)
            module.status = ModuleStatus.STOPPED

    async def _start_module(self, module: EdgeModule) -> None:
        module.status = ModuleStatus.RUNNING
        module._task = asyncio.create_task(self._run_with_guard(module), name=f"edge_module:{module.name}")

    async def _run_with_guard(self, module: EdgeModule) -> None:
        while self._running and module.enabled:
            try:
                module.status = ModuleStatus.RUNNING
                module.last_error = None
                await module.run_fn()
                if self._running and module.restart_on_failure:
                    module.last_error = "module_exited_unexpectedly"
                    module.restart_count += 1
                    if module.restart_count > module.max_restarts:
                        module.status = ModuleStatus.FAILED
                        await self._notify_failed(module)
                        return
                    module.status = ModuleStatus.RESTARTING
                    await asyncio.sleep(module.restart_delay_sec)
                    continue
                module.status = ModuleStatus.STOPPED
                return
            except asyncio.CancelledError:
                module.status = ModuleStatus.STOPPED
                raise
            except Exception as exc:  # noqa: BLE001
                module.last_error = str(exc)
                module.restart_count += 1
                logger.error("[Guardian] module %s crashed: %s", module.name, exc)
                if module.restart_on_failure and module.restart_count <= module.max_restarts and self._running:
                    module.status = ModuleStatus.RESTARTING
                    await asyncio.sleep(module.restart_delay_sec)
                    continue
                module.status = ModuleStatus.FAILED
                await self._notify_failed(module)
                return

    async def _health_check(self) -> None:
        for module in self._modules.values():
            if not module.enabled:
                continue
            if module._task is None and self._running:
                await self._start_module(module)
                continue
            if module._task.done() and module.status != ModuleStatus.FAILED and self._running:
                await self._start_module(module)

    async def _notify_failed(self, module: EdgeModule) -> None:
        if self.on_module_failed is None:
            return
        payload = self.status_report()
        try:
            maybe = self.on_module_failed(module.name, payload)
            if asyncio.iscoroutine(maybe):
                await maybe
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Guardian] failure callback failed for %s: %s", module.name, exc)

    def status_report(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "cloud_url": self.cloud_url,
            "modules": {
                name: {
                    "status": module.status.value,
                    "restart_count": module.restart_count,
                    "last_error": module.last_error,
                }
                for name, module in self._modules.items()
            },
        }


def build_default_guardian(
    *,
    node_id: str,
    cloud_url: str,
    receiver: Any,
    watcher: Any,
    telemetry: Any,
    protocol_hub: Any,
) -> EdgeGuardian:
    guardian = EdgeGuardian(node_id=node_id, cloud_url=cloud_url)
    guardian.register(
        EdgeModule(
            name="wss_receiver",
            run_fn=receiver.connect,
            stop_fn=receiver.stop,
            max_restarts=10,
        )
    )
    guardian.register(
        EdgeModule(
            name="event_watcher",
            run_fn=watcher.start,
            stop_fn=watcher.stop,
            max_restarts=10,
        )
    )
    guardian.register(
        EdgeModule(
            name="telemetry_buffer",
            run_fn=telemetry.run_forever,
            restart_delay_sec=5.0,
            max_restarts=10,
        )
    )
    guardian.register(
        EdgeModule(
            name="protocol_hub",
            run_fn=protocol_hub.start_all,
            stop_fn=protocol_hub.stop_all if hasattr(protocol_hub, "stop_all") else None,
            max_restarts=10,
        )
    )
    return guardian
