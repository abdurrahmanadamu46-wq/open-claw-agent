"""
Edge node security audit.

This is a Python adaptation of the nightly security audit ideas from
SlowMist's OpenClaw security practice guide, tailored to the current
edge-runtime architecture.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class AuditLevel(str, Enum):
    OK = "ok"
    WARN = "warn"
    CRIT = "crit"


@dataclass
class AuditResult:
    check_id: int
    name: str
    level: AuditLevel
    message: str
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "name": self.name,
            "level": self.level.value,
            "message": self.message,
            "detail": self.detail,
        }


@dataclass
class KnownIssue:
    check: str
    pattern: str
    reason: str


class EdgeSecurityAudit:
    """Nightly and on-demand edge security audit."""

    REPORT_DIR_NAME = "security-reports"
    KNOWN_ISSUES_FILENAME = ".security-audit-known-issues.json"
    CREDENTIAL_BASELINE_FILENAME = ".credential-baseline.sha256"
    SOP_BASELINE_FILENAME = ".sop-baseline.sha256"
    LAST_AUDIT_FILENAME = ".last_security_audit_date"
    LAST_SYNC_FILENAME = ".last_sync_timestamp"
    REPORT_RETENTION_DAYS = 30

    CREDENTIAL_FILENAMES = [
        "cookies.json",
        "session.json",
        "auth.json",
        "account_config.json",
        "credentials.json",
        "token.json",
        "access_token.json",
    ]

    DLP_PATTERNS = [
        (
            re.compile(
                r'"(?:cookie|session_id|access_token|refresh_token|auth_token)"\s*:\s*"[A-Za-z0-9+/=_%\-]{12,}"',
                re.I,
            ),
            "cookie_or_token_plaintext",
        ),
        (
            re.compile(
                r'(?:appsecret|app_secret|client_secret)\s*[=:]\s*["\']?[A-Za-z0-9_\-]{12,}["\']?',
                re.I,
            ),
            "client_secret_plaintext",
        ),
        (
            re.compile(
                r'(?:api_key|apikey|api-key)\s*[=:]\s*["\']?[A-Za-z0-9_\-]{16,}["\']?',
                re.I,
            ),
            "api_key_plaintext",
        ),
        (
            re.compile(
                r'(?:password|passwd|pwd)\s*[=:]\s*["\'][^"\']{6,}["\']',
                re.I,
            ),
            "password_plaintext",
        ),
    ]

    ALLOWED_OUTBOUND_HOSTS = {
        "www.xiaohongshu.com",
        "sns-webpic.xhscdn.com",
        "www.douyin.com",
        "creator.douyin.com",
        "www.kuaishou.com",
        "cp.kuaishou.com",
        "api.anthropic.com",
        "api.openai.com",
        "generativelanguage.googleapis.com",
        "api.deepseek.com",
        "dashscope.aliyuncs.com",
        "ark.cn-beijing.volces.com",
    }

    def __init__(
        self,
        node_id: str,
        workspace_dir: Path,
        *,
        wss_client: Any = None,
        task_queue: Any = None,
        memory_store: Any = None,
    ) -> None:
        self.node_id = str(node_id or "unknown").strip() or "unknown"
        self.workspace = Path(workspace_dir).expanduser()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.wss_client = wss_client
        self.task_queue = task_queue
        self.memory_store = memory_store
        self.results: list[AuditResult] = []
        self.known_issues: list[KnownIssue] = self._load_known_issues()
        self.report_dir = self.workspace / self.REPORT_DIR_NAME
        self.report_dir.mkdir(parents=True, exist_ok=True)

    def _load_known_issues(self) -> list[KnownIssue]:
        path = self.workspace / self.KNOWN_ISSUES_FILENAME
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            return [KnownIssue(**item) for item in data if isinstance(item, dict)]
        except Exception:
            return []

    def _save_known_issues(self, issues: list[KnownIssue]) -> None:
        path = self.workspace / self.KNOWN_ISSUES_FILENAME
        path.write_text(
            json.dumps([issue.__dict__ for issue in issues], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.known_issues = list(issues)

    def set_known_issues(self, issues: list[dict[str, Any]]) -> None:
        normalized = [KnownIssue(**item) for item in issues]
        self._save_known_issues(normalized)

    def _is_known_issue(self, check: str, text: str) -> tuple[bool, str]:
        for issue in self.known_issues:
            if issue.check == check:
                try:
                    if re.search(issue.pattern, text, re.IGNORECASE):
                        return True, issue.reason
                except re.error:
                    continue
        return False, ""

    def _add(self, check_id: int, name: str, level: AuditLevel, message: str, detail: str = "") -> None:
        result = AuditResult(check_id, name, level, message, detail)
        self.results.append(result)
        logger.info("[SecurityAudit] %s %s %s", check_id, name, message)

    def _parse_dt(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        text = str(value).strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _workspace_file(self, filename: str) -> Path:
        return self.workspace / filename

    async def check_1_node_status(self) -> None:
        try:
            if self.wss_client is None:
                self._add(1, "node_status", AuditLevel.WARN, "WSS client missing, skipped")
                return

            connected = bool(
                getattr(self.wss_client, "connected", False)
                or getattr(self.wss_client, "_connected", False)
            )
            if not connected and hasattr(self.wss_client, "is_connected"):
                fn = getattr(self.wss_client, "is_connected")
                if callable(fn):
                    connected = bool(fn())

            if not connected:
                self._add(1, "node_status", AuditLevel.CRIT, "fleet websocket disconnected")
                return

            last_heartbeat = getattr(self.wss_client, "last_heartbeat_at", None)
            if last_heartbeat is None and hasattr(self.wss_client, "stats"):
                stats = getattr(self.wss_client, "stats")
                if isinstance(stats, dict):
                    last_heartbeat = stats.get("last_heartbeat_at")
            heartbeat_dt = self._parse_dt(last_heartbeat)
            if heartbeat_dt is None:
                self._add(1, "node_status", AuditLevel.OK, "node online, heartbeat timestamp missing")
                return

            elapsed = (datetime.now(timezone.utc) - heartbeat_dt).total_seconds() / 60.0
            if elapsed > 10:
                self._add(1, "node_status", AuditLevel.CRIT, f"heartbeat timeout {elapsed:.1f} min (>10)")
            else:
                self._add(1, "node_status", AuditLevel.OK, f"node online, last heartbeat {elapsed:.1f} min ago")
        except Exception as exc:  # noqa: BLE001
            self._add(1, "node_status", AuditLevel.WARN, f"node status audit error: {exc}")

    async def check_2_process_network(self) -> None:
        try:
            import psutil  # type: ignore[import-untyped]

            suspicious: list[str] = []
            for conn in psutil.net_connections(kind="inet"):
                if getattr(conn, "status", "") != "ESTABLISHED" or not getattr(conn, "raddr", None):
                    continue
                host = getattr(conn.raddr, "ip", "")
                port = int(getattr(conn.raddr, "port", 0) or 0)
                if not host or host.startswith(("127.", "10.", "192.168.", "172.")):
                    continue

                display = f"{host}:{port}"
                known, _reason = self._is_known_issue("network", display)
                if known:
                    continue

                resolved_host = host
                if any(allowed == resolved_host for allowed in self.ALLOWED_OUTBOUND_HOSTS):
                    continue
                if port in {80, 443, 8080, 8443}:
                    suspicious.append(f"{resolved_host}:{port}")
                else:
                    suspicious.append(f"{resolved_host}:{port}")

            if suspicious:
                self._add(2, "process_network", AuditLevel.WARN, f"unexpected outbound connections: {len(suspicious)}", "\n".join(suspicious[:10]))
            else:
                self._add(2, "process_network", AuditLevel.OK, "outbound connections look normal")
        except ImportError:
            self._add(2, "process_network", AuditLevel.WARN, "psutil not installed, skipped")
        except Exception as exc:  # noqa: BLE001
            self._add(2, "process_network", AuditLevel.WARN, f"network audit error: {exc}")

    async def check_3_task_queue(self) -> None:
        try:
            pending_count = 0
            failed_count = 0
            if self.task_queue is not None:
                pending_count = int(getattr(self.task_queue, "pending_count", 0) or 0)
                failed_count = int(getattr(self.task_queue, "failed_count_24h", 0) or 0)
            elif self.memory_store is not None:
                tasks = await self.memory_store.list_scheduled_tasks(limit=500)
                pending_count = sum(1 for item in tasks if str(item.get("status") or "") == "pending")
                failed_count = sum(1 for item in tasks if str(item.get("status") or "") == "failed")
            else:
                self._add(3, "task_queue", AuditLevel.WARN, "task queue source missing, skipped")
                return

            if failed_count > 20:
                self._add(3, "task_queue", AuditLevel.CRIT, f"24h failures={failed_count} (>20)", f"pending={pending_count}")
            elif pending_count > 100:
                self._add(3, "task_queue", AuditLevel.WARN, f"pending backlog={pending_count}", f"failed_24h={failed_count}")
            else:
                self._add(3, "task_queue", AuditLevel.OK, f"queue healthy: pending={pending_count}, failed_24h={failed_count}")
        except Exception as exc:  # noqa: BLE001
            self._add(3, "task_queue", AuditLevel.WARN, f"task queue audit error: {exc}")

    def _iter_credential_files(self) -> list[Path]:
        files: list[Path] = []
        for name in self.CREDENTIAL_FILENAMES:
            path = self.workspace / name
            if path.exists():
                files.append(path)
        creds_dir = self.workspace / "credentials"
        if creds_dir.exists():
            files.extend([path for path in creds_dir.rglob("*") if path.is_file()])
        return sorted(files)

    async def check_4_credential_integrity(self) -> None:
        baseline_file = self.workspace / self.CREDENTIAL_BASELINE_FILENAME
        current: dict[str, str] = {}
        for path in self._iter_credential_files():
            rel = str(path.relative_to(self.workspace))
            current[rel] = hashlib.sha256(path.read_bytes()).hexdigest()

        if not current:
            self._add(4, "credential_integrity", AuditLevel.OK, "no credential files found")
            return

        if not baseline_file.exists():
            baseline_file.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
            self._add(4, "credential_integrity", AuditLevel.OK, f"baseline created for {len(current)} files")
            return

        try:
            baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
        except Exception:
            baseline = {}

        changed = []
        for rel, digest in current.items():
            if rel in baseline and baseline[rel] != digest:
                known, _reason = self._is_known_issue("credential_integrity", rel)
                if not known:
                    changed.append(rel)
        added = [rel for rel in current if rel not in baseline]
        removed = [rel for rel in baseline if rel not in current]

        if changed:
            self._add(
                4,
                "credential_integrity",
                AuditLevel.CRIT,
                f"credential baseline mismatch: {len(changed)}",
                f"changed={changed}\nadded={added}\nremoved={removed}",
            )
        elif added or removed:
            self._add(
                4,
                "credential_integrity",
                AuditLevel.WARN,
                "credential file set changed",
                f"added={added}\nremoved={removed}",
            )
        else:
            self._add(4, "credential_integrity", AuditLevel.OK, f"credential baseline verified ({len(current)} files)")

    def rebuild_credential_baseline(self) -> str:
        baseline_file = self.workspace / self.CREDENTIAL_BASELINE_FILENAME
        current = {
            str(path.relative_to(self.workspace)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self._iter_credential_files()
        }
        baseline_file.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(baseline_file)

    async def check_5_dlp_scan(self) -> None:
        candidates: list[Path] = []
        for pattern in ("*.log", "*.txt", "*.json", "*.jsonl"):
            candidates.extend(self.workspace.rglob(pattern))
        credential_paths = {path.resolve() for path in self._iter_credential_files()}
        candidates = [
            path
            for path in candidates
            if path.is_file()
            and self.REPORT_DIR_NAME not in path.parts
            and path.resolve() not in credential_paths
            and path.name not in {
                self.CREDENTIAL_BASELINE_FILENAME,
                self.SOP_BASELINE_FILENAME,
                self.KNOWN_ISSUES_FILENAME,
                self.LAST_AUDIT_FILENAME,
                self.LAST_SYNC_FILENAME,
            }
        ]

        hits: list[str] = []
        for path in candidates:
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            rel = str(path.relative_to(self.workspace))
            for pattern, label in self.DLP_PATTERNS:
                if pattern.search(text):
                    known, _reason = self._is_known_issue("dlp", rel)
                    if not known:
                        hits.append(f"{rel}: {label}")
                    break

        if hits:
            self._add(5, "dlp_scan", AuditLevel.CRIT, f"plaintext sensitive data found: {len(hits)}", "\n".join(hits[:12]))
        else:
            self._add(5, "dlp_scan", AuditLevel.OK, "no plaintext credential leaks detected")

    async def check_6_sop_integrity(self) -> None:
        sop_dir = self.workspace / "sop"
        baseline_file = self.workspace / self.SOP_BASELINE_FILENAME
        if not sop_dir.exists():
            self._add(6, "sop_integrity", AuditLevel.OK, "no sop directory found")
            return

        sop_files = sorted(sop_dir.rglob("*.json")) + sorted(sop_dir.rglob("*.py"))
        if not sop_files:
            self._add(6, "sop_integrity", AuditLevel.OK, "no sop files found")
            return

        hasher = hashlib.sha256()
        for path in sop_files:
            hasher.update(path.read_bytes())
        digest = hasher.hexdigest()

        if not baseline_file.exists():
            baseline_file.write_text(digest, encoding="utf-8")
            self._add(6, "sop_integrity", AuditLevel.OK, f"sop baseline created ({len(sop_files)} files)")
            return

        stored = baseline_file.read_text(encoding="utf-8").strip()
        if stored != digest:
            self._add(6, "sop_integrity", AuditLevel.WARN, "sop fingerprint changed", f"old={stored[:16]} new={digest[:16]}")
        else:
            self._add(6, "sop_integrity", AuditLevel.OK, f"sop fingerprint verified ({len(sop_files)} files)")

    def rebuild_sop_baseline(self) -> str | None:
        sop_dir = self.workspace / "sop"
        if not sop_dir.exists():
            return None
        sop_files = sorted(sop_dir.rglob("*.json")) + sorted(sop_dir.rglob("*.py"))
        hasher = hashlib.sha256()
        for path in sop_files:
            hasher.update(path.read_bytes())
        baseline_file = self.workspace / self.SOP_BASELINE_FILENAME
        baseline_file.write_text(hasher.hexdigest(), encoding="utf-8")
        return str(baseline_file)

    async def check_7_cloud_sync(self) -> None:
        marker = self.workspace / self.LAST_SYNC_FILENAME
        if not marker.exists():
            self._add(7, "cloud_sync", AuditLevel.WARN, "last sync timestamp missing")
            return
        try:
            last_sync = self._parse_dt(marker.read_text(encoding="utf-8").strip())
            if last_sync is None:
                self._add(7, "cloud_sync", AuditLevel.WARN, "last sync timestamp invalid")
                return
            elapsed = (datetime.now(timezone.utc) - last_sync).total_seconds() / 60.0
            if elapsed > 60:
                self._add(7, "cloud_sync", AuditLevel.WARN, f"last sync {elapsed:.1f} min ago (>60)")
            else:
                self._add(7, "cloud_sync", AuditLevel.OK, f"last sync {elapsed:.1f} min ago")
        except Exception as exc:  # noqa: BLE001
            self._add(7, "cloud_sync", AuditLevel.WARN, f"cloud sync audit error: {exc}")

    async def run_full_audit(self) -> dict[str, Any]:
        self.results.clear()
        await asyncio.gather(
            self.check_1_node_status(),
            self.check_2_process_network(),
            self.check_3_task_queue(),
            self.check_4_credential_integrity(),
            self.check_5_dlp_scan(),
            self.check_6_sop_integrity(),
            self.check_7_cloud_sync(),
            return_exceptions=True,
        )
        self.results.sort(key=lambda row: row.check_id)

        crit = sum(1 for row in self.results if row.level == AuditLevel.CRIT)
        warn = sum(1 for row in self.results if row.level == AuditLevel.WARN)
        ok = sum(1 for row in self.results if row.level == AuditLevel.OK)
        date_str = datetime.now().strftime("%Y-%m-%d")

        if crit > 0:
            header = f"🚨 Security Audit [{self.node_id}] {date_str} - {crit} Critical"
        elif warn > 0:
            header = f"⚠️ Security Audit [{self.node_id}] {date_str} - {warn} Warning"
        else:
            header = f"🛡️ Security Audit [{self.node_id}] {date_str} - All Clear"

        lines = [header, f"Summary: {crit} critical · {warn} warn · {ok} ok", ""]
        icon_map = {
            AuditLevel.OK: "✅",
            AuditLevel.WARN: "⚠️",
            AuditLevel.CRIT: "🚨",
        }
        for row in self.results:
            lines.append(f"{row.check_id}. {icon_map[row.level]} {row.name}: {row.message}")
            if row.detail:
                for detail in row.detail.splitlines():
                    if detail.strip():
                        lines.append(f"   {detail}")
        report = "\n".join(lines)

        report_path = self.report_dir / f"report-{date_str}.txt"
        report_path.write_text(report, encoding="utf-8")
        self._rotate_reports()
        (self.workspace / self.LAST_AUDIT_FILENAME).write_text(date_str, encoding="utf-8")
        return {
            "node_id": self.node_id,
            "report": report,
            "summary": {"crit": crit, "warn": warn, "ok": ok},
            "timestamp": _utc_now_iso(),
            "results": [row.to_dict() for row in self.results],
            "report_path": str(report_path),
        }

    def _rotate_reports(self) -> None:
        cutoff = datetime.now() - timedelta(days=self.REPORT_RETENTION_DAYS)
        for path in self.report_dir.glob("report-*.txt"):
            try:
                date_part = path.stem.replace("report-", "")
                file_date = datetime.strptime(date_part, "%Y-%m-%d")
                if file_date < cutoff:
                    path.unlink(missing_ok=True)
            except Exception:
                continue


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class DLPScanResult:
    def __init__(self) -> None:
        self.hits: list[dict[str, Any]] = []
        self.has_leakage = False

    def add_hit(self, pattern_id: str, description: str, context: str, source: str) -> None:
        self.hits.append(
            {
                "pattern_id": pattern_id,
                "description": description,
                "context": context[:120],
                "source": source,
            }
        )
        self.has_leakage = True


def scan_text(text: str, source: str = "unknown") -> DLPScanResult:
    result = DLPScanResult()
    content = str(text or "")
    for pattern, label in EdgeSecurityAudit.DLP_PATTERNS:
        for match in pattern.finditer(content):
            start = max(0, match.start() - 20)
            end = min(len(content), match.end() + 20)
            result.add_hit(label, label, content[start:end], source)
            break
    return result


def mask_sensitive_text(text: str) -> str:
    masked = str(text or "")

    def _mask(match: re.Match[str]) -> str:
        raw = match.group(0)
        if len(raw) <= 8:
            return "****"
        return raw[:3] + "****" + raw[-3:]

    for pattern, _label in EdgeSecurityAudit.DLP_PATTERNS:
        masked = pattern.sub(_mask, masked)
    return masked


class DLPLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = mask_sensitive_text(record.msg)
        return True


def install_dlp_log_filter() -> None:
    dlp_filter = DLPLogFilter()
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        handler.addFilter(dlp_filter)
    root_logger.addFilter(dlp_filter)
    logger.info("[DLP] Log filter installed")


async def report_dlp_alert(
    scan_result: DLPScanResult,
    *,
    edge_node_id: str,
    tenant_id: str = "tenant_main",
) -> None:
    if not scan_result.has_leakage:
        return
    payload = {
        "event": "dlp_credential_leak_detected",
        "edge_node_id": edge_node_id,
        "tenant_id": tenant_id,
        "hit_count": len(scan_result.hits),
        "hits": scan_result.hits,
        "detected_at": _utc_now_iso(),
    }
    logger.error("[DLP] credential leakage detected on %s: %d hits", edge_node_id, len(scan_result.hits))
    central_url = str(os.getenv("CENTRAL_API_URL", "")).strip()
    if not central_url:
        return
    try:
        import httpx

        async with httpx.AsyncClient(timeout=5.0) as client:
            headers = {}
            secret = str(os.getenv("EDGE_SHARED_SECRET", "")).strip()
            if secret:
                headers["x-edge-secret"] = secret
            await client.post(f"{central_url.rstrip('/')}/api/v1/security/dlp-alerts", json=payload, headers=headers)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[DLP] failed to report alert: %s", exc)
