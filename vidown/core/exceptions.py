"""Vidown 异常体系。"""

from __future__ import annotations


class VidownError(Exception):
    """所有 Vidown 异常的基类。"""


class EngineError(VidownError):
    """某个下载引擎（yt-dlp / N_m3u8DL-RE / FFmpeg ...）执行失败。"""


class NetworkError(VidownError):
    """底层网络请求错误（非 HTTP 200 / 连接超时 / DNS 失败等）。"""


class FormatNotFoundError(VidownError):
    """未找到匹配用户质量偏好的格式。"""


class DRMRestrictedError(VidownError):
    """检测到 DRM 保护（如 Widevine/PlayReady），无法直接下载。"""


class FFmpegNotFoundError(VidownError):
    """未在系统中找到 ffmpeg/ffprobe 可执行文件。"""


class ConfigError(VidownError):
    """配置文件解析或校验失败。"""


class UserCancelledError(VidownError):
    """用户主动取消下载/转码。"""
