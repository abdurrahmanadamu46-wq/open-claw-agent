from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Literal


class QualityTier(str, Enum):
    PREMIUM = "premium"
    STANDARD = "standard"
    DRAFT = "draft"


@dataclass(slots=True)
class MediaProvider:
    name: str
    provider_type: Literal["video", "image"]
    cost_per_unit: float
    quality_score: float
    avg_latency_seconds: float
    max_resolution: str
    api_endpoint: str
    api_key_env: str
    is_available: bool = True
    daily_quota: int = 1000
    daily_used: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


VIDEO_PROVIDERS = [
    MediaProvider("seedance_2.0", "video", 1.0, 0.95, 45, "1080p", "https://api.seedance.com/v2/generate", "SEEDANCE_API_KEY"),
    MediaProvider("kling_v2", "video", 0.6, 0.85, 60, "1080p", "https://api.klingai.com/v2/video/generate", "KLING_API_KEY"),
    MediaProvider("runway_gen3", "video", 0.8, 0.90, 50, "1080p", "https://api.runwayml.com/v1/generate", "RUNWAY_API_KEY"),
]

IMAGE_PROVIDERS = [
    MediaProvider("imagen_4", "image", 0.29, 0.95, 8, "2048x2048", "https://generativelanguage.googleapis.com/v1/models/imagen-4", "GOOGLE_AI_KEY"),
    MediaProvider("flux_pro", "image", 0.05, 0.80, 5, "1024x1024", "https://api.fal.ai/fal-ai/flux/pro", "FAL_AI_KEY"),
    MediaProvider("dall_e_3", "image", 0.15, 0.88, 12, "1024x1792", "https://api.openai.com/v1/images/generations", "OPENAI_API_KEY"),
]


