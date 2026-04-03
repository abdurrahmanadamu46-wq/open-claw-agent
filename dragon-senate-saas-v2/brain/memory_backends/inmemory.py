from __future__ import annotations

from typing import Any

from .base import MemoryBackend


class InMemoryBackend(MemoryBackend):
    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    def _memory_key(self, tenant_id: str, lobster_id: str, category: str, key: str) -> str:
        return f"{tenant_id}:{lobster_id}:{category}:{key}"

    async def save(self, tenant_id: str, lobster_id: str, category: str, key: str, value: str, metadata: dict[str, Any] | None = None) -> None:
        self._store[self._memory_key(tenant_id, lobster_id, category, key)] = {
            "tenant_id": tenant_id,
            "lobster_id": lobster_id,
            "category": category,
            "key": key,
            "value": value,
            "metadata": metadata or {},
        }

    async def load(self, tenant_id: str, lobster_id: str, category: str, key: str) -> dict[str, Any] | None:
        return self._store.get(self._memory_key(tenant_id, lobster_id, category, key))

    async def search(self, tenant_id: str, lobster_id: str, query: str, category: str | None = None, top_k: int = 5) -> list[dict[str, Any]]:
        lowered = str(query or "").lower()
        rows = []
        for item in self._store.values():
            if item["tenant_id"] != tenant_id or item["lobster_id"] != lobster_id:
                continue
            if category and item["category"] != category:
                continue
            haystack = f"{item['key']} {item['value']}".lower()
            if lowered and lowered not in haystack:
                continue
            rows.append(item)
        return rows[: max(1, top_k)]

    async def delete(self, tenant_id: str, lobster_id: str, category: str, key: str) -> None:
        self._store.pop(self._memory_key(tenant_id, lobster_id, category, key), None)
