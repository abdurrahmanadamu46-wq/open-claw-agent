"""
Edge node backup / restore manager.

Primary implementation is in Python for cross-platform compatibility.
Shell scripts in edge-runtime/scripts are thin wrappers around this module.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import stat
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamp_for_name() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


class EdgeBackupManager:
    """Backup/restore manager for edge runtime state."""

    CONFIG_FILES = [
        "edge.json",
        "edge.yaml",
        "edge.toml",
        "scheduler_config.json",
        "channel_accounts.json",
        "settings.json",
    ]

    def __init__(self, openclaw_home: str | Path | None = None) -> None:
        self.openclaw_home = Path(openclaw_home or Path.home() / ".openclaw").expanduser()

    def backup(self, output_dir: str | Path | None = None) -> dict[str, Any]:
        timestamp = _timestamp_for_name()
        node_id = self.detect_node_id()
        output_root = Path(output_dir or Path(tempfile.gettempdir()) / "openclaw-edge-backups").expanduser()
        output_root.mkdir(parents=True, exist_ok=True)

        backup_name = f"edge-backup_{node_id}_{timestamp}"
        lines = [
            "",
            f"Edge Node Backup - {timestamp}",
            f"Node: {node_id}",
        ]

        with tempfile.TemporaryDirectory(prefix="openclaw-edge-backup-") as temp_dir:
            work_dir = Path(temp_dir) / backup_name
            work_dir.mkdir(parents=True, exist_ok=True)

            contents = {
                "memory": self._collect_memory(work_dir, lines),
                "config": self._collect_config(work_dir, lines),
                "credentials": self._collect_directory("credentials", work_dir, lines),
                "tasks": self._collect_tasks(work_dir, lines),
                "cron": self._collect_cron(work_dir, lines),
            }

            manifest = self._build_manifest(backup_name, node_id, contents)
            (work_dir / "MANIFEST.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            archive_path = output_root / f"{backup_name}.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                archive.add(work_dir, arcname=backup_name)

        self._protect_archive(archive_path)
        self._prune_old_backups(output_root)
        size_text = self._human_size(archive_path.stat().st_size)
        lines.extend(
            [
                "",
                f"Backup complete: {archive_path.name}",
                f"Size: {size_text}",
                f"Archive: {archive_path}",
            ]
        )
        return {
            "success": True,
            "backup_name": backup_name,
            "archive": str(archive_path),
            "size_bytes": archive_path.stat().st_size,
            "manifest": manifest,
            "output": "\n".join(lines),
        }

    def list_backups(self, backup_dir: str | Path | None = None, limit: int = 20) -> list[dict[str, Any]]:
        root = Path(backup_dir or Path(tempfile.gettempdir()) / "openclaw-edge-backups").expanduser()
        if not root.exists():
            return []
        rows = sorted(root.glob("edge-backup_*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
        return [
            {
                "name": item.name,
                "path": str(item),
                "size": item.stat().st_size,
                "mtime": item.stat().st_mtime,
            }
            for item in rows[: max(1, int(limit))]
        ]

    def restore(self, archive_path: str | Path, dry_run: bool = True) -> dict[str, Any]:
        archive = Path(archive_path).expanduser()
        if not archive.exists():
            return {
                "success": False,
                "dry_run": dry_run,
                "output": f"Archive not found: {archive}",
            }

        lines = [
            "",
            f"Edge Node Restore - {'DRY RUN' if dry_run else 'LIVE'}",
            f"Archive: {archive}",
        ]
        started_at = time.time()

        with tempfile.TemporaryDirectory(prefix="openclaw-edge-restore-") as temp_dir:
            temp_root = Path(temp_dir)
            with tarfile.open(archive, "r:gz") as backup:
                backup.extractall(temp_root)
            extracted_root = self._detect_extracted_root(temp_root)
            manifest = self._read_manifest(extracted_root)
            if manifest:
                lines.extend(
                    [
                        f"Backup: {manifest.get('backup_name')}",
                        f"Node: {manifest.get('node_id')}",
                        f"Time: {manifest.get('timestamp')}",
                    ]
                )

            plan = self._restore_plan(extracted_root)
            for row in plan:
                if dry_run:
                    lines.append(f"[DRY-RUN] Would restore {row['label']} -> {row['destination']}")
                else:
                    self._apply_restore_item(row)
                    lines.append(f"Restored {row['label']} -> {row['destination']}")

            if not dry_run:
                marker = self._write_restore_marker(archive.name, manifest)
                lines.append(f"Wrote restore marker: {marker}")
                self._report_restore_complete(
                    archive_name=archive.name,
                    manifest=manifest,
                    started_at=started_at,
                    duration_seconds=time.time() - started_at,
                )

        if dry_run:
            lines.append("Dry-run complete. No files were changed.")
        else:
            lines.append("Restore complete. Restart edge-runtime to apply changes.")

        return {
            "success": True,
            "dry_run": dry_run,
            "output": "\n".join(lines),
            "manifest": manifest,
        }

    def check_restore_complete(self) -> dict[str, Any] | None:
        marker = self.openclaw_home / "workspace" / ".restore-complete.json"
        if not marker.exists():
            return None
        try:
            payload = json.loads(marker.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            marker.unlink(missing_ok=True)
            return None
        marker.unlink(missing_ok=True)
        return payload

    def detect_node_id(self) -> str:
        env_value = str(os.getenv("EDGE_NODE_ID", "")).strip()
        if env_value:
            return env_value
        edge_json = self.openclaw_home / "edge.json"
        if edge_json.exists():
            try:
                payload = json.loads(edge_json.read_text(encoding="utf-8"))
                candidate = str(payload.get("node_id") or payload.get("nodeId") or "").strip()
                if candidate:
                    return candidate
            except Exception:
                pass
        return "unknown"

    def _collect_memory(self, work_dir: Path, lines: list[str]) -> bool:
        copied = False
        memory_dir = self.openclaw_home / "memory"
        memory_dst = work_dir / "memory"
        if memory_dir.is_dir():
            self._copy_directory(memory_dir, memory_dst)
            copied = True
        for name in ["edge_memory.db", "edge_memory.db-shm", "edge_memory.db-wal", "edge_memory.db-journal"]:
            source = self.openclaw_home / name
            if source.exists():
                memory_dst.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, memory_dst / source.name)
                copied = True
        lines.append(f"memory -> {'included' if copied else 'missing'}")
        return copied

    def _collect_config(self, work_dir: Path, lines: list[str]) -> bool:
        config_dst = work_dir / "config"
        copied = 0
        for name in self.CONFIG_FILES:
            source = self.openclaw_home / name
            if source.exists():
                config_dst.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, config_dst / source.name)
                copied += 1
        lines.append(f"config -> {copied} files")
        return copied > 0

    def _collect_directory(self, name: str, work_dir: Path, lines: list[str]) -> bool:
        source = self.openclaw_home / name
        if not source.is_dir():
            lines.append(f"{name} -> missing")
            return False
        self._copy_directory(source, work_dir / name)
        lines.append(f"{name} -> included")
        return True

    def _collect_tasks(self, work_dir: Path, lines: list[str]) -> bool:
        copied = self._collect_directory("tasks", work_dir, [])
        pending = self.openclaw_home / "pending_tasks.json"
        if pending.exists():
            tasks_dst = work_dir / "tasks"
            tasks_dst.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pending, tasks_dst / "pending_tasks.json")
            copied = True
        lines.append(f"tasks -> {'included' if copied else 'missing'}")
        return copied

    def _collect_cron(self, work_dir: Path, lines: list[str]) -> bool:
        copied = self._collect_directory("cron", work_dir, [])
        scheduler_config = self.openclaw_home / "scheduler_config.json"
        if scheduler_config.exists():
            cron_dst = work_dir / "cron"
            cron_dst.mkdir(parents=True, exist_ok=True)
            shutil.copy2(scheduler_config, cron_dst / "scheduler_config.json")
            copied = True
        lines.append(f"cron -> {'included' if copied else 'missing'}")
        return copied

    def _copy_directory(self, source: Path, destination: Path) -> None:
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)

    def _build_manifest(self, backup_name: str, node_id: str, contents: dict[str, bool]) -> dict[str, Any]:
        return {
            "backup_name": backup_name,
            "node_id": node_id,
            "timestamp": _utc_now(),
            "hostname": os.getenv("COMPUTERNAME") or os.getenv("HOSTNAME") or "unknown",
            "openclaw_home": str(self.openclaw_home),
            "created_by": "openclaw-edge-backup v1.0",
            "contents": contents,
            "notes": "Edge node full backup. Contains credentials - keep secure.",
        }

    def _protect_archive(self, archive_path: Path) -> None:
        try:
            archive_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass

    def _prune_old_backups(self, root: Path, keep: int = 7) -> None:
        archives = sorted(root.glob("edge-backup_*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
        for item in archives[keep:]:
            item.unlink(missing_ok=True)

    def _detect_extracted_root(self, temp_root: Path) -> Path:
        children = [child for child in temp_root.iterdir()]
        if len(children) == 1 and children[0].is_dir():
            return children[0]
        return temp_root

    def _read_manifest(self, extracted_root: Path) -> dict[str, Any] | None:
        manifest = extracted_root / "MANIFEST.json"
        if not manifest.exists():
            return None
        try:
            return json.loads(manifest.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _restore_plan(self, extracted_root: Path) -> list[dict[str, Any]]:
        plan: list[dict[str, Any]] = []
        memory_dir = extracted_root / "memory"
        if memory_dir.exists():
            plan.append({"label": "memory", "source": memory_dir, "destination": self.openclaw_home / "memory", "kind": "memory"})
        config_dir = extracted_root / "config"
        if config_dir.exists():
            plan.append({"label": "config", "source": config_dir, "destination": self.openclaw_home, "kind": "config"})
        credentials_dir = extracted_root / "credentials"
        if credentials_dir.exists():
            plan.append({"label": "credentials", "source": credentials_dir, "destination": self.openclaw_home / "credentials", "kind": "dir"})
        tasks_dir = extracted_root / "tasks"
        if tasks_dir.exists():
            plan.append({"label": "tasks", "source": tasks_dir, "destination": self.openclaw_home / "tasks", "kind": "tasks"})
        cron_dir = extracted_root / "cron"
        if cron_dir.exists():
            plan.append({"label": "cron", "source": cron_dir, "destination": self.openclaw_home / "cron", "kind": "cron"})
        return plan

    def _apply_restore_item(self, item: dict[str, Any]) -> None:
        source = Path(item["source"])
        destination = Path(item["destination"])
        kind = str(item["kind"])

        if kind == "memory":
            destination.mkdir(parents=True, exist_ok=True)
            for child in source.iterdir():
                if child.name.startswith("edge_memory.db"):
                    shutil.copy2(child, self.openclaw_home / child.name)
                elif child.is_dir():
                    self._copy_directory(child, destination / child.name)
                else:
                    shutil.copy2(child, destination / child.name)
            return

        if kind == "config":
            self.openclaw_home.mkdir(parents=True, exist_ok=True)
            for child in source.iterdir():
                shutil.copy2(child, self.openclaw_home / child.name)
            return

        if kind == "tasks":
            destination.mkdir(parents=True, exist_ok=True)
            for child in source.iterdir():
                if child.name == "pending_tasks.json":
                    shutil.copy2(child, self.openclaw_home / "pending_tasks.json")
                elif child.is_dir():
                    self._copy_directory(child, destination / child.name)
                else:
                    shutil.copy2(child, destination / child.name)
            return

        if kind == "cron":
            destination.mkdir(parents=True, exist_ok=True)
            for child in source.iterdir():
                if child.name == "scheduler_config.json":
                    shutil.copy2(child, self.openclaw_home / "scheduler_config.json")
                elif child.is_dir():
                    self._copy_directory(child, destination / child.name)
                else:
                    shutil.copy2(child, destination / child.name)
            return

        if destination.exists():
            shutil.rmtree(destination)
        self._copy_directory(source, destination)

    def _write_restore_marker(self, archive_name: str, manifest: dict[str, Any] | None) -> Path:
        marker_dir = self.openclaw_home / "workspace"
        marker_dir.mkdir(parents=True, exist_ok=True)
        marker = marker_dir / ".restore-complete.json"
        payload = {
            "backup_name": archive_name,
            "restored_at": _utc_now(),
            "node_id": (manifest or {}).get("node_id", self.detect_node_id()),
            "contents": [name for name, enabled in (manifest or {}).get("contents", {}).items() if enabled],
        }
        marker.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return marker

    def _report_restore_complete(
        self,
        *,
        archive_name: str,
        manifest: dict[str, Any] | None,
        started_at: float,
        duration_seconds: float,
    ) -> None:
        try:
            import sys

            runtime_root = Path(__file__).resolve().parent.parent / "dragon-senate-saas-v2"
            if str(runtime_root) not in sys.path:
                sys.path.insert(0, str(runtime_root))
            from restore_event import report_restore_complete

            items_restored = sum(1 for enabled in ((manifest or {}).get("contents") or {}).values() if enabled)
            asyncio.run(
                report_restore_complete(
                    tenant_id=str(os.getenv("EDGE_TENANT_ID", "tenant_main")).strip() or "tenant_main",
                    backup_file=archive_name,
                    restore_type="full",
                    operator="edge-runtime",
                    status="completed",
                    items_restored=items_restored,
                    duration_seconds=duration_seconds,
                    started_at=started_at,
                    detail={"node_id": self.detect_node_id(), "contents": (manifest or {}).get("contents", {})},
                    trigger_followup_report=True,
                )
            )
        except Exception:
            pass

    def _human_size(self, size_bytes: int) -> str:
        value = float(size_bytes)
        suffixes = ["B", "KB", "MB", "GB", "TB"]
        index = 0
        while value >= 1024 and index < len(suffixes) - 1:
            value /= 1024
            index += 1
        return f"{value:.1f}{suffixes[index]}"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OpenClaw edge backup manager")
    sub = parser.add_subparsers(dest="command", required=True)

    backup_parser = sub.add_parser("backup", help="Create a new backup archive")
    backup_parser.add_argument("output_dir", nargs="?", default=None)
    backup_parser.add_argument("--openclaw-home", default=None)

    list_parser = sub.add_parser("list", help="List backup archives")
    list_parser.add_argument("backup_dir", nargs="?", default=None)
    list_parser.add_argument("--limit", type=int, default=20)
    list_parser.add_argument("--json", action="store_true")
    list_parser.add_argument("--openclaw-home", default=None)

    restore_parser = sub.add_parser("restore", help="Restore from backup archive")
    restore_parser.add_argument("archive")
    restore_parser.add_argument("--dry-run", action="store_true")
    restore_parser.add_argument("--openclaw-home", default=None)

    check_parser = sub.add_parser("check-restore", help="Read and clear restore-complete marker")
    check_parser.add_argument("--openclaw-home", default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    manager = EdgeBackupManager(openclaw_home=getattr(args, "openclaw_home", None))

    if args.command == "backup":
        result = manager.backup(args.output_dir)
        print(result["output"])
        return 0 if result.get("success") else 1

    if args.command == "list":
        rows = manager.list_backups(args.backup_dir, limit=args.limit)
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            for row in rows:
                print(f"{row['name']}  {row['size']}  {row['mtime']}")
        return 0

    if args.command == "restore":
        result = manager.restore(args.archive, dry_run=args.dry_run)
        print(result["output"])
        return 0 if result.get("success") else 1

    if args.command == "check-restore":
        payload = manager.check_restore_complete()
        print(json.dumps(payload, ensure_ascii=False, indent=2) if payload else "{}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
