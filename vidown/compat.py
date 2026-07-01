"""运行时兼容性垫片：Windows cp1252 stdout 编码修复。

在 Windows 上，Python 默认 stdout 编码是 cp1252（cp936 之外的常见系统区域）。
当 argparse 试图打印包含中文的 help 文本时会抛
`UnicodeEncodeError: 'charmap' codec can't encode characters ...`。

在 import vidown 的最早时机尝试把 stdout/stderr 切到 utf-8。
"""

from __future__ import annotations

import os
import sys


def configure_utf8_stdout() -> None:
    """重新配置 stdout/stderr 为 utf-8。失败则静默。

    分三步：
    1. 提前在环境变量里钉住 PYTHONIOENCODING / PYTHONUTF8，这样子进程
       （例如我们的 test_cli.py 启动的 `python -m vidown --help`）也能
       拿到 utf-8 stdout。这是 Windows 端最稳的修法。
    2. 对当前进程的主 stdout/stderr 调用 reconfigure()。
    3. 任何一步失败都静默跳过——这是 best-effort 兼容层，不能因为它
       让模块导入失败。
    """
    # Step 1: 子进程用。setdefault 保证不覆盖用户已显式设置的值。
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")

    # Step 2: 当前进程。getattr + callable 比 isinstance 兼容 mypy。
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
