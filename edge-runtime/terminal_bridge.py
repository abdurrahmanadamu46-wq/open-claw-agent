"""
Edge terminal bridge for safe node debugging.

This module intentionally exposes only a small command whitelist and
log-following capability. It is executor-side only and must never make
business decisions or execute arbitrary shell input.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import sys
from pathlib import Path
from typing import AsyncGenerator


class TerminalBridge:
    """Safe terminal bridge with log streaming and command whitelist."""

    SAFE_COMMANDS = {"status", "ps", "disk", "mem", "tasks", "log"}

    def __init__(self, log_file: str = "~/.openclaw/edge.log") -> None:
        self.log_file = os.path.expanduser(log_file)
        self._stop_events: dict[str, asyncio.Event] = {}

    async def execute_safe_command(self, command: str) -> str:
        normalized = str(command or "").strip().lower()
        if normalized not in self.SAFE_COMMANDS:
            return (
                f"[ERROR] 命令 '{normalized}' 不在白名单中\n"
                f"可用命令: {', '.join(sorted(self.SAFE_COMMANDS))}\n"
            )

        if normalized == "status":
            return self._command_status()
        if normalized == "disk":
            return self._command_disk()
        if normalized == "mem":
            return self._command_memory()
        if normalized == "tasks":
            return self._command_tasks()
        if normalized == "ps":
            return await self._command_processes()
        if normalized == "log":
            log_path = self._resolve_log_file()
            if not log_path:
                return f"[INFO] 日志文件不存在: {self.log_file}\n"
            return self._read_last_lines(log_path, 60)
        return "[ERROR] unsupported command\n"

    async def stream_logs(self, session_id: str, lines: int = 60) -> AsyncGenerator[str, None]:
        """Stream log updates for a session until stop_session is called."""
        stop_event = asyncio.Event()
        self._stop_events[session_id] = stop_event
        log_path = self._resolve_log_file()
        if not log_path:
            yield f"[INFO] 日志文件不存在: {self.log_file}\n"
            self._stop_events.pop(session_id, None)
            return

        initial = self._read_last_lines(log_path, lines)
        if initial:
            yield initial
        yield "[INFO] 已进入实时日志跟随模式\n"

        current_position = log_path.stat().st_size
        try:
            while not stop_event.is_set():
                if not log_path.exists():
                    yield f"[WARN] 日志文件已消失: {log_path}\n"
                    break
                file_size = log_path.stat().st_size
                if file_size < current_position:
                    current_position = 0
                if file_size > current_position:
                    with log_path.open("r", encoding="utf-8", errors="replace") as handle:
                        handle.seek(current_position)
                        chunk = handle.read()
                        current_position = handle.tell()
                    if chunk:
                        yield chunk
                await asyncio.sleep(0.5)
        finally:
            self._stop_events.pop(session_id, None)

    async def stop_session(self, session_id: str) -> None:
        stop_event = self._stop_events.get(session_id)
        if stop_event:
            stop_event.set()

    def _resolve_log_file(self) -> Path | None:
        candidates = [
            Path(self.log_file),
            Path.cwd() / "edge.log",
            Path.cwd() / "logs" / "edge.log",
            Path.home() / ".openclaw" / "edge.log",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return None

    def _read_last_lines(self, path: Path, lines: int) -> str:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            data = handle.readlines()
        return "".join(data[-max(1, lines):])

    def _command_status(self) -> str:
        return (
            "[STATUS]\n"
            f"platform={platform.platform()}\n"
            f"python={sys.version.splitlines()[0]}\n"
            f"cwd={Path.cwd()}\n"
        )

    def _command_disk(self) -> str:
        usage = shutil.disk_usage(Path.cwd())
        return (
            "[DISK]\n"
            f"total={self._format_bytes(usage.total)}\n"
            f"used={self._format_bytes(usage.used)}\n"
            f"free={self._format_bytes(usage.free)}\n"
        )

    def _command_memory(self) -> str:
        try:
            import psutil  # type: ignore[import-untyped]

            vm = psutil.virtual_memory()
            return (
                "[MEMORY]\n"
                f"total={self._format_bytes(int(vm.total))}\n"
                f"used={self._format_bytes(int(vm.used))}\n"
                f"available={self._format_bytes(int(vm.available))}\n"
                f"percent={vm.percent}%\n"
            )
        except Exception:
            return "[MEMORY]\npsutil 不可用，无法读取内存指标\n"

    def _command_tasks(self) -> str:
        candidates = [
            Path.home() / ".openclaw" / "pending_tasks.json",
            Path.cwd() / "pending_tasks.json",
            Path.cwd() / "data" / "pending_tasks.json",
        ]
        for candidate in candidates:
            if candidate.exists():
                try:
                    content = json.loads(candidate.read_text(encoding="utf-8"))
                    pretty = json.dumps(content, ensure_ascii=False, indent=2)
                    return f"[TASKS] {candidate}\n{pretty}\n"
                except Exception as exc:  # noqa: BLE001
                    return f"[TASKS] 读取失败: {candidate}\n{exc}\n"
        return "[TASKS] 未找到 pending_tasks.json\n"

    async def _command_processes(self) -> str:
        try:
            import psutil  # type: ignore[import-untyped]

            rows = []
            for proc in psutil.process_iter(["pid", "name", "cmdline"]):
                try:
                    name = str(proc.info.get("name") or "")
                    cmdline = " ".join(proc.info.get("cmdline") or [])
                    blob = f"{name} {cmdline}".lower()
                    if any(keyword in blob for keyword in ("python", "playwright", "chromium", "chrome")):
                        rows.append(
                            f"{proc.info.get('pid', '-'):<8} {name:<20} {cmdline[:120]}"
                        )
                except Exception:
                    continue
            if not rows:
                return "[PROCESS]\n未发现匹配的 python/playwright/chromium 进程\n"
            body = "\n".join(rows[:20])
            return f"[PROCESS]\nPID      NAME                 COMMAND\n{body}\n"
        except Exception:
            if os.name == "nt":
                proc = await asyncio.create_subprocess_exec(
                    "tasklist",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    "ps",
                    "-ef",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            stdout, stderr = await proc.communicate()
            output = stdout.decode("utf-8", errors="replace")
            if stderr:
                output += "\n[STDERR]\n" + stderr.decode("utf-8", errors="replace")
            return output

    def _format_bytes(self, value: int) -> str:
        suffixes = ["B", "KB", "MB", "GB", "TB"]
        size = float(value)
        index = 0
        while size >= 1024 and index < len(suffixes) - 1:
            size /= 1024
            index += 1
        return f"{size:.1f}{suffixes[index]}"
