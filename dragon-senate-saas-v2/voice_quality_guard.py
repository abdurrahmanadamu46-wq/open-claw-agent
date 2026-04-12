from __future__ import annotations

import os
import wave
from dataclasses import asdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class VoiceQualityReport:
    ok: bool
    file_path: str
    file_size_bytes: int = 0
    extension: str = ""
    duration_sec: float = 0.0
    sample_rate: int = 0
    checks: list[dict[str, Any]] | None = None
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class VoiceQualityGuard:
    def __init__(self) -> None:
        self._allowed_extensions = {
            item.strip().lower()
            for item in str(os.getenv("VOICE_ALLOWED_EXTENSIONS") or ".wav,.mp3,.m4a,.aac,.ogg,.opus").split(",")
            if item.strip()
        }
        self._min_bytes = max(64, int(os.getenv("VOICE_MIN_BYTES", "128")))
        self._min_duration = max(0.1, float(os.getenv("VOICE_MIN_DURATION_SEC", "0.5")))
        self._max_duration = max(self._min_duration, float(os.getenv("VOICE_MAX_DURATION_SEC", "600")))

    def validate_audio_file(self, file_path: str) -> VoiceQualityReport:
        path = Path(str(file_path or "").strip())
        checks: list[dict[str, Any]] = []

        def add_check(name: str, ok: bool, detail: str = "") -> None:
            checks.append({"name": name, "ok": ok, "detail": detail})

        if not str(path):
            add_check("path_present", False, "missing_path")
            return VoiceQualityReport(ok=False, file_path="", checks=checks, error="missing_path")

        add_check("path_present", True, str(path))
        if not path.exists():
            add_check("file_exists", False, "not_found")
            return VoiceQualityReport(ok=False, file_path=str(path), checks=checks, error="file_not_found")
        add_check("file_exists", True, "exists")

        extension = path.suffix.lower()
        add_check("allowed_extension", extension in self._allowed_extensions, extension or "no_extension")
        if extension not in self._allowed_extensions:
            return VoiceQualityReport(ok=False, file_path=str(path), extension=extension, checks=checks, error="invalid_extension")

        file_size_bytes = int(path.stat().st_size)
        add_check("min_bytes", file_size_bytes >= self._min_bytes, str(file_size_bytes))
        if file_size_bytes < self._min_bytes:
            return VoiceQualityReport(
                ok=False,
                file_path=str(path),
                file_size_bytes=file_size_bytes,
                extension=extension,
                checks=checks,
                error="file_too_small",
            )

        duration_sec = 0.0
        sample_rate = 0
        if extension == ".wav":
            try:
                with wave.open(str(path), "rb") as handle:
                    frames = int(handle.getnframes() or 0)
                    sample_rate = int(handle.getframerate() or 0)
                    duration_sec = round(frames / max(sample_rate, 1), 3)
                add_check("wav_parse", True, f"duration={duration_sec}s sample_rate={sample_rate}")
            except Exception as exc:  # noqa: BLE001
                add_check("wav_parse", False, str(exc))
                return VoiceQualityReport(
                    ok=False,
                    file_path=str(path),
                    file_size_bytes=file_size_bytes,
                    extension=extension,
                    checks=checks,
                    error=f"wav_parse_failed:{exc}",
                )
        else:
            add_check("duration_check_skipped", True, extension)

        if duration_sec:
            add_check("min_duration", duration_sec >= self._min_duration, str(duration_sec))
            add_check("max_duration", duration_sec <= self._max_duration, str(duration_sec))
            if duration_sec < self._min_duration:
                return VoiceQualityReport(
                    ok=False,
                    file_path=str(path),
                    file_size_bytes=file_size_bytes,
                    extension=extension,
                    duration_sec=duration_sec,
                    sample_rate=sample_rate,
                    checks=checks,
                    error="duration_too_short",
                )
            if duration_sec > self._max_duration:
                return VoiceQualityReport(
                    ok=False,
                    file_path=str(path),
                    file_size_bytes=file_size_bytes,
                    extension=extension,
                    duration_sec=duration_sec,
                    sample_rate=sample_rate,
                    checks=checks,
                    error="duration_too_long",
                )

        return VoiceQualityReport(
            ok=True,
            file_path=str(path),
            file_size_bytes=file_size_bytes,
            extension=extension,
            duration_sec=duration_sec,
            sample_rate=sample_rate,
            checks=checks,
            error="",
        )


_guard: VoiceQualityGuard | None = None


def get_voice_quality_guard() -> VoiceQualityGuard:
    global _guard
    if _guard is None:
        _guard = VoiceQualityGuard()
    return _guard
