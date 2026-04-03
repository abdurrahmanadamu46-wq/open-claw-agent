"""
VideoComposer — 云端视频合成引擎
====================================
灵感来源：MoneyPrinterTurbo app/services/video.py
借鉴要点：
  - SubClippedVideoClip 轻量包装，避免 MoviePy OOM
  - close_clip() 分层资源释放，防止文件句柄泄漏
  - VideoTransitionMode 枚举（Shuffle/FadeIn/FadeOut/SlideIn/SlideOut）
  - 素材裁剪→拼接→字幕叠加→BGM混音→转场特效→输出 MP4 完整流水线

⚠️ 架构铁律：
  本模块在「云端 visualizer 龙虾」中运行。
  合成完成后视频上传 OSS，由 dispatcher 生成 EdgeTaskBundle JSON 通知边缘层。
  边缘层（MarionetteExecutor）只做下载+发布，不做视频合成。

调用示例：
    from video_composer import VideoComposer, VideoComposerConfig, VideoTransitionMode, VideoAspect

    config = VideoComposerConfig(
        aspect=VideoAspect.portrait,
        transition=VideoTransitionMode.fade_in,
        font_path="resource/fonts/STHeitiLight.ttc",
        bgm_path="resource/songs/background01.mp3",
        subtitle_srt="resource/subtitle.srt",
        output_path="output/final.mp4",
    )
    composer = VideoComposer(config)
    result = composer.compose(clip_paths=["clip1.mp4", "clip2.mp4", "clip3.mp4"])
    print(result.output_path, result.duration_sec)
"""

from __future__ import annotations

import gc
import os
import random
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from loguru import logger

try:
    from media_cost_optimizer import MediaCostOptimizer, QualityTier
except Exception:
    MediaCostOptimizer = None  # type: ignore[assignment]
    QualityTier = None  # type: ignore[assignment]

# MoviePy 是可选依赖；如果未安装，VideoComposer 实例化时会抛出 ImportError
try:
    from moviepy import (
        AudioFileClip,
        ColorClip,
        CompositeAudioClip,
        CompositeVideoClip,
        TextClip,
        VideoFileClip,
        concatenate_videoclips,
        afx,
    )
    from moviepy.video.tools.subtitles import SubtitlesClip

    MOVIEPY_AVAILABLE = True
except ImportError:
    MOVIEPY_AVAILABLE = False
    logger.warning("MoviePy not installed. VideoComposer will not be functional.")


# ─────────────────────────────────────────────────────────────────
# 枚举：视频比例 / 转场模式（借鉴 MPT VideoAspect + VideoTransitionMode）
# ─────────────────────────────────────────────────────────────────

class VideoAspect(str, Enum):
    portrait = "9:16"    # 抖音/小红书竖屏
    landscape = "16:9"   # 横屏
    square = "1:1"       # 方形

    def to_resolution(self) -> tuple[int, int]:
        """返回 (width, height)"""
        mapping = {
            "9:16": (1080, 1920),
            "16:9": (1920, 1080),
            "1:1":  (1080, 1080),
        }
        return mapping[self.value]


class VideoTransitionMode(str, Enum):
    """借鉴 MPT VideoTransitionMode 枚举（Shuffle/FadeIn/FadeOut/SlideIn/SlideOut）"""
    none = "none"
    shuffle = "shuffle"     # 随机选一种
    fade_in = "fade_in"     # 淡入
    fade_out = "fade_out"   # 淡出
    slide_in = "slide_in"   # 滑入
    slide_out = "slide_out" # 滑出


# ─────────────────────────────────────────────────────────────────
# SubClippedVideoClip — 轻量视频片段包装
# 借鉴 MPT SubClippedVideoClip，避免 MoviePy 大文件 OOM
# ─────────────────────────────────────────────────────────────────

@dataclass
class SubClippedVideoClip:
    """
    轻量包装视频片段元信息（不提前加载到内存）。
    只在最终合成时才读取文件，减少峰值内存占用。
    """
    file_path: str
    start_time: float = 0.0
    end_time: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None

    @property
    def duration(self) -> float:
        if self.end_time is not None:
            return self.end_time - self.start_time
        return 0.0

    def __str__(self) -> str:
        return (
            f"SubClippedVideoClip(path={self.file_path}, "
            f"start={self.start_time:.1f}s, end={self.end_time}, "
            f"size={self.width}x{self.height})"
        )


