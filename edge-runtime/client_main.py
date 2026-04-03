"""
🦞 龙虾边缘客户端 — 主入口

这是安装在客户设备上的极轻量客户端。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import uuid
from typing import Any, Awaitable, Callable


async def _receiver_connect(receiver: Any) -> None:
    """Compatibility wrapper for current WSSReceiver surface."""
    if hasattr(receiver, "connect") and callable(receiver.connect):
        await receiver.connect()
        return
    if hasattr(receiver, "run") and callable(receiver.run):
        await receiver.run()
        return
    raise RuntimeError("WSSReceiver has no connect/run method in current runtime")


def _receiver_send_callable(receiver: Any) -> Callable[[str], Awaitable[Any]] | None:
    """Get a best-effort send callable from current receiver implementation."""
    send_fn = getattr(receiver, "send", None)
    if callable(send_fn):
        return send_fn
    return None


async def main(server_url: str, token: str, *, tenant_id: str = "", node_id: str = "") -> None:
    """客户端主循环"""
    from context_navigator import ContextNavigator
    from content_publisher import ContentPublisher
    from edge_guardian import build_default_guardian
    from event_reporter import EventReporter
    from event_watcher import EventWatcher
    from feature_flag_proxy import init_flag_proxy
    from marionette_executor import MarionetteExecutor
    from protocol_adapter import EdgeProtocolHub
    from telemetry_buffer import EdgeTelemetryBuffer
    from wss_receiver import WSSReceiver

    print("龙虾边缘客户端启动中...")
    print(f"  服务器: {server_url}")

    from lifecycle_manager import get_lifecycle_manager
    lc = get_lifecycle_manager(resolved_node_id)

    reporter = EventReporter()
    watcher = EventWatcher(on_event=reporter.report)
    navigator = ContextNavigator()
    resolved_node_id = node_id or f"edge-{uuid.uuid4().hex[:8]}"
    node_tags = [item.strip() for item in os.getenv("EDGE_NODE_TAGS", "").split(",") if item.strip()]
    flag_proxy = init_flag_proxy(server_url, resolved_node_id, node_tags, token)
    await flag_proxy.start()
    telemetry = EdgeTelemetryBuffer(
        cloud_endpoint=server_url,
        edge_node_id=resolved_node_id,
        batch_size=int(os.getenv("EDGE_TELEMETRY_BATCH_SIZE", "50") or 50),
        flush_interval=float(os.getenv("EDGE_TELEMETRY_FLUSH_INTERVAL", "15") or 15),
        offline_db_path=os.getenv("EDGE_TELEMETRY_DB_PATH", "./tmp/edge_telemetry.sqlite"),
    )
    executor = MarionetteExecutor(
        navigator=navigator,
        edge_node_id=resolved_node_id,
        tenant_id=tenant_id or "tenant_main",
        edge_node_tags=node_tags,
        telemetry_buffer=telemetry,
    )
    publisher = ContentPublisher()
    receiver = WSSReceiver(
        gateway_url=server_url,
        node_id=resolved_node_id,
        edge_secret=token,
        tenant_id=tenant_id,
    )
    executor.set_snapshot_uploader(receiver.report_execution_snapshot)

    async def _task_handler(payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("task_id") or payload.get("taskId") or "")
        lc.mark_busy(task_id)
        try:
            packet = payload.get("packet") or payload.get("payload") or payload
            if isinstance(packet, dict):
                looks_like_publish = bool(
                    str(packet.get("platform") or "").strip()
                    and str(packet.get("title") or "").strip()
                    and (
                        str(packet.get("oss_url") or "").strip()
                        or isinstance(packet.get("media_urls"), list)
                    )
                )
                if looks_like_publish:
                    publish_task = publisher.from_payload(packet)
                    result = await publisher.execute_publish_task(publish_task)
                    lc.mark_done()
                    return result
            result = await executor.execute_packet(packet)
            lc.mark_done()
            return result
        except Exception as exc:
            lc.mark_error(str(exc), task_id=task_id)
            raise

    async def _behavior_handler(payload: dict[str, Any]) -> dict[str, Any]:
        packet = payload.get("packet") or payload.get("payload") or payload
        return await executor.execute_packet(packet)

    receiver.on_task(_task_handler)
    receiver.on_behavior_session(_behavior_handler)

    async def _protocol_event_handler(event: dict[str, Any]) -> None:
        payload = event.get("payload") if isinstance(event, dict) else {}
        packet = None
        if isinstance(payload, dict):
            maybe_packet = payload.get("packet")
            if isinstance(maybe_packet, dict):
                packet = maybe_packet
            elif isinstance(payload.get("steps"), list):
                packet = {
                    "protocol": "marionette/v1",
                    "taskId": f"ext-{uuid.uuid4().hex[:8]}",
                    "description": str(payload.get("description") or event.get("source_protocol") or "external_trigger"),
                    "tenant_id": tenant_id,
                    "lobster_id": "edge_runtime",
                    "steps": payload.get("steps"),
                }
        if isinstance(packet, dict):
            await executor.execute_packet(packet)
            return
        await executor.memory.remember(
            tenant_id=tenant_id or "tenant_main",
            lobster_id="edge_runtime",
            category="external_trigger",
            key=f"ext_{uuid.uuid4().hex[:10]}",
            value=str(payload or event),
            metadata={"source_protocol": str(event.get("source_protocol") or "external")},
        )

    protocol_hub = EdgeProtocolHub(on_event=_protocol_event_handler)

    send_callable = _receiver_send_callable(receiver)
    if send_callable is not None:
        reporter.set_wss_send(send_callable)

    guardian = build_default_guardian(
        node_id=resolved_node_id,
        cloud_url=server_url,
        receiver=receiver,
        watcher=watcher,
        telemetry=telemetry,
        protocol_hub=protocol_hub,
    )
    receiver.guardian_status_provider = guardian.status_report

    print("客户端已启动，等待云端指令...")
    lc.mark_online("startup_complete")

    try:
        await guardian.start()
    finally:
        watcher.stop()
        await guardian.stop()
        await flag_proxy.stop()
        print("客户端已停止")


async def handle_command(command: dict[str, Any], executor: Any, navigator: Any, watcher: Any) -> None:
    """处理从云端收到的指令（预留扩展入口）"""
    cmd_type = command.get("type", "")

    if cmd_type == "login":
        return
    if cmd_type == "forward_video":
        return
    if cmd_type == "monitor_start":
        platform = command.get("platform", "")
        account_id = command.get("account_id", "")
        watcher.add_watch(platform, account_id, watch_type="comments", interval=30)
        watcher.add_watch(platform, account_id, watch_type="dms", interval=30)
        return
    if cmd_type == "monitor_stop":
        platform = command.get("platform", "")
        account_id = command.get("account_id", "")
        watcher.remove_watch(platform, account_id)
        return
    if cmd_type == "reply_comment":
        return
    if cmd_type == "send_dm":
        return

    print(f"[client] 未知指令类型: {cmd_type}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="龙虾边缘客户端")
    parser.add_argument("--server", required=True, help="WSS 服务器地址")
    parser.add_argument("--token", required=True, help="设备认证 Token")
    parser.add_argument("--tenant-id", default=os.getenv("EDGE_TENANT_ID", ""), help="租户 ID")
    parser.add_argument("--node-id", default=os.getenv("EDGE_NODE_ID", ""), help="边缘节点 ID")
    args = parser.parse_args()

    asyncio.run(main(args.server, args.token, tenant_id=args.tenant_id, node_id=args.node_id))
