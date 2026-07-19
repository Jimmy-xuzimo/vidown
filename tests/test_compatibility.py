"""兼容性测试：跨平台路径、编码、二进制调用。"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from vidown.core.config import Config
from vidown.core.models import DownloadTask
from vidown.core.path_utils import move_to_download_dir, safe_name
from vidown.core.utils import find_executable, run_command, sanitize_filename
from vidown.engines.base import EngineContext
from vidown.engines.fallback_engines import YouGetEngine


class TestPathCompatibility:
    def test_sanitize_filename_windows_reserved(self):
        assert sanitize_filename("CON.mp4") == "_CON.mp4"
        assert sanitize_filename("AUX") == "_AUX"
        assert sanitize_filename("COM1.txt") == "_COM1.txt"

    def test_sanitize_filename_illegal_chars(self):
        name = 'file<name>:with"/\\|?*chars.mp4'
        cleaned = sanitize_filename(name)
        assert "<" not in cleaned
        assert ">" not in cleaned
        assert ":" not in cleaned
        assert '"' not in cleaned
        assert "|" not in cleaned
        assert "?" not in cleaned
        assert "*" not in cleaned

    def test_sanitize_filename_trailing_space_period(self):
        assert sanitize_filename("name ") == "name"
        assert sanitize_filename("name.") == "name"

    def test_safe_name_with_long_title(self):
        cfg = Config()
        cfg.naming.max_length = 20
        name = "a" * 100
        assert len(safe_name(name, cfg)) <= 20

    def test_move_to_download_dir_cross_filesystem(self, tmp_path):
        """shutil.move 应能处理跨文件系统/目录移动。"""
        download_dir = tmp_path / "downloads"
        work_dir = tmp_path / "work" / "task1"
        work_dir.mkdir(parents=True)
        src = work_dir / "video.mp4"
        src.write_bytes(b"data")
        result = move_to_download_dir(src, download_dir, work_dir)
        assert Path(result).exists()
        assert not src.exists()


class TestBinaryCompatibility:
    def test_find_executable_python(self):
        # sys.executable 应能被找到
        assert find_executable(sys.executable) is not None

    def test_run_command_utf8_encoding(self):
        """run_command 应使用 utf-8 编码处理输出。"""
        if sys.platform.startswith("win"):
            pytest.skip("Windows echo 行为差异，跳过")
        result = run_command(["echo", "hello"])
        assert result.returncode == 0
        assert "hello" in result.stdout


class TestFallbackEngineCompatibility:
    def test_you_get_uses_sys_executable(self, tmp_path):
        cfg = Config()
        cfg.general.download_dir = str(tmp_path)
        engine = YouGetEngine(cfg)
        engine._binary = None
        engine._has_python = True
        engine._module = MagicMock()

        task = DownloadTask(url="https://example.com/video")
        ctx = EngineContext(config=cfg)
        info = engine.probe(task.url, ctx)

        captured_cmd = []

        def fake_run(cmd, **kwargs):
            captured_cmd.extend(cmd)
            out = Path(cmd[cmd.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            (out / "video.mp4").write_bytes(b"data")
            return MagicMock(returncode=0, stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            engine.download_info(task, info, ctx)

        assert sys.executable in captured_cmd
        assert "-m" in captured_cmd
        assert "you_get" in captured_cmd
