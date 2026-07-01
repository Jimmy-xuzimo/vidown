"""测试：格式选择器。"""

from __future__ import annotations


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
        info = _info(
            [
                _format("a", 720, vcodec="h264"),
                _format("b", 1080, vcodec="h264"),
                _format("c", 2160, vcodec="h264"),
                _format("d", 1080, vcodec="hevc"),
            ]
        )
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        # 测试 fixtures 的格式都自带 aac，没有真正的独立 audio 流。
        # 应当作为单流返回（sel.single），而不是拆分为 video+audio。
        assert sel.single is not None
        assert sel.single.format_id == "c"
        assert sel.video is None
        assert sel.audio is None

    def test_h264_only_excludes_hevc(self):
        info = _info(
            [
                _format("a", 720, vcodec="h264"),
                _format("b", 2160, vcodec="hevc"),
                _format("c", 1080, vcodec="av1"),
            ]
        )
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        # 同上：fixture 自带 aac，应当走单流分支
        assert sel.single is not None
        assert sel.single.format_id == "a"
        assert sel.video is None

    def test_resolution_cap(self):
        info = _info(
            [
                _format("a", 720, vcodec="h264"),
                _format("b", 1080, vcodec="h264"),
                _format("c", 2160, vcodec="h264"),
            ]
        )
        q = QualityConfig(force_codec="h264", max_resolution=1080)
        sel = select_formats(info, q)
        # 单流分支
        assert sel.single is not None
        assert sel.single.height == 1080
        assert sel.single.format_id == "b"

    def test_explicit_1080p(self):
        info = _info(
            [
                _format("a", 720, vcodec="h264"),
                _format("b", 1080, vcodec="h264"),
                _format("c", 2160, vcodec="h264"),
            ]
        )
        q = QualityConfig(force_codec="h264", preference="1080p")
        sel = select_formats(info, q)
        # 单流分支
        assert sel.single is not None
        assert sel.single.height <= 1080

    def test_separate_video_and_audio_streams(self):
        """当存在真正独立的 video-only / audio-only 流时，应返回 video + audio。"""
        info = _info(
            [
                _format("v1", 1080, vcodec="h264", acodec="none"),
                _format("v2", 2160, vcodec="h264", acodec="none"),
                _format("a1", 0, vcodec="none", acodec="aac", tbr=300),
                _format("a2", 0, vcodec="none", acodec="aac", tbr=192),
            ]
        )
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        # 真正独立的双流
        assert sel.single is None
        assert sel.video is not None
        assert sel.video.format_id == "v2"
        assert sel.audio is not None
        assert sel.audio.format_id == "a1"
        assert sel.needs_merge is True

    def test_selects_audio(self):
        info = _info(
            [
                _format("v1", 1080, vcodec="h264", acodec="none"),
                _format("a1", 0, vcodec="none", acodec="aac", tbr=300),
            ]
        )
        q = QualityConfig(force_codec="h264")
        sel = select_formats(info, q)
        assert sel.video.format_id == "v1"
        assert sel.audio is not None
        assert sel.audio.format_id == "a1"

    def test_no_formats(self):
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
