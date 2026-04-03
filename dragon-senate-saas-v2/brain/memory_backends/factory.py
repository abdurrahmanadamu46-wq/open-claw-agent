from __future__ import annotations

from .base import MemoryBackend
from .inmemory import InMemoryBackend
from .postgres import PostgresBackend
from .sqlite import SQLiteBackend


class MemoryBackendFactory:
    @staticmethod
    def create(backend_type: str) -> MemoryBackend:
        normalized = str(backend_type or "sqlite").strip().lower()
        if normalized == "inmemory":
            return InMemoryBackend()
        if normalized == "sqlite":
            return SQLiteBackend()
        if normalized == "postgres":
            return PostgresBackend()
        raise ValueError(f"Unknown backend type: {backend_type}")
