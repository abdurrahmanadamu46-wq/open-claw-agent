"""
heartbeat_engine.py — Commander 心跳引擎

实现 7 步管理例会的自动化执行循环。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("heartbeat_engine")
active_logger = logging.getLogger("heartbeat_engine.active")

HEARTBEAT_INTERVAL_SEC = max(30, int(os.getenv("HEARTBEAT_INTERVAL_SEC", "300") or "300"))

class HeartbeatEngine:
    """Commander 的 7 步心跳引擎"""

    def __init__(
        self,
        lobster_registry_path: Path | str = "lobsters-registry.json",
        working_dir: Path | str = "packages/lobsters",
        interval_sec: int = HEARTBEAT_INTERVAL_SEC,
    ):
        self.registry_path = Path(lobster_registry_path)
        self.working_dir = Path(working_dir)
        self.interval_sec = max(30, int(interval_sec))
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._last_report: dict[str, Any] | None = None
        self._history: deque[dict[str, Any]] = deque(maxlen=100)
        self._periodic_last_executed: dict[str, float] = {}

    def start(self) -> None:
        """Start the heartbeat loop (call once at app startup)."""
        if self._task is None or self._task.done():
            self._running = True
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
            self._task = loop.create_task(self._heartbeat_loop())
            logger.info("HeartbeatEngine started (interval=%ds)", self.interval_sec)

    def stop(self) -> None:
        """Stop the heartbeat loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None
            logger.info("HeartbeatEngine stopped")

    async def _heartbeat_loop(self) -> None:
        while self._running:
            try:
                report = await self.run_heartbeat()
                if report["status"] != "HEARTBEAT_OK":
                    await self._notify_admin(report)
            except Exception as exc:  # noqa: BLE001
                logger.error("Heartbeat error: %s", exc, exc_info=True)
            await asyncio.sleep(self.interval_sec)

    async def run_heartbeat(self) -> dict[str, Any]:
        """Execute the 7-step management meeting."""
        report: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "HEARTBEAT_OK",
            "findings": [],
            "metrics": {},
        }

        registry = self._load_registry()
        all_working = self._load_all_working(registry)

        finite_findings = self._check_finite_tasks(registry, all_working)
        report["findings"].extend(finite_findings)

        periodic_findings = self._check_periodic_tasks(registry, all_working)
        report["findings"].extend(periodic_findings)

        project_findings = self._check_project_progress(all_working)
        report["findings"].extend(project_findings)

        capacity = self._assess_capacity(registry, all_working)
        report["metrics"]["capacity"] = capacity

        edge_findings = self._check_edge_runtime(all_working)
        report["findings"].extend(edge_findings)

        if any(f["severity"] == "error" for f in report["findings"]):
            report["status"] = "HEARTBEAT_ALERT"
        elif any(f["severity"] == "warning" for f in report["findings"]):
            report["status"] = "HEARTBEAT_WARN"

        self._last_report = report
        self._history.appendleft(report)
        return report

    def _init_registry(self) -> dict[str, Any]:
        """Initialize lobsters-registry.json from packages/lobsters/registry.json."""
        packages_registry = self.working_dir / "registry.json"
        role_ids: list[str] = []
        if packages_registry.exists():
            data = json.loads(packages_registry.read_text(encoding="utf-8"))
            for item in data.get("packages", []):
                role_id = str(item.get("roleId") or "").strip()
                if role_id:
                    role_ids.append(role_id)
        registry = {role_id: {} for role_id in role_ids}
        self.registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
        return registry

    def _load_registry(self) -> dict[str, Any]:
        if self.registry_path.exists():
            return json.loads(self.registry_path.read_text(encoding="utf-8"))
        return self._init_registry()

    def _load_all_working(self, registry: dict[str, Any]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for role_id in registry:
            working_path = self.working_dir / f"lobster-{role_id}" / "working.json"
            if working_path.exists():
                result[role_id] = json.loads(working_path.read_text(encoding="utf-8"))
            else:
                result[role_id] = {"current_task": None, "blocked_by": []}
        return result

    def _check_finite_tasks(self, registry: dict[str, Any], all_working: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        stale_threshold_sec = self.interval_sec * 2
        for role_id, working in all_working.items():
            task = working.get("current_task")
            if task is None:
                continue

            task_type = str(task.get("task_type") or "finite")
            if task_type != "finite":
                continue

            last_seen = task.get("last_seen_at") or working.get("updated_at")
            if last_seen:
                try:
                    seen_time = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
                    elapsed = (datetime.now(timezone.utc) - seen_time).total_seconds()
                    if elapsed > stale_threshold_sec:
                        findings.append(
                            {
                                "severity": "warning",
                                "lobster": role_id,
                                "message": f"任务 {task.get('task_id', '?')} 超过 {elapsed/60:.0f} 分钟未响应",
                            }
                        )
                except (ValueError, TypeError):
                    pass

            blocked = working.get("blocked_by", [])
            if blocked:
                findings.append(
                    {
                        "severity": "warning",
                        "lobster": role_id,
                        "message": f"龙虾被阻塞: {', '.join(str(x) for x in blocked)}",
                    }
                )
        return findings

    def _check_periodic_tasks(self, registry: dict[str, Any], all_working: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        now = time.monotonic()
        for role_id in registry:
            hb_path = self.working_dir / f"lobster-{role_id}" / "heartbeat.json"
            if not hb_path.exists():
                continue
            hb = json.loads(hb_path.read_text(encoding="utf-8"))
            current_task = (all_working.get(role_id) or {}).get("current_task") or {}
            current_action = str(current_task.get("action") or "")
            for periodic in hb.get("periodic", []):
                interval_minutes = max(5, int(periodic.get("interval_minutes", 60) or 60))
                interval_sec = interval_minutes * 60
                action = str(periodic.get("action") or "").strip()
                if current_action == action:
                    continue
                task_key = f"{role_id}:{action}"
                last = self._periodic_last_executed.get(task_key, 0)
                if now - last >= interval_sec:
                    findings.append(
                        {
                            "severity": "info",
                            "lobster": role_id,
                            "message": f"定时任务 {action} 到期，需触发执行",
                            "action": "trigger_periodic",
                            "task_key": task_key,
                        }
                    )
                    self._periodic_last_executed[task_key] = now
        return findings

    def _check_project_progress(self, all_working: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        pipeline = ["radar", "strategist", "inkwriter", "visualizer", "dispatcher", "echoer", "catcher", "followup", "abacus"]
        for idx, role_id in enumerate(pipeline[:-1]):
            current = all_working.get(role_id, {})
            next_role = pipeline[idx + 1]
            next_working = all_working.get(next_role, {})
            if current.get("last_completed") and not next_working.get("current_task") and not next_working.get("last_completed"):
                findings.append(
                    {
                        "severity": "info",
                        "lobster": next_role,
                        "message": f"上游 {role_id} 已完成，但 {next_role} 尚未启动",
                        "action": "trigger_downstream",
                    }
                )
        return findings

    def _assess_capacity(self, registry: dict[str, Any], all_working: dict[str, dict[str, Any]]) -> dict[str, Any]:
        total = len(registry) or 9
        busy = sum(1 for w in all_working.values() if w.get("current_task"))
        return {
            "total_lobsters": total,
            "busy": busy,
            "idle": total - busy,
            "utilization_pct": round(busy / max(total, 1) * 100, 1),
        }

    def _check_edge_runtime(self, all_working: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        try:
            from ws_connection_manager import get_active_connections

            connections = get_active_connections()
            pending_dispatch = any(
                bool((all_working.get(role_id) or {}).get("current_task"))
                for role_id in ("dispatcher", "echoer", "catcher", "followup")
            )
            if pending_dispatch and not connections:
                findings.append(
                    {
                        "severity": "warning",
                        "lobster": "dispatcher",
                        "message": "边缘执行端无活跃 WebSocket 连接",
                    }
                )
        except Exception:
            pass
        return findings

    async def _notify_admin(self, report: dict[str, Any]) -> None:
        """通过 webhook 通知管理员"""
        try:
            from lobster_webhook import send_webhook

            summary = self._format_report(report)
            await send_webhook("heartbeat_report", {"summary": summary, "report": report})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to send heartbeat notification: %s", exc)

    def _format_report(self, report: dict[str, Any]) -> str:
        errors = [f for f in report["findings"] if f["severity"] == "error"]
        warnings = [f for f in report["findings"] if f["severity"] == "warning"]
        cap = report.get("metrics", {}).get("capacity", {})

        lines = [f"📋 龙虾元老院心跳报告 ({report['timestamp'][:19]})", ""]
        if not errors and not warnings:
            lines.append("🟢 全部正常")
        if errors:
            lines.append(f"🔴 异常 ({len(errors)}):")
            for item in errors:
                lines.append(f"  - [{item['lobster']}] {item['message']}")
        if warnings:
            lines.append(f"🟡 关注 ({len(warnings)}):")
            for item in warnings:
                lines.append(f"  - [{item['lobster']}] {item['message']}")

        lines.append("")
        lines.append("📊 任务概览:")
        lines.append(f"- 进行中: {cap.get('busy', 0)}")
        lines.append(f"- 已完成: 0")
        lines.append(f"- 阻塞: {len(warnings) + len(errors)}")
        lines.append("")
        lines.append("💡 建议:")
        if errors or warnings:
            for item in errors + warnings:
                lines.append(f"- 处理 {item['lobster']}: {item['message']}")
        else:
            lines.append("- 维持当前节奏，无需人工干预")
        return "\n".join(lines)

    def latest_report(self) -> dict[str, Any] | None:
        """Return latest heartbeat report."""
        return self._last_report

    def history(self) -> list[dict[str, Any]]:
        """Return heartbeat report history."""
        return list(self._history)


_engine: HeartbeatEngine | None = None


def get_heartbeat_engine() -> HeartbeatEngine:
    """Get global HeartbeatEngine singleton."""
    global _engine
    if _engine is None:
        _engine = HeartbeatEngine()
    return _engine


ACTIVE_HEARTBEAT_INTERVAL_SEC = max(300, int(os.getenv("ACTIVE_HEARTBEAT_INTERVAL_SEC", "1800") or "1800"))
EDGE_OFFLINE_THRESHOLD_SECONDS = int(os.getenv("EDGE_OFFLINE_THRESHOLD", "300") or "300")
TASK_QUEUE_BACKLOG_LIMIT = int(os.getenv("TASK_QUEUE_BACKLOG_LIMIT", "50") or "50")
BACKUP_STALE_HOURS = float(os.getenv("BACKUP_STALE_HOURS", "25") or "25")


class ActiveHeartbeatChecker:
    """Proactive system checker inspired by IronClaw heartbeat patrols."""

    def __init__(self, tenant_id: str = "tenant_main", interval_sec: int = ACTIVE_HEARTBEAT_INTERVAL_SEC) -> None:
        self.tenant_id = tenant_id
        self.interval_sec = max(300, int(interval_sec))
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._last_report: dict[str, Any] | None = None
        self._history: deque[dict[str, Any]] = deque(maxlen=50)
        self._edge_registry_provider: callable | None = None
        self._edge_outbox_provider: callable | None = None

    def bind_runtime_providers(
        self,
        *,
        edge_registry_provider: callable | None = None,
        edge_outbox_provider: callable | None = None,
    ) -> None:
        self._edge_registry_provider = edge_registry_provider
        self._edge_outbox_provider = edge_outbox_provider

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._loop())

    def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.run_active_checks()
            except Exception as exc:  # noqa: BLE001
                active_logger.warning("[ActiveCheck] loop failed: %s", exc)
            await asyncio.sleep(self.interval_sec)

    async def run_active_checks(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        issues.extend(await self._check_edge_nodes_offline())
        issues.extend(await self._check_task_queue_backlog())
        issues.extend(await self._check_lobster_error_rates())
        issues.extend(await self._check_backup_status())
        report = {
            "tenant_id": self.tenant_id,
            "last_check_at": datetime.now(timezone.utc).isoformat(),
            "issue_count": len(issues),
            "issues": issues,
        }
        self._last_report = report
        self._history.appendleft(report)
        if issues:
            await self._send_active_alerts(issues)
        return issues

    async def _check_edge_nodes_offline(self) -> list[dict[str, Any]]:
        provider = self._edge_registry_provider
        if provider is None:
            return []
        try:
            registry = provider() or {}
        except Exception:
            return []
        now = datetime.now(timezone.utc)
        issues: list[dict[str, Any]] = []
        for row in registry.values():
            if not isinstance(row, dict):
                continue
            if str(row.get("tenant_id") or self.tenant_id) != self.tenant_id:
                continue
            raw = str(row.get("updated_at") or "").strip()
            if not raw:
                continue
            try:
                updated_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            elapsed = (now - updated_at).total_seconds()
            if elapsed > EDGE_OFFLINE_THRESHOLD_SECONDS:
                issues.append(
                    {
                        "check": "edge_offline",
                        "severity": "critical",
                        "edge_id": row.get("edge_id"),
                        "message": f"边缘节点 {row.get('edge_id')} 已离线 {int(elapsed)} 秒",
                        "action_required": "检查节点网络连接或重新注册边缘端",
                    }
                )
        return issues

    async def _check_task_queue_backlog(self) -> list[dict[str, Any]]:
        provider = self._edge_outbox_provider
        if provider is None:
            return []
        try:
            outbox = provider() or {}
        except Exception:
            return []
        backlog = sum(len(items or []) for items in outbox.values())
        if backlog <= TASK_QUEUE_BACKLOG_LIMIT:
            return []
        return [
            {
                "check": "queue_backlog",
                "severity": "warning",
                "message": f"边缘任务队列积压 {backlog} 条（阈值 {TASK_QUEUE_BACKLOG_LIMIT}）",
                "action_required": "检查 dispatcher / edge 节点执行链是否卡住",
            }
        ]

    async def _check_lobster_error_rates(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        try:
            from lobster_pool_manager import lobster_pool_overview

            payload = lobster_pool_overview(tenant_id=self.tenant_id)
            rows = list(payload.get("lobsters", []) or []) if isinstance(payload, dict) else []
        except Exception as exc:  # noqa: BLE001
            active_logger.debug("[ActiveCheck] lobster error-rate source unavailable: %s", exc)
            return issues

        for row in rows:
            if not isinstance(row, dict):
                continue
            run_count = int(row.get("run_count_24h") or row.get("run_count") or 0)
            error_count = int(row.get("error_count_24h") or row.get("error_count") or 0)
            lobster_id = str(row.get("id") or row.get("lobster_id") or row.get("role_id") or "").strip()
            if run_count >= 5 and error_count / max(run_count, 1) > 0.5:
                issues.append(
                    {
                        "check": "lobster_error_rate",
                        "severity": "warning",
                        "lobster_id": lobster_id,
                        "message": f"龙虾 {lobster_id} 近阶段错误率偏高：{error_count}/{run_count}",
                        "action_required": "检查该龙虾最近模型调用、工具执行和 prompt 变化",
                    }
                )
        return issues

    async def _check_backup_status(self) -> list[dict[str, Any]]:
        backup_root = Path(os.getenv("BACKUP_DIR", "./data/backups"))
        if not backup_root.exists():
            return [
                {
                    "check": "backup_missing",
                    "severity": "warning",
                    "message": "备份目录不存在",
                    "action_required": "检查边缘备份配置或手动执行一次备份",
                }
            ]
        archives = sorted(backup_root.glob("*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not archives:
            return [
                {
                    "check": "backup_missing_files",
                    "severity": "warning",
                    "message": "未发现任何备份归档",
                    "action_required": "检查 backup_manager 或手动触发备份",
                }
            ]
        age_hours = (time.time() - archives[0].stat().st_mtime) / 3600
        if age_hours <= BACKUP_STALE_HOURS:
            return []
        return [
            {
                "check": "backup_stale",
                "severity": "warning",
                "message": f"最近一次备份已过期 {age_hours:.1f} 小时",
                "action_required": "建议重新执行一次边缘备份",
            }
        ]

    async def _send_active_alerts(self, issues: list[dict[str, Any]]) -> None:
        try:
            from notification_center import send_notification

            lines = ["📳 主动巡检告警"]
            for issue in issues:
                lines.append(f"- [{issue.get('severity')}] {issue.get('message')}")
            await send_notification(
                tenant_id=self.tenant_id,
                message="\n".join(lines),
                level="critical" if any(item.get("severity") == "critical" for item in issues) else "warning",
                category="active_heartbeat",
            )
        except Exception as exc:  # noqa: BLE001
            active_logger.warning("[ActiveCheck] failed to send alert: %s", exc)

    def latest_report(self) -> dict[str, Any] | None:
        return self._last_report

    def history(self) -> list[dict[str, Any]]:
        return list(self._history)


_active_checkers: dict[str, ActiveHeartbeatChecker] = {}


def get_active_checker(tenant_id: str = "tenant_main") -> ActiveHeartbeatChecker:
    checker = _active_checkers.get(tenant_id)
    if checker is None:
        checker = ActiveHeartbeatChecker(tenant_id)
        _active_checkers[tenant_id] = checker
    return checker
