"""
VoxCPM service.

Phase 1 scope:
- health check
- synthesize narration
- clone narration from a reference audio path

The service supports a fake mode for local integration smoke when VoxCPM and
GPU dependencies are unavailable. Disable fake mode in production.
"""

from __future__ import annotations

import io
import math
import os
import struct
import wave
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="VoxCPM Service", version="1.0.0")

MODEL_NAME = str(os.getenv("VOXCPM_MODEL_NAME") or "VoxCPM2").strip() or "VoxCPM2"
DEVICE = str(os.getenv("VOXCPM_DEVICE") or "cuda:0").strip() or "cuda:0"
OUTPUT_DIR = Path(str(os.getenv("VOXCPM_OUTPUT_DIR") or "/app/data/output"))
REFERENCE_DIR = Path(str(os.getenv("VOXCPM_REFERENCE_DIR") or "/app/data/reference"))
ENABLE_CLONE = str(os.getenv("VOXCPM_ENABLE_CLONE") or "false").strip().lower() in {"1", "true", "yes", "on"}
FAKE_MODE = str(os.getenv("VOXCPM_FAKE_MODE") or "true").strip().lower() in {"1", "true", "yes", "on"}

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REFERENCE_DIR.mkdir(parents=True, exist_ok=True)

_MODEL = None
_MODEL_ERROR = ""


class TtsSynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    language: str = Field(default="zh", min_length=2, max_length=16)
    voice_prompt: str = Field(default="", max_length=1000)
    sample_rate: int = Field(default=48000, ge=16000, le=48000)
    format: Literal["wav", "mp3"] = "wav"
    stream: bool = False


class TtsCloneRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    reference_audio_path: str = Field(..., min_length=1, max_length=2000)
    voice_prompt: str = Field(default="", max_length=1000)
    language: str = Field(default="zh", min_length=2, max_length=16)
    sample_rate: int = Field(default=48000, ge=16000, le=48000)
    format: Literal["wav", "mp3"] = "wav"


def _estimated_duration_sec(text: str) -> float:
    chars = max(1, len(str(text or "").strip()))
    return max(1.0, round(chars / 6.5, 2))


def _build_silent_wav_bytes(duration_sec: float, sample_rate: int) -> bytes:
    frames = int(max(1, duration_sec) * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        silence = struct.pack("<h", 0)
        chunk = silence * min(frames, 4096)
        remaining = frames
        while remaining > 0:
            take = min(remaining, 4096)
            handle.writeframes(chunk[: take * 2])
            remaining -= take
    return buffer.getvalue()


def _write_fake_audio(output_path: Path, text: str, sample_rate: int) -> float:
    duration_sec = _estimated_duration_sec(text)
    output_path.write_bytes(_build_silent_wav_bytes(duration_sec, sample_rate))
    return duration_sec


def _ensure_model():
    global _MODEL
    global _MODEL_ERROR
    if _MODEL is not None:
        return _MODEL

    try:
        from voxcpm import VoxCPM  # type: ignore
        from voxcpm import VoxCPM2  # type: ignore
    except Exception as exc:  # noqa: BLE001
        _MODEL_ERROR = f"voxcpm import failed: {exc}"
        if FAKE_MODE:
            return None
        raise RuntimeError(_MODEL_ERROR) from exc

    try:
        if MODEL_NAME.lower() == "voxcpm2":
            _MODEL = VoxCPM2.from_pretrained("openbmb/VoxCPM2")
        else:
            _MODEL = VoxCPM.from_pretrained("openbmb/VoxCPM-0.5B")
        _MODEL_ERROR = ""
        return _MODEL
    except Exception as exc:  # noqa: BLE001
        _MODEL_ERROR = f"voxcpm load failed: {exc}"
        if FAKE_MODE:
            return None
        raise RuntimeError(_MODEL_ERROR) from exc


def _resolve_reference_path(raw_path: str) -> Path:
    path = Path(str(raw_path or "").strip())
    if path.is_absolute():
        return path
    return (REFERENCE_DIR / path).resolve()


@app.get("/health")
@app.get("/healthz")
async def healthz():
    model = _ensure_model()
    return {
        "ok": True,
        "service": "voxcpm-service",
        "model_loaded": model is not None,
        "fake_mode": FAKE_MODE,
        "model_name": MODEL_NAME,
        "device": DEVICE,
        "model_error": _MODEL_ERROR or None,
        "clone_enabled": ENABLE_CLONE,
    }


@app.post("/v1/tts/synthesize")
async def synthesize(body: TtsSynthesizeRequest):
    _ensure_model()
    output_path = OUTPUT_DIR / f"tts_{uuid4().hex[:12]}.wav"

    try:
        # Phase 1 keeps fake mode as the local/dev fallback.
        # Replace this block with the real VoxCPM inference API once the model
        # weights and runtime are available in the target environment.
        duration_sec = _write_fake_audio(output_path, body.text, body.sample_rate)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"synthesize_failed: {exc}") from exc

    return {
        "ok": True,
        "audio_path": str(output_path),
        "duration_sec": duration_sec,
        "sample_rate": body.sample_rate,
        "provider": "voxcpm",
        "mode": "synthesize",
        "fake_mode": FAKE_MODE,
    }


@app.post("/v1/tts/clone")
async def clone(body: TtsCloneRequest):
    if not ENABLE_CLONE:
        raise HTTPException(status_code=403, detail="clone_disabled")

    _ensure_model()
    reference_path = _resolve_reference_path(body.reference_audio_path)
    if not reference_path.exists():
        raise HTTPException(status_code=404, detail="reference_audio_not_found")

    output_path = OUTPUT_DIR / f"clone_{uuid4().hex[:12]}.wav"
    try:
        duration_sec = _write_fake_audio(output_path, body.text, body.sample_rate)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"clone_failed: {exc}") from exc

    return {
        "ok": True,
        "audio_path": str(output_path),
        "duration_sec": duration_sec,
        "sample_rate": body.sample_rate,
        "provider": "voxcpm",
        "mode": "clone",
        "fake_mode": FAKE_MODE,
        "reference_audio_path": str(reference_path),
    }
