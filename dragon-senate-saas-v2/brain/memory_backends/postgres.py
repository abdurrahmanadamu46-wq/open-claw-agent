from __future__ import annotations

from typing import Any

from .base import MemoryBackend


class PostgresBackend(MemoryBackend):
    """Placeholder backend for future Postgres memory storage."""

    async def save(self, tenant_id: str, lobster_id: str, category: str, key: str, value: str, metadata: dict[str, Any] | None = None) -> None:
        raise NotImplementedError("PostgresBackend is not implemented yet")

    async def load(self, tenant_id: str, lobster_id: str, category: str, key: str) -> dict[str, Any] | None:
        raise NotImplementedError("PostgresBackend is not implemented yet")

    async def search(self, tenant_id: str, lobster_id: str, query: str, category: str | None = None, top_k: int = 5) -> list[dict[str, Any]]:
        raise NotImplementedError("PostgresBackend is not implemented yet")

    async def delete(self, tenant_id: str, lobster_id: str, category: str, key: str) -> None:
        raise NotImplementedError("PostgresBackend is not implemented yet")
