from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SubjectStat:
    subject: str
    total_count: int = 0
    count_last_minute: int = 0
    count_last_hour: int = 0
    last_published_at: float = 0.0
    minute_buckets: list[int] = field(default_factory=lambda: [0] * 60)
    last_bucket_minute: int = field(default_factory=lambda: int(time.time() // 60))

    def rotate_to(self, target_minute: int) -> None:
        if target_minute <= self.last_bucket_minute:
            return
        delta = min(target_minute - self.last_bucket_minute, 60)
        for offset in range(1, delta + 1):
            self.minute_buckets[(self.last_bucket_minute + offset) % 60] = 0
        self.last_bucket_minute = target_minute

    def record(self, now_ts: float) -> None:
        minute = int(now_ts // 60)
        self.rotate_to(minute)
        self.total_count += 1
        self.last_published_at = now_ts
        self.minute_buckets[minute % 60] += 1
        self.count_last_minute = self.minute_buckets[minute % 60]
        self.count_last_hour = sum(self.minute_buckets)


class EventBusMetrics:
    """Lightweight subject traffic collector inspired by EMQX topic monitoring."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stats: dict[str, SubjectStat] = {}

    def record(self, subject: str) -> None:
        normalized = str(subject or "").strip()
        if not normalized:
            return
        now_ts = time.time()
        with self._lock:
            stat = self._stats.get(normalized)
            if stat is None:
                stat = SubjectStat(subject=normalized)
                self._stats[normalized] = stat
            stat.record(now_ts)

    def get_stats(self, prefix_filter: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            now_minute = int(time.time() // 60)
            items: list[dict[str, Any]] = []
            for subject, stat in self._stats.items():
                stat.rotate_to(now_minute)
                stat.count_last_minute = stat.minute_buckets[now_minute % 60]
                stat.count_last_hour = sum(stat.minute_buckets)
                if prefix_filter and not subject.startswith(prefix_filter):
                    continue
                items.append(
                    {
                        "subject": subject,
                        "total_count": stat.total_count,
                        "count_last_minute": stat.count_last_minute,
                        "count_last_hour": stat.count_last_hour,
                        "rate_per_min": stat.count_last_minute,
                        "last_published_at": stat.last_published_at,
                    }
                )
            items.sort(key=lambda row: row["total_count"], reverse=True)
            return items

    def get_prefix_aggregation(self) -> list[dict[str, Any]]:
        stats = self.get_stats()
        prefix_map: dict[str, dict[str, Any]] = {}
        for item in stats:
            parts = str(item["subject"]).split(".")
            prefix = ".".join(parts[:2]) if len(parts) >= 2 else parts[0]
            row = prefix_map.setdefault(
                prefix,
                {
                    "prefix": prefix,
                    "total_count": 0,
                    "count_last_minute": 0,
                    "count_last_hour": 0,
                    "subjects": [],
                },
            )
            row["total_count"] += item["total_count"]
            row["count_last_minute"] += item["count_last_minute"]
            row["count_last_hour"] += item["count_last_hour"]
            row["subjects"].append(item)
        return sorted(prefix_map.values(), key=lambda row: row["total_count"], reverse=True)

    def snapshot(self) -> dict[str, Any]:
        stats = self.get_stats()
        return {
            "total_subjects": len(self._stats),
            "top_subjects": stats[:10],
            "prefixes": self.get_prefix_aggregation(),
        }


_metrics: EventBusMetrics | None = None


def get_event_bus_metrics() -> EventBusMetrics:
    global _metrics
    if _metrics is None:
        _metrics = EventBusMetrics()
    return _metrics
