"""核心数据模型定义。"""

from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional


# ----------------------------------------------------------------------
# 枚举
# ----------------------------------------------------------------------

class DownloadStatus(str, enum.Enum):
    PENDING = "pending"
    PROBING = "probing"          # 解析链接中
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    POSTPROCESSING = "postprocessing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"
    SKIPPED = "skipped"           # DRM 限制等


class Platform(str, enum.Enum):
    UNKNOWN = "unknown"
    YOUTUBE = "youtube"
    BILIBILI = "bilibili"
    DOUYIN = "douyin"
    TIKTOK = "tiktok"
    TWITTER = "twitter"
    X = "x"
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    VIMEO = "vimeo"
    TWITCH = "twitch"
    NETFLIX = "netflix"
    YOUKU = "youku"
    IQIYI = "iqiyi"
    TENCENT = "tencent"
    MANGETV = "mangetv"
    M3U8 = "m3u8"               # 通用 HLS 流
    DASH = "dash"               # 通用 DASH 流
    DIRECT = "direct"           # 直链 .mp4/.webm 等
    IMAGE = "image"             # gallery-dl 类型


class MediaKind(str, enum.Enum):
    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"
    PLAYLIST = "playlist"


# ----------------------------------------------------------------------
# 基础结构
# ----------------------------------------------------------------------

@dataclass
class FormatInfo:
    """单个可下载格式的描述。"""
    format_id: str
    ext: str
    resolution: str = ""                # 例如 "1920x1080"
    width: Optional[int] = None
    height: Optional[int] = None
    vcodec: str = "none"
    acodec: str = "none"
    vbr: float = 0.0                    # video bitrate (kbps)
    abr: float = 0.0                    # audio bitrate (kbps)
    fps: Optional[float] = None
    tbr: float = 0.0                    # 总码率
    filesize: Optional[int] = None
    filesize_approx: Optional[int] = None
    format_note: str = ""
    protocol: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VideoInfo:
    """链接解析后的元数据。"""
    url: str
    platform: Platform = Platform.UNKNOWN
    kind: MediaKind = MediaKind.VIDEO
    title: str = ""
    uploader: str = ""
    uploader_id: str = ""
    duration: Optional[int] = None       # 秒
    description: str = ""
    thumbnail: str = ""
    webpage_url: str = ""
    upload_date: str = ""
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    tags: List[str] = field(default_factory=list)
    formats: List[FormatInfo] = field(default_factory=list)
    subtitles: Dict[str, List[str]] = field(default_factory=dict)
    chapters: List[Dict[str, Any]] = field(default_factory=list)
    is_live: bool = False
    is_drm: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def best_height(self) -> Optional[int]:
        heights = [f.height for f in self.formats if f.height]
        return max(heights) if heights else None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["platform"] = self.platform.value
        data["kind"] = self.kind.value
        return data


@dataclass
class TaskProgress:
    """实时进度信息。"""
    downloaded_bytes: int = 0
    total_bytes: Optional[int] = None
    speed_bps: float = 0.0
    eta_seconds: Optional[int] = None
    percent: float = 0.0
    fragment_index: int = 0
    fragment_count: int = 0
    state: str = "init"                # init / downloading / finished / error

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DownloadTask:
    """一个下载任务的完整状态。"""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    url: str = ""
    title: str = ""
    platform: Platform = Platform.UNKNOWN
    kind: MediaKind = MediaKind.VIDEO
    status: DownloadStatus = DownloadStatus.PENDING
    progress: TaskProgress = field(default_factory=TaskProgress)
    output_path: Optional[str] = None
    selected_format_id: Optional[str] = None
    selected_resolution: Optional[str] = None
    selected_codec: str = "h264"
    error_message: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    engine_used: str = ""
    info: Optional[VideoInfo] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def duration(self) -> Optional[float]:
        if self.started_at and self.finished_at:
            return self.finished_at - self.started_at
        return None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        data["platform"] = self.platform.value
        data["kind"] = self.kind.value
        if self.info:
            data["info"] = self.info.to_dict()
        return data
