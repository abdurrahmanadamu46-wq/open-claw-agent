from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class MemoryBackend(ABC):
    @abstractmethod
    async def save(
        self,
        tenant_id: str,
        lobster_id: str,
        category: str,
        key: str,
        value: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    async def load(self, tenant_id: str, lobster_id: str, category: str, key: str) -> dict[str, Any] | None:
        raise NotImplementedError

    @abstractmethod
    async def search(
        self,
        tenant_id: str,
        lobster_id: str,
        query: str,
        category: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    async def delete(self, tenant_id: str, lobster_id: str, category: str, key: str) -> None:
        raise NotImplementedError
