"""
Vidown —— 通用视频下载器
~~~~~~~~~~~~~~~~~~~~~~~~~~
类 Downie4 的全能流媒体下载工具，集成 yt-dlp / N_m3u8DL-RE / FFmpeg，
支持自动平台识别、H.264 强制转码、批量下载、断点续传、剪贴板监听。

入口：
    - CLI:     python -m vidown <URL> [选项]
    - GUI:     python -m vidown gui [--host 127.0.0.1] [--port 8765]
"""

from __future__ import annotations

__version__ = "0.1.0"
__author__ = "Vidown Contributors"
__license__ = "MIT"

__all__ = ["__version__", "__author__", "__license__"]
