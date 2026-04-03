"""Memory sync job factory."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def make_memory_sync_job(memory_store, cloud_sync_fn):
    async def memory_sync() -> None:
        unsynced = await memory_store.get_unsynced_memories(limit=100)
        if not unsynced:
            logger.debug("[MemorySyncJob] no unsynced memories")
            return

        result = await cloud_sync_fn(unsynced)
        if result.get("success"):
            await memory_store.mark_synced([int(item["id"]) for item in unsynced if "id" in item])
            logger.info("[MemorySyncJob] synced %s memories", len(unsynced))
            return

        logger.warning("[MemorySyncJob] sync failed: %s", result.get("error"))

    return memory_sync
