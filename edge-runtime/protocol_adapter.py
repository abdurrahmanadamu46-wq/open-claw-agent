"""
Optional edge protocol adapters for HTTP webhook and MQTT.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any
from typing import Awaitable
from typing import Callable


logger = logging.getLogger("edge_protocol_adapter")


def make_task_event(source: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_type": "external_trigger",
        "source_protocol": source,
        "payload": payload,
        "node_id": os.environ.get("EDGE_NODE_ID", "unknown"),
    }


class HttpWebhookAdapter:
    def __init__(self, port: int = 8090, on_event: Callable[[dict[str, Any]], Awaitable[Any]] | None = None) -> None:
        self.port = port
        self.on_event = on_event
        self._runner: Any = None

    async def start(self) -> None:
        try:
            from aiohttp import web
        except Exception as exc:  # noqa: BLE001
            logger.warning("[HttpAdapter] aiohttp unavailable: %s", exc)
            return

        async def handle_webhook(request: Any) -> Any:
            try:
                body = await request.json()
            except Exception:
                body = {}
            event = make_task_event("http_webhook", body if isinstance(body, dict) else {"raw": body})
            if self.on_event is not None:
                asyncio.create_task(self.on_event(event))
            return web.json_response({"accepted": True})

        app = web.Application()
        app.router.add_post("/webhook", handle_webhook)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "0.0.0.0", self.port)
        await site.start()
        logger.info("[HttpAdapter] listening on 0.0.0.0:%s/webhook", self.port)


class MqttAdapter:
    def __init__(self, on_event: Callable[[dict[str, Any]], Awaitable[Any]] | None = None) -> None:
        self.on_event = on_event
        self.host = os.environ.get("EDGE_MQTT_HOST", "localhost")
        self.port = int(os.environ.get("EDGE_MQTT_PORT", "1883") or 1883)
        self.node_id = os.environ.get("EDGE_NODE_ID", "unknown")
        self.topic = os.environ.get("EDGE_MQTT_TOPIC", f"openclaw/edge/{self.node_id}/tasks")

    async def start(self) -> None:
        try:
            import aiomqtt  # type: ignore
        except Exception as exc:  # noqa: BLE001
            logger.warning("[MqttAdapter] aiomqtt unavailable: %s", exc)
            return
        try:
            async with aiomqtt.Client(self.host, self.port) as client:
                await client.subscribe(self.topic)
                logger.info("[MqttAdapter] subscribed topic=%s", self.topic)
                async for message in client.messages:
                    try:
                        payload = json.loads(message.payload)
                    except Exception:
                        payload = {"raw": str(message.payload)}
                    event = make_task_event("mqtt", payload if isinstance(payload, dict) else {"raw": payload})
                    if self.on_event is not None:
                        asyncio.create_task(self.on_event(event))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[MqttAdapter] connection failed: %s", exc)


class EdgeProtocolHub:
    def __init__(self, on_event: Callable[[dict[str, Any]], Awaitable[Any]]) -> None:
        self.http = HttpWebhookAdapter(on_event=on_event)
        self.mqtt = MqttAdapter(on_event=on_event)

    async def start_all(self) -> None:
        await asyncio.gather(
            self.http.start(),
            self.mqtt.start(),
            return_exceptions=True,
        )
