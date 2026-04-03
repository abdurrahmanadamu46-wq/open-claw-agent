from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from browser_engine import BrowserEngine
from platform_adapters import ContentType, PublishResult, PublishStatus, PublishTask, XiaohongshuAdapter

logger = logging.getLogger(__name__)

HIGH_RISK_PLATFORMS = {"xiaohongshu", "douyin", "wechat", "weibo"}


class ContentPublisher:
    def __init__(
        self,
        *,
        result_reporter: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        quota_reporter: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self._result_reporter = result_reporter
        self._quota_reporter = quota_reporter
        self._profile_base_dir = Path(os.getenv("PROFILE_BASE_DIR", "./browser_profiles")).resolve()
        self._asset_dir = Path(os.getenv("EDGE_PUBLISH_ASSET_DIR", "./tmp/publish_assets")).resolve()
        self._profile_base_dir.mkdir(parents=True, exist_ok=True)
        self._asset_dir.mkdir(parents=True, exist_ok=True)

    async def execute_publish_task(self, task: PublishTask) -> dict[str, Any]:
        adapter = self._get_adapter(task.platform)
        profile_dir = task.profile_dir or str(self._profile_base_dir / task.seat_id / task.platform)
        risk_high = str(task.platform or "").strip().lower() in HIGH_RISK_PLATFORMS
        browser = BrowserEngine(
            headless=str(os.getenv("BROWSER_HEADLESS", "true")).strip().lower() in {"1", "true", "yes", "on"},
            proxy=os.getenv("BROWSER_PROXY", "").strip() or None,
        )
        local_media = await self._materialize_media(task)
        local_task = PublishTask(**{**task.__dict__, "media_urls": local_media, "profile_dir": profile_dir})
        try:
            async with browser.new_context(
                profile_dir=profile_dir,
                prefer_camoufox=risk_high,
                prefer_chromium=not risk_high,
                humanize=risk_high,
                geoip=risk_high,
                headless_mode="virtual" if risk_high else None,
            ) as page:
                if not await adapter.login_check(page):
                    result = PublishResult(task_id=task.task_id, status=PublishStatus.FAILED, error_message="login_expired")
                elif str(task.content_type) == ContentType.IMAGE_POST.value:
                    result = await adapter.publish_image_post(page, local_task)
                else:
                    result = await adapter.publish_video(page, local_task)
        except Exception as exc:  # noqa: BLE001
            result = PublishResult(task_id=task.task_id, status=PublishStatus.FAILED, error_message=str(exc))
        await self._report_result(task, result)
        if result.status == PublishStatus.PUBLISHED:
            await self._consume_quota(task)
        return result.to_dict()

    async def _materialize_media(self, task: PublishTask) -> list[str]:
        local_paths: list[str] = []
        for index, item in enumerate(task.media_urls):
            raw = str(item or "").strip()
            if not raw:
                continue
            if raw.startswith("http://") or raw.startswith("https://"):
                suffix = Path(raw.split("?", 1)[0]).suffix or ".bin"
                target = self._asset_dir / f"{task.task_id}_{index}{suffix}"
                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    response = await client.get(raw)
                    response.raise_for_status()
                    target.write_bytes(response.content)
                local_paths.append(str(target))
            else:
                local_paths.append(str(Path(raw).resolve()))
        return local_paths

    def _get_adapter(self, platform: str):
        adapters = {"xiaohongshu": XiaohongshuAdapter()}
        return adapters.get(str(platform or "").strip(), XiaohongshuAdapter())

    async def _report_result(self, task: PublishTask, result: PublishResult) -> None:
        if self._result_reporter is None:
            return
        await self._result_reporter(
            {
                "task_id": task.task_id,
                "seat_id": task.seat_id,
                "tenant_id": task.tenant_id,
                **result.to_dict(),
            }
        )

    async def _consume_quota(self, task: PublishTask) -> None:
        if self._quota_reporter is None:
            return
        resource = "image" if str(task.content_type) == ContentType.IMAGE_POST.value else "video"
        await self._quota_reporter(
            {
                "seat_id": task.seat_id,
                "tenant_id": task.tenant_id,
                "resource": resource,
                "amount": 1,
                "task_id": task.task_id,
            }
        )

    @staticmethod
    def from_payload(payload: dict[str, Any]) -> PublishTask:
        packet = payload.get("packet") or payload.get("payload") or payload
        media_urls = packet.get("media_urls")
        if not isinstance(media_urls, list):
            media_urls = [str(packet.get("oss_url") or "").strip()] if str(packet.get("oss_url") or "").strip() else []
        return PublishTask(
            task_id=str(packet.get("task_id") or packet.get("taskId") or "").strip() or f"publish_{id(packet)}",
            seat_id=str(packet.get("seat_id") or packet.get("account_id") or packet.get("accountId") or "seat_default").strip(),
            tenant_id=str(packet.get("tenant_id") or packet.get("tenantId") or "tenant_main").strip() or "tenant_main",
            platform=str(packet.get("platform") or "xiaohongshu").strip() or "xiaohongshu",
            content_type=str(packet.get("content_type") or packet.get("contentType") or "video").strip() or "video",
            title=str(packet.get("title") or "").strip(),
            caption=str(packet.get("caption") or packet.get("description") or "").strip(),
            tags=[str(tag).strip().lstrip("#") for tag in (packet.get("tags") or []) if str(tag).strip()],
            media_urls=media_urls,
            cover_url=str(packet.get("cover_url") or packet.get("coverUrl") or "").strip() or None,
            scheduled_at=str(packet.get("scheduled_at") or packet.get("scheduledAt") or packet.get("publish_time") or packet.get("publishTime") or "").strip() or None,
            metadata=dict(packet.get("meta") or {}),
        )
