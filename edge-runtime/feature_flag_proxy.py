"""
Edge feature flag proxy with local cache, websocket sync, and backup file.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


@dataclass
class EdgeFlagStrategy:
    type: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass
class EdgeFeatureFlag:
    name: str
    enabled: bool
    environment: str = "prod"
    strategies: list[EdgeFlagStrategy] = field(default_factory=list)
    variants: list[dict[str, Any]] = field(default_factory=list)
    edge_node_tags: list[str] = field(default_factory=list)
    updated_at: str = ""


@dataclass
class EdgeFlagContext:
    tenant_id: str = ""
    lobster_id: str = ""
    edge_node_id: str = ""
    edge_node_tags: list[str] = field(default_factory=list)


class FeatureFlagProxy:
    def __init__(
        self,
        cloud_api_url: str,
        edge_node_id: str,
        edge_node_tags: list[str],
        api_token: str = "",
        backup_dir: str = "config",
    ) -> None:
        self.cloud_api_url = cloud_api_url.rstrip("/")
        self.edge_node_id = edge_node_id
        self.edge_node_tags = edge_node_tags
        self.api_token = api_token
        self.backup_file = Path(backup_dir) / "feature_flags_edge_backup.json"
        self.backup_file.parent.mkdir(parents=True, exist_ok=True)
        self._flags: dict[str, EdgeFeatureFlag] = {}
        self._lock = asyncio.Lock()
        self._connected = False
        self._last_sync: datetime | None = None
        self._sync_interval = 30
        self._ws_task: asyncio.Task[Any] | None = None
        self._poll_task: asyncio.Task[Any] | None = None

    async def start(self) -> None:
        await self._load_backup()
        await self._pull_from_cloud()
        self._ws_task = asyncio.create_task(self._ws_listener(), name="edge-flag-ws")
        self._poll_task = asyncio.create_task(self._polling_loop(), name="edge-flag-poll")

    async def stop(self) -> None:
        for task in (self._ws_task, self._poll_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    def is_enabled(self, flag_name: str, ctx: EdgeFlagContext) -> bool:
        flag = self._flags.get(flag_name)
        if not flag or not flag.enabled:
            return False
        for strategy in flag.strategies:
            if self._evaluate_strategy(strategy, ctx):
                return True
        return False

    def _evaluate_strategy(self, strategy: EdgeFlagStrategy, ctx: EdgeFlagContext) -> bool:
        if strategy.type == "all":
            return True
        if strategy.type == "gradualRollout":
            rollout = int(strategy.parameters.get("rollout", 100) or 100)
            stickiness = str(strategy.parameters.get("stickiness", "tenant_id")).strip()
            if stickiness == "random":
                return random.randint(0, 99) < rollout
            base = ctx.tenant_id if stickiness == "tenant_id" else ctx.edge_node_id
            bucket = int(hashlib.md5(str(base or "").encode("utf-8")).hexdigest()[:8], 16) % 100
            return bucket < rollout
        if strategy.type == "tenantWhitelist":
            return ctx.tenant_id in strategy.parameters.get("tenant_ids", [])
        if strategy.type == "edgeNodeTag":
            return bool(set(strategy.parameters.get("tags", [])) & set(ctx.edge_node_tags))
        return False

    async def _pull_from_cloud(self) -> None:
        try:
            import aiohttp

            headers = {"Authorization": f"Bearer {self.api_token}"} if self.api_token else {}
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(
                    f"{self.cloud_api_url}/api/v1/feature-flags/edge",
                    params={"node_id": self.edge_node_id, "tags": ",".join(self.edge_node_tags)},
                    timeout=10,
                ) as resp:
                    if resp.status != 200:
                        logger.warning("edge flag sync failed: HTTP %s", resp.status)
                        return
                    data = await resp.json()
                    await self._update_flags(data.get("flags", []))
                    self._last_sync = datetime.now()
                    await self._save_backup()
        except Exception as exc:
            logger.warning("edge flag sync error: %s", exc)

    async def _ws_listener(self) -> None:
        try:
            import aiohttp
        except Exception:
            return
        ws_url = self.cloud_api_url.replace("http://", "ws://").replace("https://", "wss://") + "/api/v1/feature-flags/ws"
        while True:
            try:
                async with aiohttp.ClientSession(headers={"Authorization": f"Bearer {self.api_token}"} if self.api_token else {}) as session:
                    async with session.ws_connect(ws_url, params={"node_id": self.edge_node_id}) as ws:
                        self._connected = True
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                event = json.loads(msg.data)
                                await self._handle_ws_event(event)
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                break
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self._connected = False
                logger.warning("edge flag ws disconnected: %s", exc)
                await asyncio.sleep(10)

    async def _handle_ws_event(self, event: dict[str, Any]) -> None:
        event_type = str(event.get("type") or "").strip()
        flag_data = event.get("flag")
        if event_type in {"FLAG_CREATED", "FLAG_UPDATED"} and isinstance(flag_data, dict):
            flag = self._convert_flag(flag_data)
            async with self._lock:
                self._flags[flag.name] = flag
            await self._save_backup()
        elif event_type == "FLAG_DELETED":
            name = str(event.get("name") or "").strip()
            async with self._lock:
                self._flags.pop(name, None)
            await self._save_backup()

    async def _polling_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._sync_interval)
                if not self._connected:
                    await self._pull_from_cloud()
            except asyncio.CancelledError:
                return

    async def _save_backup(self) -> None:
        payload = {
            "saved_at": datetime.now().isoformat(),
            "edge_node_id": self.edge_node_id,
            "flags": {
                name: {
                    "name": flag.name,
                    "enabled": flag.enabled,
                    "environment": flag.environment,
                    "strategies": [{"type": item.type, "parameters": item.parameters} for item in flag.strategies],
                    "variants": list(flag.variants),
                    "edge_node_tags": list(flag.edge_node_tags),
                    "updated_at": flag.updated_at,
                }
                for name, flag in self._flags.items()
            },
        }
        self.backup_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    async def _load_backup(self) -> None:
        if not self.backup_file.exists():
            return
        try:
            data = json.loads(self.backup_file.read_text(encoding="utf-8"))
            flags = {}
            for name, raw in data.get("flags", {}).items():
                flags[name] = self._convert_flag(raw)
            async with self._lock:
                self._flags = flags
        except Exception as exc:
            logger.warning("edge flag backup load failed: %s", exc)

    async def _update_flags(self, flags_data: list[dict[str, Any]]) -> None:
        async with self._lock:
            self._flags = {str(item["name"]): self._convert_flag(item) for item in flags_data if str(item.get("name") or "").strip()}

    def _convert_flag(self, raw: dict[str, Any]) -> EdgeFeatureFlag:
        return EdgeFeatureFlag(
            name=str(raw.get("name") or ""),
            enabled=bool(raw.get("enabled", False)),
            environment=str(raw.get("environment") or "prod"),
            strategies=[EdgeFlagStrategy(type=str(item.get("type") or "all"), parameters=dict(item.get("parameters") or {})) for item in raw.get("strategies", [])],
            variants=list(raw.get("variants", [])),
            edge_node_tags=list(raw.get("edge_node_tags", [])),
            updated_at=str(raw.get("updated_at") or ""),
        )

    def get_status(self) -> dict[str, Any]:
        return {
            "connected": self._connected,
            "last_sync": self._last_sync.isoformat() if self._last_sync else None,
            "flag_count": len(self._flags),
            "edge_node_id": self.edge_node_id,
            "edge_node_tags": self.edge_node_tags,
        }


_proxy: FeatureFlagProxy | None = None


def init_flag_proxy(cloud_api_url: str, node_id: str, node_tags: list[str], token: str) -> FeatureFlagProxy:
    global _proxy
    _proxy = FeatureFlagProxy(cloud_api_url, node_id, node_tags, token)
    return _proxy


def get_flag_proxy() -> FeatureFlagProxy | None:
    return _proxy


def edge_ff_is_enabled(flag_name: str, ctx: EdgeFlagContext) -> bool:
    if _proxy is None:
        return True
    return _proxy.is_enabled(flag_name, ctx)
