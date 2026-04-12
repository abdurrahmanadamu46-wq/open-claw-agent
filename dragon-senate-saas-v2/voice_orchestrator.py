from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from artifact_store import get_artifact_store
from voice_quality_guard import get_voice_quality_guard


@dataclass(slots=True)
class VoiceSynthesisResult:
    ok: bool
    provider: str
    mode: str
    audio_path: str = ""
    subtitle_srt_path: str = ""
    duration_sec: float = 0.0
    fallback_used: bool = False
    artifact_ids: list[str] | None = None
    quality_report: dict[str, Any] | None = None
    error: str = ""


def _escape_srt_text(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = int(max(0.0, seconds) * 1000)
    hours = total_ms // 3_600_000
    total_ms %= 3_600_000
    minutes = total_ms // 60_000
    total_ms %= 60_000
    secs = total_ms // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def build_single_block_srt(text: str, duration_sec: float) -> str:
    body = _escape_srt_text(text)
    end_ts = _format_srt_timestamp(max(1.0, duration_sec))
    return f"1\n00:00:00,000 --> {end_ts}\n{body}\n"


class VoiceOrchestrator:
    def __init__(self) -> None:
        self._voxcpm_base = str(os.getenv("VOXCPM_BASE_URL") or "http://voxcpm-service:8000").strip().rstrip("/")
        self._provider = str(os.getenv("VOICE_PROVIDER") or "voxcpm").strip().lower() or "voxcpm"
        self._fallback_provider = str(os.getenv("VOICE_FALLBACK_PROVIDER") or "basic_tts").strip().lower() or "basic_tts"
        self._timeout_sec = float(os.getenv("VOICE_TIMEOUT_SEC", "60"))
        self._subtitle_dir = Path(str(os.getenv("VOICE_SUBTITLE_DIR") or "data/voice-subtitles"))
        self._subtitle_dir.mkdir(parents=True, exist_ok=True)

    async def synthesize_and_store(
        self,
        *,
        run_id: str,
        lobster_id: str,
        tenant_id: str,
        text: str,
        voice_mode: str = "standard",
        voice_prompt: str = "",
        voice_profile: dict[str, Any] | None = None,
        subtitle_required: bool = False,
        step_index: int | None = None,
        triggered_by: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> VoiceSynthesisResult:
        voice_profile = dict(voice_profile or {})
        payload_meta = dict(meta or {})
        result = await self._dispatch(
            text=text,
            voice_mode=voice_mode,
            voice_prompt=voice_prompt,
            voice_profile=voice_profile,
        )
        if not result.ok:
            return result

        quality_report = get_voice_quality_guard().validate_audio_file(result.audio_path)
        result.quality_report = quality_report.to_dict()
        if not quality_report.ok:
            result.ok = False
            result.error = quality_report.error or "voice_quality_failed"
            return result

        artifact_ids: list[str] = []
        store = get_artifact_store()
        voice_artifact_id = store.save(
            run_id=run_id,
            lobster=lobster_id,
            artifact_type="voice",
            content=text,
            step_index=step_index,
            status="draft",
            meta={
                **payload_meta,
                "provider": result.provider,
                "mode": result.mode,
                "audio_path": result.audio_path,
                "duration_sec": result.duration_sec,
                "voice_mode": voice_mode,
                "voice_prompt": voice_prompt,
                "voice_profile": voice_profile,
                "fallback_used": result.fallback_used,
                "quality_report": result.quality_report,
                "tenant_id": tenant_id,
            },
            triggered_by=triggered_by,
        )
        artifact_ids.append(voice_artifact_id)

        subtitle_path = ""
        if subtitle_required:
            subtitle_path = self._subtitle_dir / f"{voice_artifact_id}.srt"
            subtitle_path.write_text(
                build_single_block_srt(text, result.duration_sec),
                encoding="utf-8",
            )
            subtitle_artifact_id = store.save(
                run_id=run_id,
                lobster=lobster_id,
                artifact_type="subtitle",
                content=str(subtitle_path.read_text(encoding="utf-8")),
                step_index=step_index,
                status="draft",
                meta={
                    **payload_meta,
                    "subtitle_srt_path": str(subtitle_path),
                    "voice_artifact_id": voice_artifact_id,
                    "quality_report": result.quality_report,
                    "tenant_id": tenant_id,
                },
                triggered_by=voice_artifact_id,
            )
            artifact_ids.append(subtitle_artifact_id)

        result.subtitle_srt_path = str(subtitle_path) if subtitle_path else ""
        result.artifact_ids = artifact_ids

        store.save(
            run_id=run_id,
            lobster=lobster_id,
            artifact_type="dub_job",
            content=f"voice_mode={voice_mode}\nprovider={result.provider}\ntext={text[:500]}",
            step_index=step_index,
            status="draft",
            meta={
                **payload_meta,
                "voice_artifact_id": voice_artifact_id,
                "subtitle_srt_path": result.subtitle_srt_path,
                "tenant_id": tenant_id,
                "audio_path": result.audio_path,
                "quality_report": result.quality_report,
            },
            triggered_by=triggered_by,
        )
        return result

    async def _dispatch(
        self,
        *,
        text: str,
        voice_mode: str,
        voice_prompt: str,
        voice_profile: dict[str, Any],
    ) -> VoiceSynthesisResult:
        if self._provider == "voxcpm":
            result = await self._call_voxcpm(
                text=text,
                voice_mode=voice_mode,
                voice_prompt=voice_prompt,
                voice_profile=voice_profile,
            )
            if result.ok:
                return result

        fallback = await self._fallback_tts(text=text, voice_mode=voice_mode)
        fallback.fallback_used = True
        return fallback

    async def _call_voxcpm(
        self,
        *,
        text: str,
        voice_mode: str,
        voice_prompt: str,
        voice_profile: dict[str, Any],
    ) -> VoiceSynthesisResult:
        try:
            async with httpx.AsyncClient(timeout=self._timeout_sec) as client:
                if voice_mode == "brand_clone" and voice_profile.get("reference_audio_path"):
                    response = await client.post(
                        f"{self._voxcpm_base}/v1/tts/clone",
                        json={
                            "text": text,
                            "reference_audio_path": voice_profile.get("reference_audio_path"),
                            "voice_prompt": voice_prompt or voice_profile.get("voice_prompt", ""),
                            "language": voice_profile.get("language", "zh"),
                            "sample_rate": int(voice_profile.get("sample_rate", 48000) or 48000),
                            "format": "wav",
                        },
                    )
                else:
                    response = await client.post(
                        f"{self._voxcpm_base}/v1/tts/synthesize",
                        json={
                            "text": text,
                            "voice_prompt": voice_prompt or voice_profile.get("voice_prompt", ""),
                            "language": voice_profile.get("language", "zh"),
                            "sample_rate": int(voice_profile.get("sample_rate", 48000) or 48000),
                            "format": "wav",
                            "stream": False,
                        },
                    )
                response.raise_for_status()
                data = response.json()
            return VoiceSynthesisResult(
                ok=bool(data.get("ok")),
                provider="voxcpm",
                mode=str(data.get("mode") or voice_mode),
                audio_path=str(data.get("audio_path") or ""),
                duration_sec=float(data.get("duration_sec") or 0.0),
                error="" if bool(data.get("ok")) else str(data.get("error") or ""),
            )
        except Exception as exc:  # noqa: BLE001
            return VoiceSynthesisResult(
                ok=False,
                provider="voxcpm",
                mode=voice_mode,
                error=str(exc),
            )

    async def _fallback_tts(self, *, text: str, voice_mode: str) -> VoiceSynthesisResult:
        return VoiceSynthesisResult(
            ok=False,
            provider=self._fallback_provider,
            mode=voice_mode,
            error="fallback_tts_not_implemented",
        )


_voice_orchestrator: VoiceOrchestrator | None = None


def get_voice_orchestrator() -> VoiceOrchestrator:
    global _voice_orchestrator
    if _voice_orchestrator is None:
        _voice_orchestrator = VoiceOrchestrator()
    return _voice_orchestrator
