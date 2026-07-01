"""平台检测与 URL 分类。"""

from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple
from urllib.parse import urlparse, parse_qs

from .models import Platform, MediaKind


# ----------------------------------------------------------------------
# 平台签名表
# ----------------------------------------------------------------------

# (host_substring, platform, kind)
_PLATFORM_SIGNATURES: List[Tuple[str, Platform, MediaKind]] = [
    # 视频平台
    ("youtube.com", Platform.YOUTUBE, MediaKind.VIDEO),
    ("youtu.be", Platform.YOUTUBE, MediaKind.VIDEO),
    ("youtube-nocookie.com", Platform.YOUTUBE, MediaKind.VIDEO),
    ("bilibili.com", Platform.BILIBILI, MediaKind.VIDEO),
    ("b23.tv", Platform.BILIBILI, MediaKind.VIDEO),
    ("douyin.com", Platform.DOUYIN, MediaKind.VIDEO),
    ("iesdouyin.com", Platform.DOUYIN, MediaKind.VIDEO),
    ("tiktok.com", Platform.TIKTOK, MediaKind.VIDEO),
    ("twitter.com", Platform.TWITTER, MediaKind.VIDEO),
    ("x.com", Platform.X, MediaKind.VIDEO),
    ("t.co", Platform.TWITTER, MediaKind.VIDEO),
    ("instagram.com", Platform.INSTAGRAM, MediaKind.VIDEO),
    ("facebook.com", Platform.FACEBOOK, MediaKind.VIDEO),
    ("fb.watch", Platform.FACEBOOK, MediaKind.VIDEO),
    ("vimeo.com", Platform.VIMEO, MediaKind.VIDEO),
    ("twitch.tv", Platform.TWITCH, MediaKind.VIDEO),
    ("netflix.com", Platform.NETFLIX, MediaKind.VIDEO),
    ("youku.com", Platform.YOUKU, MediaKind.VIDEO),
    ("iqiyi.com", Platform.IQIYI, MediaKind.VIDEO),
    ("iq.com", Platform.IQIYI, MediaKind.VIDEO),
    ("v.qq.com", Platform.TENCENT, MediaKind.VIDEO),
    ("mgtv.com", Platform.MANGETV, MediaKind.VIDEO),
]

# 直接后缀 / 内容类型
_DIRECT_VIDEO_EXTS = (".mp4", ".webm", ".mkv", ".mov", ".flv", ".avi", ".m4v")
_DIRECT_AUDIO_EXTS = (".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus")
_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")


_URL_RE = re.compile(r"https?://[^\s<>\"]+", re.IGNORECASE)


# ----------------------------------------------------------------------
# 工具函数
# ----------------------------------------------------------------------

def is_url(text: str) -> bool:
    if not text:
        return False
    text = text.strip()
    return bool(_URL_RE.match(text))


def normalize_url(text: str) -> str:
    """去除尾部标点和空白。"""
    text = text.strip()
    # 去掉结尾的常见标点（用户复制时常带）
    while text and text[-1] in ".,;:!?)]}\"'\u3002\uff1b\uff0c\uff01\uff1f\uff09\u3010\u3011":
        text = text[:-1]
    return text


def extract_urls(text: str) -> List[str]:
    """从一段文本中提取全部 URL。"""
    if not text:
        return []
    urls = _URL_RE.findall(text)
    return [normalize_url(u) for u in urls]


def classify_url(url: str) -> Tuple[Platform, MediaKind]:
    """根据 URL 判定平台与媒体类型。"""
    if not url:
        return Platform.UNKNOWN, MediaKind.VIDEO

    url_lower = url.lower()
    parsed = urlparse(url_lower)
    host = parsed.hostname or ""
    path = parsed.path or ""
    full = url_lower

    # 1. 平台签名优先
    for sig, platform, kind in _PLATFORM_SIGNATURES:
        if sig in host or sig in full:
            return platform, kind

    # 2. M3U8 / HLS
    if ".m3u8" in path or "m3u8" in full:
        return Platform.M3U8, MediaKind.VIDEO

    # 3. MPD / DASH
    if ".mpd" in path or "manifest" in full and ".mpd" in full:
        return Platform.DASH, MediaKind.VIDEO

    # 4. 直接视频/音频/图片
    for ext in _DIRECT_VIDEO_EXTS:
        if path.endswith(ext):
            return Platform.DIRECT, MediaKind.VIDEO
    for ext in _DIRECT_AUDIO_EXTS:
        if path.endswith(ext):
            return Platform.DIRECT, MediaKind.AUDIO
    for ext in _IMAGE_EXTS:
        if path.endswith(ext):
            return Platform.DIRECT, MediaKind.IMAGE

    return Platform.UNKNOWN, MediaKind.VIDEO


def filter_urls(
    texts: Iterable[str],
    kinds: Optional[List[MediaKind]] = None,
) -> List[str]:
    """从字符串/列表中筛出可下载的 URL。"""
    out: List[str] = []
    for t in texts:
        if not t:
            continue
        for u in extract_urls(t):
            platform, kind = classify_url(u)
            if platform == Platform.UNKNOWN:
                continue
            if kinds and kind not in kinds:
                continue
            out.append(u)
    # 去重保持顺序
    seen = set()
    uniq: List[str] = []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def detect_kind_from_path(url: str) -> MediaKind:
    _, kind = classify_url(url)
    return kind


def platform_display_name(platform: Platform) -> str:
    return {
        Platform.YOUTUBE: "YouTube",
        Platform.BILIBILI: "Bilibili",
        Platform.DOUYIN: "抖音",
        Platform.TIKTOK: "TikTok",
        Platform.TWITTER: "Twitter",
        Platform.X: "X (Twitter)",
        Platform.INSTAGRAM: "Instagram",
        Platform.FACEBOOK: "Facebook",
        Platform.VIMEO: "Vimeo",
        Platform.TWITCH: "Twitch",
        Platform.NETFLIX: "Netflix",
        Platform.YOUKU: "优酷",
        Platform.IQIYI: "爱奇艺",
        Platform.TENCENT: "腾讯视频",
        Platform.MANGETV: "芒果TV",
        Platform.M3U8: "HLS / M3U8",
        Platform.DASH: "DASH / MPD",
        Platform.DIRECT: "直链",
        Platform.IMAGE: "图片",
        Platform.UNKNOWN: "未知",
    }.get(platform, platform.value)
