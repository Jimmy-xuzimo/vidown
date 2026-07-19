"""测试：M3U8 引擎（探测、外部/内部下载器拆分）。"""

from __future__ import annotations

import responses

from vidown.core.config import Config
from vidown.core.models import Platform
from vidown.core.platform_detect import classify_url
from vidown.engines.base import EngineContext
from vidown.engines.dash_engine import DashEngine
from vidown.engines.m3u8_engine import M3U8Engine
from vidown.engines.m3u8_external import M3U8ExternalDownloader
from vidown.engines.m3u8_internal import M3U8InternalDownloader
from vidown.engines.m3u8_probe import M3U8Probe


class TestM3U8Probe:
    @responses.activate
    def test_probe_master_playlist(self):
        master = (
            "#EXTM3U\n"
            '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.640028,mp4a.40.2"\n'
            "360p.m3u8\n"
            '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"\n'
            "720p.m3u8\n"
        )
        url = "https://example.com/master.m3u8"
        responses.add(responses.GET, url, body=master, status=200)

        probe = M3U8Probe(Config())
        ctx = EngineContext(config=Config())
        info = probe.probe(url, ctx)

        assert info.platform == Platform.M3U8
        assert len(info.formats) == 2
        assert info.formats[0].resolution == "640x360"
        assert info.formats[1].resolution == "1280x720"
        # 相对 URL 应被正确解析
        assert info.formats[0].extra["variant_url"] == "https://example.com/360p.m3u8"
        assert info.formats[1].extra["variant_url"] == "https://example.com/720p.m3u8"

    @responses.activate
    def test_probe_relative_url_with_path(self):
        master = (
            "#EXTM3U\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080\n"
            "/videos/1080p.m3u8\n"
        )
        url = "https://example.com/live/stream.m3u8"
        responses.add(responses.GET, url, body=master, status=200)

        probe = M3U8Probe(Config())
        ctx = EngineContext(config=Config())
        info = probe.probe(url, ctx)

        assert len(info.formats) == 1
        assert info.formats[0].extra["variant_url"] == "https://example.com/videos/1080p.m3u8"

    @responses.activate
    def test_probe_non_master_returns_auto_format(self):
        media = "#EXTM3U\n" "#EXT-X-TARGETDURATION:10\n" "#EXTINF:9.009,\n" "seg1.ts\n"
        url = "https://example.com/media.m3u8"
        responses.add(responses.GET, url, body=media, status=200)

        probe = M3U8Probe(Config())
        ctx = EngineContext(config=Config())
        info = probe.probe(url, ctx)

        assert len(info.formats) == 1
        assert info.formats[0].format_id == "auto"


class TestM3U8ExternalDownloader:
    def test_available_without_binary(self):
        cfg = Config()
        cfg.engines.m3u8dl.binary_path = ""
        dl = M3U8ExternalDownloader(cfg)
        assert not dl.available


class TestM3U8InternalDownloader:
    def test_init(self):
        dl = M3U8InternalDownloader(Config())
        assert dl is not None


class TestM3U8Engine:
    def test_can_handle_m3u8(self):
        engine = M3U8Engine(Config())
        p, k = classify_url("https://example.com/live.m3u8")
        assert engine.can_handle("https://example.com/live.m3u8", p, k)

    def test_dash_engine_handles_mpd(self):
        engine = DashEngine(Config())
        p, k = classify_url("https://example.com/live.mpd")
        assert engine.can_handle("https://example.com/live.mpd", p, k)

    def test_priority(self):
        engine = M3U8Engine(Config())
        p, k = classify_url("https://example.com/live.m3u8")
        assert engine.priority("https://example.com/live.m3u8", p, k) == 200

    def test_external_not_available_uses_internal(self):
        cfg = Config()
        cfg.engines.m3u8dl.binary_path = ""
        engine = M3U8Engine(cfg)
        assert not engine._external.available
        assert isinstance(engine._internal, M3U8InternalDownloader)
