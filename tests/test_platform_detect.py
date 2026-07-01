"""测试：平台检测、URL 提取、格式选择。"""

from __future__ import annotations

import pytest

from vidown.core.platform_detect import (
    canonicalize_url,
    classify_url,
    extract_urls,
    filter_urls,
    is_url,
    normalize_url,
    platform_display_name,
    Platform,
    MediaKind,
)


class TestIsUrl:
    def test_http(self):
        assert is_url("http://example.com")

    def test_https(self):
        assert is_url("https://www.youtube.com/watch?v=abc123")

    def test_youtu_be(self):
        assert is_url("https://youtu.be/abc123")

    def test_invalid(self):
        assert not is_url("hello world")
        assert not is_url("")

    def test_with_trailing_punctuation(self):
        u = "https://example.com/video.mp4"
        assert is_url(u)

    def test_unicode_chinese(self):
        assert is_url("https://www.bilibili.com/video/BV1xx")


class TestNormalizeUrl:
    def test_strip_period(self):
        assert normalize_url("https://example.com.") == "https://example.com"

    def test_strip_chinese_period(self):
        assert normalize_url("https://example.com。") == "https://example.com"

    def test_strip_parenthesis(self):
        assert normalize_url("https://example.com)") == "https://example.com"


class TestExtractUrls:
    def test_single(self):
        assert extract_urls("see https://example.com") == ["https://example.com"]

    def test_multiple(self):
        text = "links: https://a.com and https://b.com"
        result = extract_urls(text)
        assert "https://a.com" in result
        assert "https://b.com" in result

    def test_with_trailing_comma(self):
        result = extract_urls("https://example.com, and more")
        assert "https://example.com" in result


class TestClassifyUrl:
    def test_youtube(self):
        p, k = classify_url("https://www.youtube.com/watch?v=abc")
        assert p == Platform.YOUTUBE
        assert k == MediaKind.VIDEO

    def test_youtu_be(self):
        p, _ = classify_url("https://youtu.be/abc")
        assert p == Platform.YOUTUBE

    def test_bilibili(self):
        p, _ = classify_url("https://www.bilibili.com/video/BV1xx")
        assert p == Platform.BILIBILI

    def test_douyin(self):
        p, _ = classify_url("https://www.douyin.com/video/123")
        assert p == Platform.DOUYIN

    def test_twitter(self):
        p, _ = classify_url("https://twitter.com/user/status/123")
        assert p == Platform.TWITTER

    def test_x(self):
        p, _ = classify_url("https://x.com/user/status/123")
        assert p == Platform.X

    def test_m3u8(self):
        p, _ = classify_url("https://example.com/playlist.m3u8")
        assert p == Platform.M3U8

    def test_mpd(self):
        p, _ = classify_url("https://example.com/manifest.mpd")
        assert p == Platform.DASH

    def test_direct_mp4(self):
        p, k = classify_url("https://example.com/video.mp4")
        assert p == Platform.DIRECT
        assert k == MediaKind.VIDEO

    def test_direct_mp3(self):
        p, k = classify_url("https://example.com/song.mp3")
        assert p == Platform.DIRECT
        assert k == MediaKind.AUDIO

    def test_unknown(self):
        p, k = classify_url("https://example.com/some/page")
        assert p == Platform.UNKNOWN


class TestFilterUrls:
    def test_drops_unknown(self):
        urls = filter_urls([
            "https://example.com",
            "https://www.youtube.com/watch?v=abc",
        ])
        assert "https://example.com" not in urls
        assert any("youtube" in u for u in urls)

    def test_dedup(self):
        urls = filter_urls([
            "https://a.com/video.mp4",
            "https://a.com/video.mp4",
        ])
        assert urls.count("https://a.com/video.mp4") == 1

    def test_filters_by_kind(self):
        urls = filter_urls(
            ["https://a.com/song.mp3", "https://a.com/video.mp4"],
            kinds=[MediaKind.VIDEO],
        )
        assert all("mp4" in u for u in urls)


class TestDouyinJingxuan:
    """抖音 jingxuan?modal_id 链接应被改写为标准 /video/ 形式。"""

    def test_canonicalize_modal_id_query(self):
        url = "https://www.douyin.com/jingxuan?modal_id=7656363857279012134"
        assert canonicalize_url(url) == "https://www.douyin.com/video/7656363857279012134"

    def test_canonicalize_modal_id_with_other_params(self):
        url = "https://www.douyin.com/jingxuan?foo=bar&modal_id=7656363857279012134&baz=1"
        assert canonicalize_url(url) == "https://www.douyin.com/video/7656363857279012134"

    def test_canonicalize_passthrough_for_normal_url(self):
        url = "https://www.douyin.com/video/123"
        assert canonicalize_url(url) == url

    def test_classify_after_canonicalize(self):
        p, _ = classify_url("https://www.douyin.com/jingxuan?modal_id=7656363857279012134")
        assert p == Platform.DOUYIN

    def test_extract_urls_rewrites_jingxuan(self):
        result = extract_urls("看看这个 https://www.douyin.com/jingxuan?modal_id=7656363857279012134 视频")
        assert "https://www.douyin.com/video/7656363857279012134" in result


class TestPlatformDisplayName:
    def test_youtube(self):
        assert platform_display_name(Platform.YOUTUBE) == "YouTube"

    def test_bilibili(self):
        assert platform_display_name(Platform.BILIBILI) == "Bilibili"
