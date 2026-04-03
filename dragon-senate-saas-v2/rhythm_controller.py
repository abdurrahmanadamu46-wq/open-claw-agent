"""
Rhythm controller for Layer 2 task dispatch.

Provides lightweight throttling and tenant-level dispatch windows so scheduler
work can be rate-limited without coupling this logic into the runner itself.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


class RhythmController:
    """Tenant-scoped throttle and concurrency rules."""

    def __init__(self, config_path: str = "data/rhythm_controller.json"):
        self._config_path = Path(config_path)
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config = self._load()

    def should_throttle(self, tenant_id: str) -> bool:
        usage = self._tenant_config(tenant_id).get("current_batch_size", 0)
        return int(usage or 0) >= self.get_concurrency_limit(tenant_id)

    def get_time_window(self, tenant_id: str) -> tuple[int, int]:
        cfg = self._tenant_config(tenant_id)
        start = int(cfg.get("window_start_hour", 0) or 0)
        end = int(cfg.get("window_end_hour", 23) or 23)
        return start, end

    def get_concurrency_limit(self, tenant_id: str) -> int:
        return max(1, int(self._tenant_config(tenant_id).get("concurrency_limit", 3) or 3))

    def is_within_time_window(self, tenant_id: str, now: datetime | None = None) -> bool:
        current = now or datetime.now()
        start, end = self.get_time_window(tenant_id)
        hour = current.hour
        if start <= end:
            return start <= hour <= end
        return hour >= start or hour <= end

    def configure_tenant(
        self,
        tenant_id: str,
        *,
        concurrency_limit: int | None = None,
        window_start_hour: int | None = None,
        window_end_hour: int | None = None,
    ) -> dict[str, Any]:
        tenants = self._config.setdefault("tenants", {})
        cfg = dict(tenants.get(tenant_id, {}) or {})
        if concurrency_limit is not None:
            cfg["concurrency_limit"] = max(1, int(concurrency_limit))
        if window_start_hour is not None:
            cfg["window_start_hour"] = max(0, min(23, int(window_start_hour)))
        if window_end_hour is not None:
            cfg["window_end_hour"] = max(0, min(23, int(window_end_hour)))
        tenants[tenant_id] = cfg
        self._save()
        return cfg

    def _tenant_config(self, tenant_id: str) -> dict[str, Any]:
        return dict(self._config.get("tenants", {}).get(tenant_id, {}) or {})

    def _load(self) -> dict[str, Any]:
        if not self._config_path.exists():
            return {"tenants": {}}
        try:
            payload = json.loads(self._config_path.read_text(encoding="utf-8"))
        except Exception:
            return {"tenants": {}}
        if not isinstance(payload, dict):
            return {"tenants": {}}
        if not isinstance(payload.get("tenants"), dict):
            payload["tenants"] = {}
        return payload

    def _save(self) -> None:
        self._config_path.write_text(json.dumps(self._config, ensure_ascii=False, indent=2), encoding="utf-8")
