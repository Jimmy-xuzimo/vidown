"""Vidown 异常体系。"""

from __future__ import annotations


class VidownError(Exception):
    """所有 Vidown 异常的基类。"""


# ----------------------------------------------------------------------
# 引擎与执行
# ----------------------------------------------------------------------


class EngineError(VidownError):
    """某个下载引擎（yt-dlp / N_m3u8DL-RE / FFmpeg ...）执行失败。"""


class EngineNotAvailableError(EngineError):
    """引擎未安装、未配置或当前环境不可用。"""


class BinaryNotFoundError(EngineError):
    """需要的外部二进制（ffmpeg / N_m3u8DL-RE / you-get ...）未找到。"""


# ----------------------------------------------------------------------
# 网络
# ----------------------------------------------------------------------


class NetworkError(VidownError):
    """底层网络请求错误（非 HTTP 200 / 连接超时 / DNS 失败等）。"""


class ConnectionTimeoutError(NetworkError):
    """建立连接超时。"""


class ReadTimeoutError(NetworkError):
    """读取响应数据超时。"""


class HTTPStatusError(NetworkError):
    """HTTP 响应状态码表示失败。"""

    def __init__(self, message: str, status_code: int = 0, url: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.url = url


class DNSResolveError(NetworkError):
    """DNS 解析失败。"""


class ProxyError(NetworkError):
    """代理连接或配置错误。"""


# ----------------------------------------------------------------------
# 内容与格式
# ----------------------------------------------------------------------


class FormatNotFoundError(VidownError):
    """未找到匹配用户质量偏好的格式。"""


class PlaylistExtractionError(VidownError):
    """播放列表解析失败。"""


class SubtitleError(VidownError):
    """字幕提取/处理失败。"""


# ----------------------------------------------------------------------
# 限制与资源
# ----------------------------------------------------------------------


class DRMRestrictedError(VidownError):
    """检测到 DRM 保护（如 Widevine/PlayReady），无法直接下载。"""


class GeoBlockedError(VidownError):
    """资源因地理限制不可用。"""


class AgeRestrictedError(VidownError):
    """资源受年龄限制。"""


class InsufficientDiskSpaceError(VidownError):
    """磁盘空间不足。"""


# ----------------------------------------------------------------------
# 外部依赖与配置
# ----------------------------------------------------------------------


class FFmpegNotFoundError(BinaryNotFoundError):
    """未在系统中找到 ffmpeg/ffprobe 可执行文件。"""


class ConfigError(VidownError):
    """配置文件解析或校验失败。"""


# ----------------------------------------------------------------------
# 用户交互
# ----------------------------------------------------------------------


class UserCancelledError(VidownError):
    """用户主动取消下载/转码。"""


def classify_request_exception(exc: Exception, url: str = "") -> NetworkError:
    """将 requests 异常转换为具体的 NetworkError 子类。

    返回异常实例（不主动抛出），方便调用方统一处理。
    """
    import requests  # type: ignore

    if isinstance(exc, requests.exceptions.ConnectTimeout):
        return ConnectionTimeoutError(f"连接超时: {url or exc}")
    if isinstance(exc, requests.exceptions.ReadTimeout):
        return ReadTimeoutError(f"读取超时: {url or exc}")
    if isinstance(exc, requests.exceptions.ProxyError):
        return ProxyError(f"代理错误: {url or exc}")
    if isinstance(exc, requests.exceptions.ConnectionError):
        msg = str(exc).lower()
        if "name or service not known" in msg or "getaddrinfo" in msg:
            return DNSResolveError(f"DNS 解析失败: {url or exc}")
        return NetworkError(f"连接失败: {url or exc}")
    if isinstance(exc, requests.exceptions.HTTPError):
        status = exc.response.status_code if exc.response is not None else 0
        return HTTPStatusError(f"HTTP {status}: {url or exc}", status_code=status, url=url)
    return NetworkError(f"网络请求失败: {url or exc}")
