"""Log cleanup job factory."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)


def make_log_cleanup_job(log_dir: str = "~/.openclaw/logs", retain_days: int = 7):
    async def log_cleanup() -> None:
        root = Path(log_dir).expanduser()
        if not root.exists():
            return

        cutoff = datetime.now() - timedelta(days=retain_days)
        removed = 0
        for entry in root.glob("*.log*"):
            try:
                modified = datetime.fromtimestamp(entry.stat().st_mtime)
                if modified < cutoff:
                    entry.unlink()
                    removed += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("[LogCleanupJob] failed removing %s: %s", entry, exc)
        if removed:
            logger.info("[LogCleanupJob] removed %s old logs", removed)

    return log_cleanup
