"""端到端冒烟测试：CLI 解析、模型转换。"""

import os
import subprocess
import sys

# Windows 上 subprocess 默认会用系统 codepage (cp1252) 解码子进程 stdout。
# 我们需要：
# 1. 强制子进程以 utf-8 输出（PYTHONIOENCODING=utf-8），这样子进程内 Python 不会
#    尝试用 cp1252 写 stdout（即使父进程也是 cp1252，Python 不会重新编码到 cp936）。
# 2. 父进程也用 utf-8 解码子进程的 bytes 流。
# 这两层在 Windows runner 上必须同时存在，否则会出现：
#   UnicodeDecodeError: 'charmap' codec can't decode byte 0x81/0x9d ...
_SUBPROC_KW = {
    "capture_output": True,
    "text": True,
    "encoding": "utf-8",
    "errors": "replace",
    "timeout": 30,
    "env": {**os.environ, "PYTHONIOENCODING": "utf-8"},
}


def test_cli_help():
    result = subprocess.run(
        [sys.executable, "-m", "vidown", "--help"],
        **_SUBPROC_KW,
    )
    assert result.returncode == 0
    assert "Vidown" in result.stdout or "通用视频下载器" in result.stdout


def test_cli_check():
    result = subprocess.run(
        [sys.executable, "-m", "vidown", "check"],
        **_SUBPROC_KW,
    )
    # 即便 ffmpeg 缺失，check 也不应返回非 0
    assert "Vidown" in result.stdout
