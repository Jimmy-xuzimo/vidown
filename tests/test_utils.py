"""测试：工具函数。"""

from __future__ import annotations

from pathlib import Path

import pytest

from vidown.core.utils import (
    human_readable_size,
    human_readable_duration,
    human_readable_speed,
    sanitize_filename,
    find_executable,
)


class TestSanitizeFilename:
    def test_simple(self):
        assert sanitize_filename("hello") == "hello"

    def test_strip_slash(self):
        assert "/" not in sanitize_filename("a/b")

    def test_windows_reserved(self):
        # CON 是 Windows 保留名
        assert sanitize_filename("CON") != "CON"

    def test_length_limit(self):
        long = "a" * 500
        assert len(sanitize_filename(long)) <= 200

    def test_empty(self):
        assert sanitize_filename("") == "untitled"

    def test_chinese(self):
        assert sanitize_filename("测试视频") == "测试视频"

    def test_newline(self):
        assert "\n" not in sanitize_filename("a\nb")


class TestHumanReadable:
    def test_size(self):
        assert "B" in human_readable_size(100)
        assert "KB" in human_readable_size(2048)
        assert "MB" in human_readable_size(2 * 1024 * 1024)
        assert "GB" in human_readable_size(2 * 1024 * 1024 * 1024)

    def test_duration(self):
        assert human_readable_duration(30) == "00:30"
        assert human_readable_duration(125) == "02:05"
        assert human_readable_duration(3700) == "01:01:40"

    def test_speed(self):
        assert "B/s" in human_readable_speed(1024)
        assert "KB/s" in human_readable_speed(2048)


class TestFindExecutable:
    def test_python(self):
        # 当前解释器一定存在
        assert find_executable(sys_executable_name()) is not None


def sys_executable_name():
    import sys
    return Path(sys.executable).name
