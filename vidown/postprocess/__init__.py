"""FFmpeg 后处理：合并、转码 H.264、嵌入元数据、字幕、缩略图。"""

from .ffmpeg_pipe import (
    FFmpegPipe,
    is_h264,
    transcode_to_h264,
    merge_streams,
    concat_segments,
    embed_thumbnail,
    embed_metadata,
    burn_subtitle,
    extract_subtitle,
    get_media_info,
)
from .probe import MediaInfo, probe_media

__all__ = [
    "FFmpegPipe",
    "is_h264",
    "transcode_to_h264",
    "merge_streams",
    "concat_segments",
    "embed_thumbnail",
    "embed_metadata",
    "burn_subtitle",
    "extract_subtitle",
    "get_media_info",
    "MediaInfo",
    "probe_media",
]
