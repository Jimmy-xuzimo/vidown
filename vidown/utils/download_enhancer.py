"""下载增强器：M3U8 自动发现 / 页面 Network 抓取 / SponsorBlock 等。

该模块为可选增强，当 yt-dlp 失败时可作为「深度页面分析」的回退。
"""

from __future__ import annotations

import re
from typing import List, Optional, Set
from urllib.parse import urljoin, urlparse

import requests

from ..core.config import Config
from ..core.logger import get_logger
from ..core.platform_detect import classify_url, Platform

logger = get_logger("utils.enhance")


# 在页面源码中匹配 m3u8 / mpd 链接
_M3U8_PATTERNS = [
    re.compile(r"['\"](https?://[^'\"\s]+\.m3u8[^'\"\s]*)", re.IGNORECASE),
    re.compile(r"['\"](/[^'\"\s]+\.m3u8[^'\"\s]*)", re.IGNORECASE),
    re.compile(r"['\"](https?://[^'\"\s]+/manifest[^\s'\"']*?\.m3u8[^\s'\"']*)", re.IGNORECASE),
    re.compile(r"['\"](https?://[^'\"\s]+/playlist\.m3u8[^\s'\"']*)", re.IGNORECASE),
]
_MPD_PATTERNS = [
    re.compile(r"['\"](https?://[^'\"\s]+\.mpd[^'\"\s]*)", re.IGNORECASE),
    re.compile(r"['\"](/[^'\"\s]+\.mpd[^'\"\s]*)", re.IGNORECASE),
]
_IFRAME_PATTERNS = [
    re.compile(r'<iframe[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE),
]
_VIDEO_SRC_PATTERNS = [
    re.compile(r'<video[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<source[^>]+src=["\']([^"\']+\.(?:mp4|m3u8)[^"\']*)["\']', re.IGNORECASE),
]


class DownloadEnhancer:
    """静态页面分析器，提取可能被 yt-dlp 漏掉的 m3u8 / mpd / 直链。"""

    def __init__(self, config: Config):
        self.config = config

    def fetch(self, url: str) -> str:
        proxies = (
            {"http": self.config.network.proxy, "https": self.config.network.proxy}
            if self.config.network.proxy else None
        )
        resp = requests.get(
            url,
            timeout=self.config.network.connect_timeout,
            headers={"User-Agent": self.config.network.user_agent},
            proxies=proxies,
        )
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text

    def discover_playlists(
        self, page_url: str, html: Optional[str] = None
    ) -> List[str]:
        """从页面中找出 m3u8 / mpd / video 源 URL 列表。"""
        try:
            html = html or self.fetch(page_url)
        except Exception as e:
            logger.debug(f"无法抓取页面 {page_url}: {e}")
            return []

        found: Set[str] = set()
        for pattern in _M3U8_PATTERNS:
            for m in pattern.findall(html):
                found.add(self._abs(page_url, m))
        for pattern in _MPD_PATTERNS:
            for m in pattern.findall(html):
                found.add(self._abs(page_url, m))
        for pattern in _VIDEO_SRC_PATTERNS:
            for m in pattern.findall(html):
                found.add(self._abs(page_url, m))

        # iframe 递归 1 层
        for pattern in _IFRAME_PATTERNS:
            for m in pattern.findall(html):
                full = self._abs(page_url, m)
                platform_enum, _ = classify_url(full)
                if platform_enum != Platform.UNKNOWN:
                    found.add(full)

        # 按可信度排序：m3u8 > mpd > video
        ordered = sorted(
            found,
            key=lambda u: (
                0 if ".m3u8" in u else 1 if ".mpd" in u else 2,
                len(u),
            ),
        )
        return ordered

    @staticmethod
    def _abs(base: str, ref: str) -> str:
        if ref.startswith(("http://", "https://")):
            return ref
        return urljoin(base, ref)

    def extract_m3u8_from_url(self, url: str) -> List[str]:
        """最外层包装：返回该页面所有可能的 m3u8 链接。"""
        return [u for u in self.discover_playlists(url) if ".m3u8" in u.lower()]
