"""FFmpeg 探针封装。"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional


@dataclass
class MediaInfo:
    """ffprobe 返回的精简媒体信息。"""

    path: str
    duration: Optional[float] = None
    bit_rate: Optional[int] = None
    format_name: str = ""
    format_long_name: str = ""
    size: int = 0
    video_streams: List[Dict[str, Any]] = None
    audio_streams: List[Dict[str, Any]] = None
    subtitle_streams: List[Dict[str, Any]] = None

    def __post_init__(self):
        self.video_streams = self.video_streams or []
        self.audio_streams = self.audio_streams or []
        self.subtitle_streams = self.subtitle_streams or []

    @property
    def has_video(self) -> bool:
        return bool(self.video_streams)

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_streams)

    @property
    def width(self) -> Optional[int]:
        if self.video_streams:
            return self.video_streams[0].get("width")
        return None

    @property
    def height(self) -> Optional[int]:
        if self.video_streams:
            return self.video_streams[0].get("height")
        return None

    @property
    def vcodec(self) -> str:
        if self.video_streams:
            return self.video_streams[0].get("codec_name", "")
        return ""

    @property
    def acodec(self) -> str:
        if self.audio_streams:
            return self.audio_streams[0].get("codec_name", "")
        return ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def probe_media(path: str, ffprobe_bin: str = "ffprobe") -> MediaInfo:
    """使用 ffprobe 探测媒体信息。"""
    cmd = [
        ffprobe_bin,
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe 调用失败: {proc.stderr}")
    data = json.loads(proc.stdout or "{}")
    fmt = data.get("format", {}) or {}
    streams = data.get("streams", []) or []
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    subtitle_streams = [s for s in streams if s.get("codec_type") == "subtitle"]

    info = MediaInfo(
        path=path,
        duration=_safe_float(fmt.get("duration")),
        bit_rate=_safe_int(fmt.get("bit_rate")),
        format_name=fmt.get("format_name", ""),
        format_long_name=fmt.get("format_long_name", ""),
        size=_safe_int(fmt.get("size")),
        video_streams=video_streams,
        audio_streams=audio_streams,
        subtitle_streams=subtitle_streams,
    )
    return info


def _safe_int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _safe_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None