# ─────────────────────────────────────────────────────────────────
# close_clip — 分层资源释放（借鉴 MPT close_clip）
# ─────────────────────────────────────────────────────────────────

def close_clip(clip: object) -> None:
    """
    安全释放 MoviePy clip 的全部资源（reader / audio / mask）。
    借鉴 MPT close_clip() 防止文件句柄泄漏。
    """
    if clip is None:
        return
    try:
        if hasattr(clip, "reader") and clip.reader is not None:
            clip.reader.close()
    except Exception:
        pass
    try:
        if hasattr(clip, "audio") and clip.audio is not None:
            if hasattr(clip.audio, "reader") and clip.audio.reader is not None:
                clip.audio.reader.close()
            del clip.audio
    except Exception:
        pass
    try:
        if hasattr(clip, "mask") and clip.mask is not None:
            if hasattr(clip.mask, "reader") and clip.mask.reader is not None:
                clip.mask.reader.close()
            del clip.mask
    except Exception:
        pass
    try:
        del clip
    except Exception:
        pass
    gc.collect()


# ─────────────────────────────────────────────────────────────────
# VideoComposerConfig — 合成配置（Pydantic-less，纯 dataclass）
# ─────────────────────────────────────────────────────────────────

@dataclass
class VideoComposerConfig:
    """云端视频合成配置，由 visualizer 龙虾填充后传入 VideoComposer。"""
    # 输出设置
    output_path: str = "output/final.mp4"
    aspect: VideoAspect = VideoAspect.portrait
    fps: int = 30
    video_codec: str = "libx264"
    audio_codec: str = "aac"

    # 转场
    transition: VideoTransitionMode = VideoTransitionMode.none
    transition_duration: float = 0.5  # 秒

    # 字幕（可选，.srt 文件路径）
    subtitle_srt: str = ""
    font_path: str = "resource/fonts/STHeitiLight.ttc"
    font_size: int = 60
    font_color: str = "white"
    stroke_color: str = "black"
    stroke_width: float = 1.5

    # BGM（可选）
    bgm_path: str = ""
    bgm_volume: float = 0.3   # 背景音乐音量（0-1）
    voice_volume: float = 1.0  # 口播音量

    # 口播音频（可选，.mp3 / .wav）
    voice_path: str = ""

    # 片头/片尾黑场（秒，0=不加）
    intro_duration: float = 0.0
    outro_duration: float = 0.0


# ─────────────────────────────────────────────────────────────────
# VideoComposerResult
# ─────────────────────────────────────────────────────────────────

@dataclass
class VideoComposerResult:
    output_path: str
    duration_sec: float
    width: int
    height: int
    file_size_mb: float
    ok: bool = True
    error: str = ""


# ─────────────────────────────────────────────────────────────────
# VideoComposer — 主合成引擎
# ─────────────────────────────────────────────────────────────────

