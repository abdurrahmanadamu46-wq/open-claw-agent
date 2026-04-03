"""
Brain memory service facade inspired by memU MemoryService.
"""

from __future__ import annotations

from typing import Any

from brain.memory_backends import MemoryBackendFactory


class BrainMemoryService:
    def __init__(self, backend_type: str = "sqlite"):
        self.backend = MemoryBackendFactory.create(backend_type)

    async def memorize(
        self,
        tenant_id: str,
        lobster_id: str,
        category: str,
        key: str,
        value: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.backend.save(tenant_id, lobster_id, category, key, value, metadata)

    async def retrieve(
        self,
        tenant_id: str,
        lobster_id: str,
        query: str,
        category: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        return await self.backend.search(tenant_id, lobster_id, query, category, top_k)

    async def share_memory(
        self,
        from_lobster: str,
        to_lobster: str,
        memory_key: str,
        tenant_id: str,
        category: str = "knowledge",
    ) -> bool:
        item = await self.backend.load(tenant_id, from_lobster, category, memory_key)
        if item is None:
            return False
        await self.backend.save(
            tenant_id,
            to_lobster,
            category,
            memory_key,
            str(item.get("value") or ""),
            {"shared_from": from_lobster},
        )
        return True
