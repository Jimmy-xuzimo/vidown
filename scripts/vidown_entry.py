"""Vidown 冻结入口 —— 专门用于 PyInstaller 打包。

该文件必须保持 **完全自包含**、**不依赖相对导入**，因为 PyInstaller 会
把它当作独立脚本执行。CLI 与 GUI 入口都委托到 vidown.cli.main。
"""

import os
import sys


def _setup_path() -> None:
    """确保 vidown 包可被找到（兼容开发模式 / onefile 模式）。"""
    if getattr(sys, "frozen", False):
        # onefile 模式：sys._MEIPASS 是临时解压目录
        base = sys._MEIPASS
        if base not in sys.path:
            sys.path.insert(0, base)
    else:
        # 开发模式：脚本目录的上两级
        here = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(here)
        if project_root not in sys.path:
            sys.path.insert(0, project_root)


_setup_path()

# 走包导入
from vidown.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
