"""测试：RTMP / RTSP 直播流引擎。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from vidown.core.config import Config
from vidown.core.exceptions import BinaryNotFoundError, UserCancelledError
from vidown.core.models import DownloadTask, MediaKind, Platform
from vidown.core.platform_detect import classify_url
from vidown.engines.base import EngineContext
from vidown.engines.rtmp_engine import RtmpEngine


class TestRtmpEngine:
    def test_can_handle_rtmp(self):
        engine = RtmpEngine(Config())
        p, k = classify_url("rtmp://example.com/live/stream")
        assert engine.can_handle("rtmp://example.com/live/stream", p, k)

    def test_can_handle_rtmps(self):
        engine = RtmpEngine(Config())
        p, k = classify_url("rtmps://example.com/live/stream")
        assert engine.can_handle("rtmps://example.com/live/stream", p, k)

    def test_can_handle_rtsp(self):
        engine = RtmpEngine(Config())
        p, k = classify_url("rtsp://example.com/camera/stream")
        assert engine.can_handle("rtsp://example.com/camera/stream", p, k)

    def test_cannot_handle_http(self):
        engine = RtmpEngine(Config())
        p, k = classify_url("https://example.com/video.mp4")
        assert not engine.can_handle("https://example.com/video.mp4", p, k)

    def test_priority(self):
        engine = RtmpEngine(Config())
        p, k = classify_url("rtmp://example.com/live/stream")
        assert engine.priority("rtmp://example.com/live/stream", p, k) == 200

    def test_detect_protocol(self):
        engine = RtmpEngine(Config())
        assert engine._detect_protocol("rtmp://example.com/stream") == "rtmp"
        assert engine._detect_protocol("rtmps://example.com/stream") == "rtmps"
        assert engine._detect_protocol("rtsp://example.com/stream") == "rtsp"
        assert engine._detect_protocol("RTMP://example.com/stream") == "rtmp"

    def test_guess_title(self):
        engine = RtmpEngine(Config())
        assert engine._guess_title("rtmp://example.com/live/stream") == "stream"
        assert engine._guess_title("rtsp://192.168.1.1/") == "192.168.1.1"
        assert engine._guess_title("rtmp://example.com") == "example.com"

    def test_probe_returns_live_info(self):
        engine = RtmpEngine(Config())
        ctx = EngineContext(config=Config())
        info = engine.probe("rtmp://example.com/live/stream", ctx)

        assert info.platform == Platform.RTMP
        assert info.kind == MediaKind.VIDEO
        assert info.is_live is True
        assert info.extra["protocol"] == "rtmp"
        assert len(info.formats) == 1
        assert info.formats[0].format_id == "rtmp_default"
        assert "直播" in info.formats[0].format_note

    def test_download_without_ffmpeg_raises(self):
        cfg = Config()
        engine = RtmpEngine(cfg)
        engine._ffmpeg = None
        task = DownloadTask(url="rtmp://example.com/live/stream")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        with pytest.raises(BinaryNotFoundError):
            engine.download_info(task, info, ctx)

    def test_download_success(self, tmp_path, monkeypatch):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = RtmpEngine(cfg)
        engine._ffmpeg = "/usr/bin/ffmpeg"
        engine.DEFAULT_MAX_DURATION = 1  # 缩短测试时长

        task = DownloadTask(url="rtmp://example.com/live/stream")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        # 模拟 FFmpegPipe：在 out_path 写入文件并立即返回
        def fake_run(args, timeout=None):
            out = Path(args[-1])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"fake mp4 data")
            return 0

        mock_pipe = MagicMock()
        mock_pipe.run = fake_run
        mock_pipe.cancel = MagicMock()

        with patch("vidown.engines.rtmp_engine.FFmpegPipe", return_value=mock_pipe):
            result = engine.download_info(task, info, ctx)

        assert Path(result.output_path).exists()
        assert result.engine_name == "rtmp"
        assert result.metadata.platform == Platform.RTMP

    def test_download_cancelled(self, tmp_path, monkeypatch):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = RtmpEngine(cfg)
        engine._ffmpeg = "/usr/bin/ffmpeg"
        engine.DEFAULT_MAX_DURATION = 10

        task = DownloadTask(url="rtmp://example.com/live/stream")
        cancelled = {"flag": False}

        def cancel_flag():
            return cancelled["flag"]

        ctx = EngineContext(config=cfg, cancel_flag=cancel_flag)
        info = engine.probe(task.url, ctx)

        def fake_run(args, timeout=None):
            # 模拟录制过程中用户取消
            cancelled["flag"] = True
            raise RuntimeError("录制被中断")

        mock_pipe = MagicMock()
        mock_pipe.run = fake_run
        mock_pipe.cancel = MagicMock()

        with patch("vidown.engines.rtmp_engine.FFmpegPipe", return_value=mock_pipe):
            with pytest.raises(UserCancelledError):
                engine.download_info(task, info, ctx)

    def test_download_failed_no_output(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = RtmpEngine(cfg)
        engine._ffmpeg = "/usr/bin/ffmpeg"
        engine.DEFAULT_MAX_DURATION = 1

        task = DownloadTask(url="rtmp://example.com/live/stream")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        mock_pipe = MagicMock()
        mock_pipe.run = MagicMock(return_value=0)
        mock_pipe.cancel = MagicMock()

        with patch("vidown.engines.rtmp_engine.FFmpegPipe", return_value=mock_pipe):
            # 未生成输出文件
            from vidown.core.exceptions import EngineError

            with pytest.raises(EngineError, match="未生成输出文件"):
                engine.download_info(task, info, ctx)
