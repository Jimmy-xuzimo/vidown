"""运行时兼容性垫片：Windows cp1252 stdout 编码修复。

在 Windows 上，Python 默认 stdout 编码是 cp1252（cp936 之外的常见系统区域）。
当 argparse 试图打印包含中文的 help 文本时会抛
`UnicodeEncodeError: 'charmap' codec can't encode characters ...`。

在 import vidown 的最早时机尝试把 stdout/stderr 切到 utf-8。
"""

from __future__ import annotations

import sys


def configure_utf8_stdout() -> None:
    """重新配置 stdout/stderr 为 utf-8。失败则静默。"""
    # getattr + callable 比 isinstance(sys.stdout, TextIOBase) 更兼容 mypy
    # （静态分析中 sys.stdout 可能是 TextIO | Any 的 union）。
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if not callable(reconfigure):
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # pragma: no cover
        pass
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # pragma: no cover
        pass
