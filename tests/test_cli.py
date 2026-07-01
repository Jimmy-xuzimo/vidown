"""端到端冒烟测试：CLI 解析、模型转换。"""

import subprocess
import sys
from pathlib import Path

import pytest


def test_cli_help():
    result = subprocess.run(
        [sys.executable, "-m", "vidown", "--help"],
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0
    assert "Vidown" in result.stdout or "通用视频下载器" in result.stdout


def test_cli_check():
    result = subprocess.run(
        [sys.executable, "-m", "vidown", "check"],
        capture_output=True, text=True, timeout=30,
    )
    # 即便 ffmpeg 缺失，check 也不应返回非 0
    assert "Vidown" in result.stdout
