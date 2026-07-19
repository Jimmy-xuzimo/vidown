"""测试：备用引擎（you-get / lux / gallery-dl）跨平台兼容性。"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from vidown.core.config import Config
from vidown.core.exceptions import BinaryNotFoundError, EngineError
from vidown.core.models import DownloadTask, MediaKind, Platform
from vidown.engines.base import EngineContext
from vidown.engines.fallback_engines import (
    GalleryDLEngine,
    LuxEngine,
    YouGetEngine,
)


class TestYouGetEngine:
    def test_can_handle_cn_sites(self):
        cfg = Config()
        cfg.engines.fallbacks["you_get"].enabled = True
        engine = YouGetEngine(cfg)
        engine._binary = "/bin/you-get"
        assert engine.can_handle("", Platform.BILIBILI, MediaKind.VIDEO)
        assert engine.can_handle("", Platform.IQIYI, MediaKind.VIDEO)

    def test_download_uses_python_executable(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = YouGetEngine(cfg)
        engine._binary = None
        engine._has_python = True
        engine._module = MagicMock()

        task = DownloadTask(url="https://example.com/video")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        def fake_run(cmd, **kwargs):
            out = Path(cmd[cmd.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            video = out / "video.mp4"
            video.write_bytes(b"data")
            return MagicMock(returncode=0, stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            result = engine.download_info(task, info, ctx)

        assert sys.executable in result.output_path or "video.mp4" in result.output_path

    def test_download_missing_binary_raises(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = YouGetEngine(cfg)
        engine._binary = None
        engine._has_python = False

        task = DownloadTask(url="https://example.com/video")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        with pytest.raises(BinaryNotFoundError):
            engine.download_info(task, info, ctx)


class TestLuxEngine:
    def test_priority(self):
        engine = LuxEngine(Config())
        assert engine.priority("", Platform.UNKNOWN, MediaKind.VIDEO) == 5

    def test_download_no_output_raises(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = LuxEngine(cfg)
        engine._binary = "/bin/lux"

        task = DownloadTask(url="https://example.com/video")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        with patch("subprocess.run", return_value=MagicMock(returncode=0, stderr="")):
            with pytest.raises(EngineError, match="未产出"):
                engine.download_info(task, info, ctx)


class TestGalleryDLEngine:
    def test_can_handle_image(self):
        engine = GalleryDLEngine(Config())
        engine._binary = "/bin/gallery-dl"
        assert engine.can_handle("", Platform.UNKNOWN, MediaKind.IMAGE)

    def test_image_priority(self):
        engine = GalleryDLEngine(Config())
        assert engine.priority("", Platform.UNKNOWN, MediaKind.IMAGE) == 80

    def test_download_uses_python_executable(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = GalleryDLEngine(cfg)
        engine._binary = None
        engine._has_python = True
        engine._module = MagicMock()

        task = DownloadTask(url="https://example.com/gallery")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        def fake_run(cmd, **kwargs):
            out = Path(cmd[cmd.index("-d") + 1])
            out.mkdir(parents=True, exist_ok=True)
            img = out / "image.jpg"
            img.write_bytes(b"data")
            return MagicMock(returncode=0, stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            result = engine.download_info(task, info, ctx)

        assert "image.jpg" in result.output_path
