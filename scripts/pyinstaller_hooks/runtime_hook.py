"""Vidown —— PyInstaller 运行时 Hook。

在程序启动前执行，做两件事：
  1. 修复 __file__ 与冻结包资源查找路径
  2. 设置默认配置目录
"""
import os
import sys
from pathlib import Path

# ---- 1. 资源目录定位 ----
# PyInstaller 解压到 sys._MEIPASS
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent.parent

# ---- 2. 用户配置目录 ----
USER_CONFIG_DIR = Path(os.environ.get("VIDOWN_HOME", Path.home() / ".vidown"))
USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# ---- 3. 设置资源查找路径 ----
# 让 vidown.config 模块能加载默认配置
sys.path.insert(0, str(BASE_DIR))

# ---- 4. 平台信息（供 GUI 显示） ----
os.environ.setdefault("VIDOWN_FROZEN", "1")
os.environ.setdefault("VIDOWN_BASE_DIR", str(BASE_DIR))
os.environ.setdefault("VIDOWN_CONFIG_DIR", str(USER_CONFIG_DIR))