class MediaCostOptimizer:
    def __init__(self, db_path: str = "./data/media_cost_optimizer.sqlite") -> None:
        self.video_providers = [MediaProvider(**provider.to_dict()) for provider in VIDEO_PROVIDERS]
        self.image_providers = [MediaProvider(**provider.to_dict()) for provider in IMAGE_PROVIDERS]
        self._failure_counts: dict[str, int] = {}
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS media_provider_selection_logs (
                    log_id TEXT PRIMARY KEY,
                    provider_name TEXT NOT NULL,
                    provider_type TEXT NOT NULL,
                    quality_tier TEXT NOT NULL,
                    estimated_cost REAL NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL DEFAULT 0
                );
                """
            )
            conn.commit()

    def select_video_provider(
        self,
        quality: QualityTier = QualityTier.STANDARD,
        *,
        duration_seconds: int = 15,
        budget_remaining_pct: float = 1.0,
    ) -> MediaProvider:
        available = [p for p in self.video_providers if p.is_available]
        if budget_remaining_pct < 0.3 and quality != QualityTier.PREMIUM:
            quality = QualityTier.DRAFT
        candidates = self._rank_candidates(available, quality)
        selected = candidates[0]
        self._log_selection(
            provider=selected.name,
            provider_type="video",
            quality=quality.value,
            estimated_cost=selected.cost_per_unit * max(1, duration_seconds),
            reason=f"quality={selected.quality_score}, cost=¥{selected.cost_per_unit}/s",
        )
        return selected

    def select_image_provider(
        self,
        quality: QualityTier = QualityTier.STANDARD,
        *,
        count: int = 1,
        budget_remaining_pct: float = 1.0,
    ) -> MediaProvider:
        available = [p for p in self.image_providers if p.is_available]
        if budget_remaining_pct < 0.3 and quality != QualityTier.PREMIUM:
            quality = QualityTier.DRAFT
        candidates = self._rank_candidates(available, quality)
        selected = candidates[0]
        self._log_selection(
            provider=selected.name,
            provider_type="image",
            quality=quality.value,
            estimated_cost=selected.cost_per_unit * max(1, count),
            reason=f"quality={selected.quality_score}, cost=¥{selected.cost_per_unit}/image",
        )
        return selected

    @staticmethod
    def _rank_candidates(providers: list[MediaProvider], quality: QualityTier) -> list[MediaProvider]:
        if not providers:
            raise RuntimeError("no_media_provider_available")
        if quality == QualityTier.PREMIUM:
            candidates = sorted(providers, key=lambda p: (p.quality_score, -p.cost_per_unit), reverse=True)
        elif quality == QualityTier.STANDARD:
            candidates = [p for p in providers if p.quality_score >= 0.85]
            candidates = sorted(candidates or providers, key=lambda p: (p.cost_per_unit, -p.quality_score))
        else:
            candidates = [p for p in providers if p.quality_score >= 0.75]
            candidates = sorted(candidates or providers, key=lambda p: (p.cost_per_unit, -p.quality_score))
        return candidates

    def report_failure(self, provider_name: str) -> None:
        normalized = str(provider_name or "").strip()
        self._failure_counts[normalized] = self._failure_counts.get(normalized, 0) + 1
        if self._failure_counts[normalized] >= 3:
            for provider in [*self.video_providers, *self.image_providers]:
                if provider.name == normalized:
                    provider.is_available = False

    def report_success(self, provider_name: str) -> None:
        normalized = str(provider_name or "").strip()
        self._failure_counts[normalized] = 0
        for provider in [*self.video_providers, *self.image_providers]:
            if provider.name == normalized:
                provider.is_available = True

    def estimate_monthly_cost(
        self,
        seat_count: int,
        *,
        video_quality_mix: dict[str, float] | None = None,
        image_quality_mix: dict[str, float] | None = None,
    ) -> dict:
        normalized_seats = max(0, int(seat_count or 0))
        video_quality_mix = video_quality_mix or {"premium": 0.2, "standard": 0.6, "draft": 0.2}
        image_quality_mix = image_quality_mix or {"premium": 0.1, "standard": 0.5, "draft": 0.4}
        videos_per_seat = 20
        video_seconds = 15
        baseline_video = videos_per_seat * video_seconds * 1.0 * normalized_seats
        optimized_video = 0.0
        for tier, pct in video_quality_mix.items():
            provider = self.select_video_provider(QualityTier(str(tier)), duration_seconds=video_seconds)
            optimized_video += videos_per_seat * pct * video_seconds * provider.cost_per_unit * normalized_seats
        images_per_seat = 30
        baseline_image = images_per_seat * 0.29 * normalized_seats
        optimized_image = 0.0
        for tier, pct in image_quality_mix.items():
            provider = self.select_image_provider(QualityTier(str(tier)))
            optimized_image += images_per_seat * pct * provider.cost_per_unit * normalized_seats
        video_savings = baseline_video - optimized_video
        image_savings = baseline_image - optimized_image
        return {
            "seat_count": normalized_seats,
            "video": {
                "baseline_cost": round(baseline_video),
                "optimized_cost": round(optimized_video),
                "savings": round(video_savings),
                "savings_pct": round(video_savings / baseline_video * 100, 1) if baseline_video else 0,
            },
            "image": {
                "baseline_cost": round(baseline_image),
                "optimized_cost": round(optimized_image),
                "savings": round(image_savings),
                "savings_pct": round(image_savings / baseline_image * 100, 1) if baseline_image else 0,
            },
            "total_monthly_savings": round(video_savings + image_savings),
            "total_annual_savings": round((video_savings + image_savings) * 12),
        }

    def _log_selection(self, **kwargs: object) -> None:
        payload = {
            "log_id": f"mco_{uuid.uuid4().hex[:12]}",
            "provider_name": str(kwargs.get("provider") or ""),
            "provider_type": str(kwargs.get("provider_type") or kwargs.get("type") or ""),
            "quality_tier": str(kwargs.get("quality") or ""),
            "estimated_cost": float(kwargs.get("estimated_cost") or kwargs.get("cost") or 0.0),
            "reason": str(kwargs.get("reason") or "")[:300],
            "created_at": time.time(),
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO media_provider_selection_logs(log_id, provider_name, provider_type, quality_tier, estimated_cost, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["log_id"],
                    payload["provider_name"],
                    payload["provider_type"],
                    payload["quality_tier"],
                    payload["estimated_cost"],
                    payload["reason"],
                    payload["created_at"],
                ),
            )
            conn.commit()


_optimizer: MediaCostOptimizer | None = None


def get_media_cost_optimizer() -> MediaCostOptimizer:
    global _optimizer
    if _optimizer is None:
        _optimizer = MediaCostOptimizer()
    return _optimizer
