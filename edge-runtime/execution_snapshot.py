"""
execution_snapshot.py — 边缘执行快照采集
======================================

借鉴 Golutra Terminal Snapshot Audit：
- 操作前后页面状态
- 每步截图 / URL / DOM 摘要
- 本地持久化 manifest
- 可上报云端做审计 / 回放
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("execution_snapshot")


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _default_snapshot_dir() -> Path:
    path = Path.home() / ".openclaw" / "execution_snapshots"
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class StepCapture:
    step_index: int
    step_name: str
    timestamp: float
    page_url: str
    screenshot_path: str | None = None
    dom_summary: str = ""
    status: str = "ok"
    error_msg: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExecutionSnapshot:
    snapshot_id: str
    node_id: str
    tenant_id: str
    account_id: str
    platform: str
    action_type: str
    started_at: float = 0.0
    finished_at: float = 0.0
    duration_ms: int = 0
    before_url: str = ""
    after_url: str = ""
    before_screenshot: str | None = None
    after_screenshot: str | None = None
    before_dom_summary: str = ""
    after_dom_summary: str = ""
    steps: list[StepCapture] = field(default_factory=list)
    total_steps: int = 0
    status: str = "pending"
    result_summary: str = ""
    error_detail: str = ""
    task_id: str | None = None
    workflow_run_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    manifest_path: str | None = None


class SnapshotCollector:
    def __init__(
        self,
        node_id: str,
        tenant_id: str,
        account_id: str = "",
        platform: str = "",
        *,
        uploader: Callable[[dict[str, Any]], Any] | None = None,
        snapshot_dir: str | None = None,
        max_step_screenshots: int = 10,
    ) -> None:
        self.node_id = str(node_id or "").strip()
        self.tenant_id = str(tenant_id or "tenant_main").strip() or "tenant_main"
        self.account_id = str(account_id or "").strip()
        self.platform = str(platform or "").strip()
        self.uploader = uploader
        self.snapshot_dir = Path(snapshot_dir).expanduser() if snapshot_dir else _default_snapshot_dir()
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.max_step_screenshots = max(0, int(max_step_screenshots))
        self._snapshots: list[ExecutionSnapshot] = []

    def session(
        self,
        action_type: str,
        task_id: str | None = None,
        *,
        workflow_run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "SnapshotCollector._Session":
        return self._Session(
            collector=self,
            action_type=action_type,
            task_id=task_id,
            workflow_run_id=workflow_run_id,
            metadata=metadata,
        )

    def get_recent(self, limit: int = 20) -> list[ExecutionSnapshot]:
        return self._snapshots[-max(1, int(limit)) :]

    def to_report(self, snapshot: ExecutionSnapshot) -> dict[str, Any]:
        return {
            "snapshot_id": snapshot.snapshot_id,
            "node_id": snapshot.node_id,
            "tenant_id": snapshot.tenant_id,
            "account_id": snapshot.account_id,
            "platform": snapshot.platform,
            "action_type": snapshot.action_type,
            "task_id": snapshot.task_id,
            "workflow_run_id": snapshot.workflow_run_id,
            "status": snapshot.status,
            "duration_ms": snapshot.duration_ms,
            "total_steps": snapshot.total_steps,
            "started_at": _utc_iso(snapshot.started_at) if snapshot.started_at else None,
            "finished_at": _utc_iso(snapshot.finished_at) if snapshot.finished_at else None,
            "before_url": snapshot.before_url,
            "after_url": snapshot.after_url,
            "before_screenshot": snapshot.before_screenshot,
            "after_screenshot": snapshot.after_screenshot,
            "before_dom_summary": snapshot.before_dom_summary,
            "after_dom_summary": snapshot.after_dom_summary,
            "result_summary": snapshot.result_summary,
            "error_detail": snapshot.error_detail,
            "metadata": snapshot.metadata,
            "manifest_path": snapshot.manifest_path,
            "steps": [
                {
                    "index": item.step_index,
                    "name": item.step_name,
                    "timestamp": _utc_iso(item.timestamp),
                    "url": item.page_url,
                    "status": item.status,
                    "error": item.error_msg,
                    "dom_summary": item.dom_summary,
                    "screenshot": item.screenshot_path,
                    "metadata": item.metadata,
                }
                for item in snapshot.steps
            ],
            "replay": {
                "frames": [
                    frame
                    for frame in [snapshot.before_screenshot, *[item.screenshot_path for item in snapshot.steps], snapshot.after_screenshot]
                    if frame
                ],
                "timeline": [
                    {
                        "type": "before",
                        "timestamp": _utc_iso(snapshot.started_at) if snapshot.started_at else None,
                        "screenshot": snapshot.before_screenshot,
                    },
                    *[
                        {
                            "type": "step",
                            "name": item.step_name,
                            "timestamp": _utc_iso(item.timestamp),
                            "screenshot": item.screenshot_path,
                            "status": item.status,
                        }
                        for item in snapshot.steps
                    ],
                    {
                        "type": "after",
                        "timestamp": _utc_iso(snapshot.finished_at) if snapshot.finished_at else None,
                        "screenshot": snapshot.after_screenshot,
                    },
                ],
            },
        }

    def _persist_snapshot(self, snapshot: ExecutionSnapshot) -> None:
        snapshot_path = self.snapshot_dir / snapshot.snapshot_id
        snapshot_path.mkdir(parents=True, exist_ok=True)
        manifest_path = snapshot_path / "manifest.json"
        snapshot.manifest_path = str(manifest_path)
        manifest = self.to_report(snapshot)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    async def _upload(self, snapshot: ExecutionSnapshot) -> None:
        if self.uploader is None:
            return
        payload = self.to_report(snapshot)
        result = self.uploader(payload)
        if hasattr(result, "__await__"):
            await result

    class _Session:
        def __init__(
            self,
            *,
            collector: "SnapshotCollector",
            action_type: str,
            task_id: str | None,
            workflow_run_id: str | None,
            metadata: dict[str, Any] | None,
        ) -> None:
            self.collector = collector
            self.snapshot = ExecutionSnapshot(
                snapshot_id=f"snap_{uuid.uuid4().hex[:12]}",
                node_id=collector.node_id,
                tenant_id=collector.tenant_id,
                account_id=collector.account_id,
                platform=collector.platform,
                action_type=str(action_type or "unknown").strip() or "unknown",
                task_id=str(task_id or "").strip() or None,
                workflow_run_id=str(workflow_run_id or "").strip() or None,
                metadata=dict(metadata or {}),
            )
            self._step_index = 0
            self._step_screenshot_count = 0
            self._snapshot_path = collector.snapshot_dir / self.snapshot.snapshot_id
            self._snapshot_path.mkdir(parents=True, exist_ok=True)
            self._last_page: Any = None

        async def __aenter__(self) -> "SnapshotCollector._Session":
            self.snapshot.started_at = time.time()
            self.snapshot.status = "running"
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb) -> bool:
            if self._last_page is not None and not self.snapshot.after_url:
                try:
                    await self.capture_after(self._last_page)
                except Exception:
                    pass
            self.snapshot.finished_at = time.time()
            self.snapshot.duration_ms = int((self.snapshot.finished_at - self.snapshot.started_at) * 1000)
            self.snapshot.total_steps = len(self.snapshot.steps)
            if exc_type is not None:
                self.snapshot.status = "failed"
                self.snapshot.error_detail = str(exc_val or exc_type)
            elif self.snapshot.status == "running":
                self.snapshot.status = "success"
            self.collector._persist_snapshot(self.snapshot)
            self.collector._snapshots.append(self.snapshot)
            try:
                await self.collector._upload(self.snapshot)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[SnapshotCollector] upload failed: %s", exc)
            return False

        async def capture_before(self, page: Any = None) -> None:
            self._last_page = page
            if page is None:
                return
            self.snapshot.before_url = self._page_url(page)
            self.snapshot.before_dom_summary = await self._dom_summary(page)
            self.snapshot.before_screenshot = await self._capture_screenshot(page, "before")

        async def capture_after(self, page: Any = None) -> None:
            self._last_page = page
            if page is None:
                return
            self.snapshot.after_url = self._page_url(page)
            self.snapshot.after_dom_summary = await self._dom_summary(page)
            self.snapshot.after_screenshot = await self._capture_screenshot(page, "after")

        async def step(
            self,
            step_name: str,
            page: Any = None,
            *,
            status: str = "ok",
            error_msg: str = "",
            metadata: dict[str, Any] | None = None,
            capture_screenshot: bool = True,
        ) -> StepCapture:
            self._last_page = page
            self._step_index += 1
            capture = StepCapture(
                step_index=self._step_index,
                step_name=str(step_name or f"step_{self._step_index}").strip() or f"step_{self._step_index}",
                timestamp=time.time(),
                page_url=self._page_url(page),
                status=str(status or "ok"),
                error_msg=str(error_msg or ""),
                dom_summary=await self._dom_summary(page),
                metadata=dict(metadata or {}),
            )
            if capture_screenshot and page is not None and self._step_screenshot_count < self.collector.max_step_screenshots:
                capture.screenshot_path = await self._capture_screenshot(page, f"step_{self._step_index:02d}")
                if capture.screenshot_path:
                    self._step_screenshot_count += 1
            self.snapshot.steps.append(capture)
            return capture

        def mark_result(self, summary: str) -> None:
            self.snapshot.result_summary = str(summary or "").strip()

        def attach_metadata(self, **kwargs: Any) -> None:
            for key, value in kwargs.items():
                self.snapshot.metadata[str(key)] = value

        async def _capture_screenshot(self, page: Any, label: str) -> str | None:
            if page is None or not hasattr(page, "screenshot"):
                return None
            try:
                result = page.screenshot(type="png")
                if hasattr(result, "__await__"):
                    result = await result
                if not result:
                    return None
                target = self._snapshot_path / f"{label}.png"
                if isinstance(result, bytes):
                    target.write_bytes(result)
                elif isinstance(result, str):
                    target.write_text(result, encoding="utf-8")
                else:
                    return None
                return str(target)
            except Exception:
                return None

        async def _dom_summary(self, page: Any) -> str:
            if page is None or not hasattr(page, "evaluate"):
                return ""
            try:
                result = page.evaluate("() => (document?.body?.innerText || '').slice(0, 280)")
                if hasattr(result, "__await__"):
                    result = await result
                return str(result or "")[:280]
            except Exception:
                return ""

        @staticmethod
        def _page_url(page: Any) -> str:
            return str(getattr(page, "url", "") or "")
