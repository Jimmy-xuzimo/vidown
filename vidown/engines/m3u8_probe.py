"""M3U8 / HLS / DASH 探测模块。

负责解析 m3u8 主清单，提取码率、分辨率、编码格式等信息，
生成统一的 VideoInfo / FormatInfo 模型。
"""

from __future__ import annotations

import os
from typing import Dict, List, Tuple
from urllib.parse import urljoin, urlparse

from ..core.config import Config
from ..core.logger import get_logger
from ..core.models import FormatInfo, MediaKind, Platform, VideoInfo
from ..core.network import http_get_text
from .base import EngineContext

logger = get_logger("engines.m3u8.probe")


class M3U8Probe:
    """M3U8 媒体探测器。"""

    def __init__(self, config: Config):
        self.config = config

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        """解析 m3u8 主清单，提取码率/分辨率。"""
        info = VideoInfo(
            url=url,
            webpage_url=url,
            platform=Platform.M3U8 if ".m3u8" in url.lower() else Platform.DASH,
            kind=MediaKind.VIDEO,
            title=self._guess_title_from_url(url),
        )
        try:
            variants = self._parse_master_playlist(url, ctx)
        except Exception as e:
            logger.debug(f"解析主清单失败，回退为基础信息: {e}")
            variants = []
        info.formats = variants
        if not variants:
            # 至少放一个表示主流的虚拟 FormatInfo
            info.formats.append(
                FormatInfo(
                    format_id="auto",
                    ext="mp4",
                    resolution="?",
                    vcodec="unknown",
                    acodec="unknown",
                    tbr=0,
                    protocol="m3u8",
                )
            )
        return info

    def _parse_master_playlist(self, url: str, ctx: EngineContext) -> List[FormatInfo]:
        """解析 m3u8 master playlist，提取各码率。"""
        text = http_get_text(
            url,
            self.config,
            timeout=(self.config.network.connect_timeout, self.config.network.read_timeout),
        )

        formats: List[FormatInfo] = []
        # 简单解析 EXT-X-STREAM-INF
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("#EXT-X-STREAM-INF:"):
                attrs = self._parse_stream_inf_attrs(line)
                uri = lines[i + 1].strip() if i + 1 < len(lines) else ""
                if not uri:
                    continue
                variant_url = self._resolve_url(url, uri)
                bandwidth = float(attrs.get("BANDWIDTH", 0)) / 1000.0  # kbps
                res = attrs.get("RESOLUTION", "")
                codecs = attrs.get("CODECS", "")
                w, h = 0, 0
                if "x" in res:
                    try:
                        parts = res.split("x")
                        w, h = int(parts[0]), int(parts[1])
                    except (ValueError, IndexError):
                        w, h = 0, 0
                vcodec, acodec = self._split_codecs(codecs)
                formats.append(
                    FormatInfo(
                        format_id=f"m3u8-{int(bandwidth)}",
                        ext="mp4",
                        resolution=res,
                        width=w or None,
                        height=h or None,
                        vcodec=vcodec,
                        acodec=acodec,
                        tbr=bandwidth,
                        vbr=bandwidth,
                        protocol="m3u8",
                        extra={"variant_url": variant_url},
                    )
                )
        return formats

    @staticmethod
    def _parse_stream_inf_attrs(line: str) -> Dict[str, str]:
        attrs = {}
        body = line.split(":", 1)[1]
        for part in body.split(","):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            attrs[k.strip().upper()] = v.strip().strip('"')
        return attrs

    @staticmethod
    def _split_codecs(codecs: str) -> Tuple[str, str]:
        """从 CODECS="avc1.640028,mp4a.40.2" 拆分出 vcodec / acodec。"""
        if not codecs:
            return "avc1", "mp4a"
        items = [c.strip() for c in codecs.split(",")]
        vcodec, acodec = "none", "none"
        for c in items:
            low = c.lower()
            if low.startswith(("avc1", "hvc1", "hev1", "av01", "vp09")):
                vcodec = c
            elif low.startswith(("mp4a", "opus", "ec-3", "ac-3")):
                acodec = c
        return vcodec, acodec

    @staticmethod
    def _resolve_url(base: str, ref: str) -> str:
        return urljoin(base, ref)

    @staticmethod
    def _guess_title_from_url(url: str) -> str:
        p = urlparse(url)
        return os.path.basename(p.path) or p.netloc or "m3u8"
