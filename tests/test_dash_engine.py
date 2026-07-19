"""测试：DASH / MPD 引擎。"""

from __future__ import annotations

import pytest

from vidown.core.config import Config
from vidown.core.exceptions import DRMRestrictedError
from vidown.core.models import MediaKind, Platform
from vidown.engines.dash_engine import DashEngine
from vidown.engines.dash_probe import MPDProbe

SAMPLE_MPD = """<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4M2.5S" minBufferTime="PT1.5S">
  <BaseURL>https://example.com/dash/</BaseURL>
  <Period duration="PT4M2.5S">
    <AdaptationSet mimeType="video/mp4" codecs="avc1.64001f" frameRate="24">
      <Representation id="video_480p" bandwidth="800000" width="854" height="480">
        <SegmentTemplate timescale="1000" duration="4000" initialization="video_480p_init.mp4" media="video_480p_$Number$.m4s" startNumber="1"/>
      </Representation>
      <Representation id="video_720p" bandwidth="2000000" width="1280" height="720">
        <SegmentTemplate timescale="1000" duration="4000" initialization="video_720p_init.mp4" media="video_720p_$Number$.m4s" startNumber="1"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
      <Representation id="audio_128k" bandwidth="128000" audioSamplingRate="48000">
        <SegmentTemplate timescale="1000" duration="4000" initialization="audio_128k_init.mp4" media="audio_128k_$Number$.m4s" startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
"""


SAMPLE_MPD_TIMELINE = """<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT12S">
  <Period duration="PT12S">
    <AdaptationSet mimeType="video/mp4" codecs="avc1.64001f">
      <Representation id="v1" bandwidth="1000000" width="1920" height="1080">
        <BaseURL>https://example.com/v1/</BaseURL>
        <SegmentTemplate timescale="1000" initialization="init.mp4" media="$Time$.m4s">
          <SegmentTimeline>
            <S t="0" d="4000"/>
            <S d="4000"/>
            <S d="4000"/>
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
"""


SAMPLE_MPD_DRM = """<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation id="drm_v" bandwidth="1000000">
        <BaseURL>https://example.com/drm/</BaseURL>
        <SegmentTemplate timescale="1000" duration="2000" initialization="init.mp4" media="$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
"""


class TestMPDProbe:
    def test_parse_static_mpd(self):
        probe = MPDProbe(Config())
        manifest = probe._parse(SAMPLE_MPD, "https://example.com/manifest.mpd")
        assert not manifest.is_dynamic
        assert manifest.media_duration == 242.5
        assert len(manifest.segments) == 3

        video_segs = [s for s in manifest.segments if s.mime_type.startswith("video/")]
        audio_segs = [s for s in manifest.segments if s.mime_type.startswith("audio/")]
        assert len(video_segs) == 2
        assert len(audio_segs) == 1

        seg = video_segs[0]
        assert seg.initialization == "https://example.com/dash/video_480p_init.mp4"
        assert len(seg.media_segments) == 61  # 242.5 / 4 向上取整
        assert seg.media_segments[0] == "https://example.com/dash/video_480p_1.m4s"

    def test_parse_segment_timeline(self):
        probe = MPDProbe(Config())
        manifest = probe._parse(SAMPLE_MPD_TIMELINE, "https://example.com/timeline.mpd")
        assert len(manifest.segments) == 1
        seg = manifest.segments[0]
        assert seg.initialization == "https://example.com/v1/init.mp4"
        assert seg.media_segments == [
            "https://example.com/v1/0.m4s",
            "https://example.com/v1/4000.m4s",
            "https://example.com/v1/8000.m4s",
        ]

    def test_probe_detects_drm(self, monkeypatch):
        probe = MPDProbe(Config())
        monkeypatch.setattr(
            "vidown.engines.dash_probe.http_get_text",
            lambda url, config: SAMPLE_MPD_DRM,
        )
        ctx = DashEngine(Config())
        with pytest.raises(DRMRestrictedError):
            probe.probe("https://example.com/drm.mpd", ctx)


class TestDashEngine:
    def test_can_handle_mpd(self):
        engine = DashEngine(Config())
        assert engine.can_handle("https://example.com/manifest.mpd", Platform.DASH, MediaKind.VIDEO)
        assert not engine.can_handle(
            "https://example.com/playlist.m3u8", Platform.M3U8, MediaKind.VIDEO
        )

    def test_priority(self):
        engine = DashEngine(Config())
        assert engine.priority("", Platform.DASH, MediaKind.VIDEO) == 200
