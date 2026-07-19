"""性能测试：核心路径的耗时上限。"""

from __future__ import annotations

import time

from vidown.core.config import Config
from vidown.core.format_selector import select_formats
from vidown.core.models import FormatInfo, MediaKind, Platform, VideoInfo
from vidown.core.platform_detect import classify_url, extract_urls


class TestPerformance:
    def test_classify_url_under_ms(self):
        urls = [
            "https://www.youtube.com/watch?v=abc123",
            "https://www.bilibili.com/video/BV1xx",
            "https://soundcloud.com/artist/track",
            "https://example.com/video.m3u8",
            "rtmp://example.com/live/stream",
        ]
        start = time.perf_counter()
        for _ in range(1000):
            for url in urls:
                classify_url(url)
        elapsed = time.perf_counter() - start
        # 5000 次分类应在 100ms 内完成
        assert elapsed < 0.1

    def test_extract_urls_under_ms(self):
        text = (
            "看看这个 https://www.youtube.com/watch?v=abc "
            "和 https://www.bilibili.com/video/BV1xx "
            "以及 https://soundcloud.com/artist/track"
        )
        start = time.perf_counter()
        for _ in range(1000):
            extract_urls(text)
        elapsed = time.perf_counter() - start
        assert elapsed < 0.2

    def test_select_formats_under_ms(self):
        formats = [
            FormatInfo(
                format_id=f"fmt_{i}",
                ext="mp4",
                height=360 + i * 180,
                resolution=f"{640 + i * 320}x{360 + i * 180}",
                vcodec="h264",
                acodec="aac",
                tbr=1000 + i * 500,
            )
            for i in range(20)
        ]
        info = VideoInfo(
            url="https://example.com",
            platform=Platform.YOUTUBE,
            formats=formats,
        )
        cfg = Config()
        start = time.perf_counter()
        for _ in range(1000):
            select_formats(info, cfg.quality)
        elapsed = time.perf_counter() - start
        assert elapsed < 0.2

    def test_audio_select_formats_under_ms(self):
        formats = [
            FormatInfo(
                format_id=f"audio_{i}",
                ext="mp3",
                vcodec="none",
                acodec="mp3",
                abr=128 + i * 32,
                tbr=128 + i * 32,
            )
            for i in range(10)
        ]
        info = VideoInfo(
            url="https://soundcloud.com/artist/track",
            platform=Platform.SOUNDCLOUD,
            kind=MediaKind.AUDIO,
            formats=formats,
        )
        cfg = Config()
        start = time.perf_counter()
        for _ in range(1000):
            select_formats(info, cfg.quality, kind=MediaKind.AUDIO)
        elapsed = time.perf_counter() - start
        assert elapsed < 0.1
