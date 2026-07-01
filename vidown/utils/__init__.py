"""工具子包。"""

from .clipboard import ClipboardWatcher
from .download_enhancer import DownloadEnhancer
from .system import (
    detect_platform,
    install_ffmpeg_instructions,
    install_ytdlp_instructions,
)

__all__ = [
    "ClipboardWatcher",
    "DownloadEnhancer",
    "detect_platform",
    "install_ffmpeg_instructions",
    "install_ytdlp_instructions",
]
