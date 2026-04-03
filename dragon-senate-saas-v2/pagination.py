"""
Lightweight pagination helpers shared by list APIs.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class PaginatedResponse(Generic[T]):
    data: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def from_items(cls, items: list[T], *, total: int, page: int, page_size: int) -> "PaginatedResponse[T]":
        safe_page = max(1, int(page or 1))
        safe_page_size = max(1, int(page_size or 1))
        return cls(
            data=list(items),
            total=max(0, int(total or 0)),
            page=safe_page,
            page_size=safe_page_size,
            total_pages=max(1, ceil(max(0, int(total or 0)) / safe_page_size)) if safe_page_size else 1,
        )

    def to_dict(self, **extra: object) -> dict[str, object]:
        payload = asdict(self)
        payload["items"] = payload["data"]
        payload.update(extra)
        return payload
