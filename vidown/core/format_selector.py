"""格式选择与排序策略。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .models import FormatInfo, VideoInfo
from .config import QualityConfig

# ----------------------------------------------------------------------
# 评估函数
# ----------------------------------------------------------------------


def _is_h264(f: FormatInfo) -> bool:
    c = (f.vcodec or "").lower()
    if not c or c == "none":
        return False
    return any(k in c for k in ("h264", "avc", "h.264", "avc1"))


def _is_hevc(f: FormatInfo) -> bool:
    c = (f.vcodec or "").lower()
    return any(k in c for k in ("hevc", "h265", "h.265", "hvc1", "hev1"))


def _is_av1(f: FormatInfo) -> bool:
    return "av1" in (f.vcodec or "").lower()


def _is_vp9(f: FormatInfo) -> bool:
    return "vp9" in (f.vcodec or "").lower()


def _height(f: FormatInfo) -> int:
    if f.height:
        return int(f.height)
    if f.resolution and "x" in f.resolution:
        try:
            return int(f.resolution.split("x")[-1])
        except ValueError:
            return 0
    return 0


def _has_audio(f: FormatInfo) -> bool:
    a = (f.acodec or "").lower()
    return bool(a) and a != "none"


def _has_video(f: FormatInfo) -> bool:
    v = (f.vcodec or "").lower()
    return bool(v) and v != "none"


def _score_codec(f: FormatInfo, quality: QualityConfig) -> float:
    """编码偏好得分，越大越符合要求。"""
    if quality.force_codec.lower() == "h264" and _is_h264(f):
        return 1000
    if quality.force_codec.lower() in ("hevc", "h265") and _is_hevc(f):
        return 1000
    if quality.force_codec.lower() == "av1" and _is_av1(f):
        return 1000
    if quality.force_codec.lower() == "vp9" and _is_vp9(f):
        return 1000
    if (
        quality.force_codec.lower() == "h264"
        and not quality.allow_hevc
        and not quality.allow_av1
        and not quality.allow_vp9
    ):
        # 拒绝非允许的编码
        if _is_hevc(f) or _is_av1(f) or _is_vp9(f):
            return -1000
    return 0


@dataclass
class SelectionResult:
    """格式选择结果。"""

    video: Optional[FormatInfo] = None
    audio: Optional[FormatInfo] = None
    single: Optional[FormatInfo] = None
    reason: str = ""

    @property
    def needs_merge(self) -> bool:
        return self.video is not None and self.audio is not None and self.video is not self.audio


# ----------------------------------------------------------------------
# 主选择函数
# ----------------------------------------------------------------------


def select_formats(
    info: VideoInfo,
    quality: QualityConfig,
    prefer_separate: bool = True,
) -> SelectionResult:
    """根据质量偏好从 formats 列表挑选最佳视频+音频（或单条流）。"""
    formats = list(info.formats)
    if not formats:
        return SelectionResult(reason="无可用格式")

    # 过滤掉纯图片/纯音频且无视频的格式（用户期望视频）
    videos = [f for f in formats if _has_video(f)]
    audios = [f for f in formats if _has_audio(f) and not _has_video(f)]

    # 分辨率过滤
    if quality.min_resolution:
        videos = [f for f in videos if _height(f) >= quality.min_resolution]

    # 偏好最高 / 特定分辨率
    if quality.preference != "best":
        target_h = {
            "8k": 4320,
            "2160p": 2160,
            "4k": 2160,
            "1440p": 1440,
            "2k": 1440,
            "1080p": 1080,
            "720p": 720,
            "480p": 480,
            "360p": 360,
        }.get(quality.preference.lower())
        if target_h:
            # 选择不超过目标的最高分辨率
            videos = [f for f in videos if _height(f) <= target_h]

    # 应用 max_resolution 上限
    if quality.max_resolution:
        videos = [f for f in videos if _height(f) <= quality.max_resolution]

    if not videos:
        return SelectionResult(reason="无满足质量约束的视频格式")

    # 评分：编码偏好 + 分辨率 + 码率
    def _score(f: FormatInfo) -> float:
        return _score_codec(f, quality) + float(_height(f)) + (f.tbr or f.vbr or 0) / 100.0

    videos.sort(key=_score, reverse=True)
    audios.sort(key=lambda f: (f.abr or f.tbr or 0), reverse=True)

    best_video = videos[0]
    best_audio = audios[0] if audios else None

    # 如果 best_audio 和 best_video 其实是同一条流（即没有独立音频轨道），
    # 不要把它当作需要合并的两条流。
    if best_audio is best_video:
        best_audio = None

    # 如果 best_video 自身已含音频且非 video-only，优先单文件
    if _has_audio(best_video) and not prefer_separate:
        return SelectionResult(single=best_video, reason="单流 (含音频)")

    # 如果无独立音频而 best_video 含音频，走单流
    if not best_audio and _has_audio(best_video):
        return SelectionResult(single=best_video, reason="单流 (含音频)")

    return SelectionResult(
        video=best_video,
        audio=best_audio,
        reason=f"video={best_video.format_id}, audio={best_audio.format_id if best_audio else 'none'}",
    )


def build_ytdlp_format_string(quality: QualityConfig) -> str:
    """生成 yt-dlp 的 format 选择表达式。"""
    pref = (quality.preference or "best").lower()
    if quality.force_codec.lower() == "h264":
        # 强制 H.264 输出
        if pref == "best":
            return "bv*[vcodec~='^((he|a)vc|h26[45])']+ba/bv*+ba/b"
        # 指定分辨率
        target_h = {
            "8k": 4320,
            "2160p": 2160,
            "4k": 2160,
            "1440p": 1440,
            "2k": 1440,
            "1080p": 1080,
            "720p": 720,
            "480p": 480,
            "360p": 360,
        }.get(pref)
        if target_h:
            return (
                f"bv*[vcodec~='^((he|a)vc|h26[45])'][height<={target_h}]+ba/"
                f"bv*[height<={target_h}]+ba/b"
            )
    return "bestvideo*+bestaudio/best"
