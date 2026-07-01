"""测试：格式选择器。"""

from __future__ import annotations

import pytest

from vidown.core.models import FormatInfo, VideoInfo, Platform
from vidown.core.config import QualityConfig
from vidown.core.format_selector import select_formats, build_ytdlp_format_string


def _format(fmt_id, height, vcodec="h264", acodec="aac", tbr=1000, **kw):
    return FormatInfo(
        format_id=fmt_id,
        ext="mp4",
        height=height,
        width=height * 16 // 9 if height else None,
        resolution=f"{height*16//9}x{height}" if height else "",
        vcodec=vcodec,
        acodec=acodec,
        tbr=tbr,
        vbr=tbr,
        abr=128,
        **kw,
    )


def _info(formats):
    return VideoInfo(
        url="https://example.com",
        platform=Platform.YOUTUBE,
        formats=formats,
    )


class TestSelectFormats:
    def test_picks_highest_h264(self):
        info = _info([
            _format("a", 720, vcodec="h264"),
            _format("b", 1080, vcodec="h264"),
            _format("c", 2160, vcodec="h264"),
            _format("d", 1080, vcodec="hevc"),
        ])
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        assert sel.video.format_id == "c"

    def test_h264_only_excludes_hevc(self):
        info = _info([
            _format("a", 720, vcodec="h264"),
            _format("b", 2160, vcodec="hevc"),
            _format("c", 1080, vcodec="av1"),
        ])
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        assert sel.video.format_id == "a"

    def test_resolution_cap(self):
        info = _info([
            _format("a", 720, vcodec="h264"),
            _format("b", 1080, vcodec="h264"),
            _format("c", 2160, vcodec="h264"),
        ])
        q = QualityConfig(force_codec="h264", max_resolution=1080)
        sel = select_formats(info, q)
        assert sel.video.height == 1080

    def test_explicit_1080p(self):
        info = _info([
            _format("a", 720, vcodec="h264"),
            _format("b", 1080, vcodec="h264"),
            _format("c", 2160, vcodec="h264"),
        ])
        q = QualityConfig(force_codec="h264", preference="1080p")
        sel = select_formats(info, q)
        assert sel.video.height <= 1080

    def test_selects_audio(self):
        info = _info([
            _format("v1", 1080, vcodec="h264", acodec="none"),
            _format("a1", 0, vcodec="none", acodec="aac", tbr=300),
        ])
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        assert sel.video.format_id == "v1"
        assert sel.audio is not None
        assert sel.audio.format_id == "a1"

    def test_no_formats(self):
        info = _info([])
        sel = select_formats(VideoInfo(url="x"), QualityConfig())
        assert sel.video is None


class TestBuildYtdlpFormatString:
    def test_default_best_h264(self):
        q = QualityConfig(force_codec="h264")
        s = build_ytdlp_format_string(q)
        assert "h26[45]" in s or "avc" in s.lower()

    def test_specific_resolution(self):
        q = QualityConfig(force_codec="h264", preference="1080p")
        s = build_ytdlp_format_string(q)
        assert "1080" in s