class VideoComposer:
    """
    云端视频合成引擎，由 visualizer 龙虾调用。

    流水线：
      素材裁剪 → 转场特效 → 拼接 → 口播音频叠加
      → 字幕叠加 → BGM混音 → 片头/片尾 → 输出 MP4

    ⚠️ 输出完成后请调用 upload_to_oss() 并将 oss_url 交给 dispatcher。
    """

    def __init__(self, config: VideoComposerConfig) -> None:
        if not MOVIEPY_AVAILABLE:
            raise ImportError(
                "MoviePy is required for VideoComposer. "
                "Install it with: pip install moviepy pillow"
            )
        self.cfg = config
        self._width, self._height = config.aspect.to_resolution()
        self.optimizer = MediaCostOptimizer() if MediaCostOptimizer is not None else None

    def compose(self, clip_paths: list[str]) -> VideoComposerResult:
        """
        主合成入口。
        Args:
            clip_paths: 素材视频文件路径列表（已下载到云端临时目录）
        Returns:
            VideoComposerResult（含 output_path / duration_sec）
        """
        if not clip_paths:
            return VideoComposerResult(
                output_path="", duration_sec=0, width=0, height=0,
                file_size_mb=0, ok=False, error="clip_paths is empty"
            )

        Path(self.cfg.output_path).parent.mkdir(parents=True, exist_ok=True)
        clips: list = []

        try:
            # Step 1: 加载并裁剪素材
            clips = self._load_clips(clip_paths)
            logger.info("Loaded %d clips", len(clips))

            # Step 2: 添加转场特效
            clips = self._apply_transitions(clips)

            # Step 3: 拼接
            video = concatenate_videoclips(clips, method="compose")
            logger.info("Concatenated clips, total duration=%.1fs", video.duration)

            # Step 4: 叠加口播音频
            if self.cfg.voice_path and Path(self.cfg.voice_path).exists():
                video = self._overlay_voice(video)

            # Step 5: 叠加字幕
            if self.cfg.subtitle_srt and Path(self.cfg.subtitle_srt).exists():
                video = self._overlay_subtitle(video)

            # Step 6: 混合 BGM
            if self.cfg.bgm_path and Path(self.cfg.bgm_path).exists():
                video = self._mix_bgm(video)

            # Step 7: 片头/片尾黑场
            video = self._add_intro_outro(video)

            # Step 8: 输出
            logger.info("Writing to %s ...", self.cfg.output_path)
            video.write_videofile(
                self.cfg.output_path,
                fps=self.cfg.fps,
                codec=self.cfg.video_codec,
                audio_codec=self.cfg.audio_codec,
                logger=None,
            )

            duration = video.duration
            size_mb = os.path.getsize(self.cfg.output_path) / 1024 / 1024
            return VideoComposerResult(
                output_path=self.cfg.output_path,
                duration_sec=round(duration, 2),
                width=self._width,
                height=self._height,
                file_size_mb=round(size_mb, 2),
            )

        except Exception as e:
            logger.error("VideoComposer failed: %s", e)
            return VideoComposerResult(
                output_path="", duration_sec=0, width=0, height=0,
                file_size_mb=0, ok=False, error=str(e)
            )
        finally:
            # 严格资源释放（借鉴 MPT close_clip 模式）
            for c in clips:
                close_clip(c)
            gc.collect()

    def pick_video_generation_provider(
        self,
        *,
        quality: str = "standard",
        duration_seconds: int = 15,
        budget_remaining_pct: float = 1.0,
    ) -> dict[str, Any]:
        if self.optimizer is None or QualityTier is None:
            return {
                "provider": "seedance_2.0",
                "estimated_cost": round(duration_seconds * 1.0, 2),
                "quality_tier": quality,
                "optimizer_enabled": False,
            }
        provider = self.optimizer.select_video_provider(
            quality=QualityTier(str(quality).lower()),
            duration_seconds=duration_seconds,
            budget_remaining_pct=budget_remaining_pct,
        )
        return {
            "provider": provider.name,
            "estimated_cost": round(provider.cost_per_unit * duration_seconds, 2),
            "quality_tier": quality,
            "optimizer_enabled": True,
        }

    def pick_image_generation_provider(
        self,
        *,
        quality: str = "standard",
        count: int = 1,
        budget_remaining_pct: float = 1.0,
    ) -> dict[str, Any]:
        if self.optimizer is None or QualityTier is None:
            return {
                "provider": "imagen_4",
                "estimated_cost": round(count * 0.29, 2),
                "quality_tier": quality,
                "optimizer_enabled": False,
            }
        provider = self.optimizer.select_image_provider(
            quality=QualityTier(str(quality).lower()),
            count=count,
            budget_remaining_pct=budget_remaining_pct,
        )
        return {
            "provider": provider.name,
            "estimated_cost": round(provider.cost_per_unit * count, 2),
            "quality_tier": quality,
            "optimizer_enabled": True,
        }

    def estimate_generation_monthly_savings(self, seat_count: int) -> dict[str, Any]:
        if self.optimizer is None:
            return {
                "seat_count": int(seat_count or 0),
                "video": {"baseline_cost": 0, "optimized_cost": 0, "savings": 0, "savings_pct": 0},
                "image": {"baseline_cost": 0, "optimized_cost": 0, "savings": 0, "savings_pct": 0},
                "total_monthly_savings": 0,
                "total_annual_savings": 0,
            }
        return self.optimizer.estimate_monthly_cost(seat_count)

    # ── 私有方法 ──────────────────────────────────────────────────

    def _load_clips(self, paths: list[str]) -> list:
        """加载素材，统一裁剪为目标分辨率。"""
        result = []
        for p in paths:
            try:
                clip = VideoFileClip(p)
                # 裁剪/缩放到目标分辨率
                clip = clip.resized((self._width, self._height))
                result.append(clip)
                logger.debug("Loaded clip: %s (%.1fs)", p, clip.duration)
            except Exception as e:
                logger.warning("Skip clip %s: %s", p, e)
        return result

    def _apply_transitions(self, clips: list) -> list:
        """为每个片段添加转场特效（借鉴 MPT video_effects.py）。"""
        mode = self.cfg.transition
        t = self.cfg.transition_duration

        if mode == VideoTransitionMode.none or t <= 0:
            return clips

        result = []
        for clip in clips:
            try:
                if mode == VideoTransitionMode.shuffle:
                    chosen = random.choice([
                        VideoTransitionMode.fade_in,
                        VideoTransitionMode.fade_out,
                        VideoTransitionMode.slide_in,
                        VideoTransitionMode.slide_out,
                    ])
                else:
                    chosen = mode

                if chosen == VideoTransitionMode.fade_in:
                    clip = clip.fadein(t)
                elif chosen == VideoTransitionMode.fade_out:
                    clip = clip.fadeout(t)
                elif chosen == VideoTransitionMode.slide_in:
                    clip = clip.with_effects([__import__("moviepy").vfx.SlideIn(t, "left")])
                elif chosen == VideoTransitionMode.slide_out:
                    clip = clip.with_effects([__import__("moviepy").vfx.SlideOut(t, "right")])

                result.append(clip)
            except Exception as e:
                logger.warning("Transition failed for clip, using original: %s", e)
                result.append(clip)
        return result

    def _overlay_voice(self, video) -> object:
        """叠加口播音频。"""
        try:
            voice = AudioFileClip(self.cfg.voice_path)
            if self.cfg.voice_volume != 1.0:
                voice = voice.with_effects([afx.MultiplyVolume(self.cfg.voice_volume)])
            # 截断到视频长度
            voice = voice.subclipped(0, min(voice.duration, video.duration))
            if video.audio:
                audio = CompositeAudioClip([video.audio, voice])
            else:
                audio = voice
            return video.with_audio(audio)
        except Exception as e:
            logger.warning("Voice overlay failed: %s", e)
            return video

    def _overlay_subtitle(self, video) -> object:
        """叠加 SRT 字幕（借鉴 MPT SubtitlesClip 用法）。"""
        try:
            def make_text_clip(txt: str):
                return TextClip(
                    text=txt,
                    font=self.cfg.font_path,
                    font_size=self.cfg.font_size,
                    color=self.cfg.font_color,
                    stroke_color=self.cfg.stroke_color,
                    stroke_width=self.cfg.stroke_width,
                    method="caption",
                    size=(self._width, None),
                )

            subs = SubtitlesClip(self.cfg.subtitle_srt, make_text_clip)
            subs = subs.with_position(("center", "bottom"))
            return CompositeVideoClip([video, subs])
        except Exception as e:
            logger.warning("Subtitle overlay failed: %s", e)
            return video

    def _mix_bgm(self, video) -> object:
        """混合背景音乐（BGM 循环到视频长度，低音量混入）。"""
        try:
            bgm = AudioFileClip(self.cfg.bgm_path)
            # 循环 BGM 到视频长度
            if bgm.duration < video.duration:
                loops = int(video.duration / bgm.duration) + 1
                import itertools
                from moviepy import concatenate_audioclips
                bgm = concatenate_audioclips([bgm] * loops)
            bgm = bgm.subclipped(0, video.duration)
            bgm = bgm.with_effects([afx.MultiplyVolume(self.cfg.bgm_volume)])

            if video.audio:
                mixed = CompositeAudioClip([video.audio, bgm])
            else:
                mixed = bgm
            return video.with_audio(mixed)
        except Exception as e:
            logger.warning("BGM mix failed: %s", e)
            return video

    def _add_intro_outro(self, video) -> object:
        """添加片头/片尾黑场。"""
        clips = []
        if self.cfg.intro_duration > 0:
            intro = ColorClip(
                size=(self._width, self._height),
                color=(0, 0, 0),
                duration=self.cfg.intro_duration,
            )
            clips.append(intro)
        clips.append(video)
        if self.cfg.outro_duration > 0:
            outro = ColorClip(
                size=(self._width, self._height),
                color=(0, 0, 0),
                duration=self.cfg.outro_duration,
            )
            clips.append(outro)
        if len(clips) == 1:
            return video
        try:
            return concatenate_videoclips(clips, method="compose")
        except Exception as e:
            logger.warning("Intro/outro failed: %s", e)
            return video
