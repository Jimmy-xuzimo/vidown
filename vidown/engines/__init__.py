"""下载引擎抽象层。"""

from .base import BaseEngine, EngineRegistry, EngineCapability
from .ytdlp_engine import YtDlpEngine
from .m3u8_engine import M3U8Engine
from .direct_engine import DirectEngine
from .fallback_engines import (
    YouGetEngine,
    LuxEngine,
    GalleryDLEngine,
)

__all__ = [
    "BaseEngine",
    "EngineRegistry",
    "EngineCapability",
    "YtDlpEngine",
    "M3U8Engine",
    "DirectEngine",
    "YouGetEngine",
    "LuxEngine",
    "GalleryDLEngine",
]
