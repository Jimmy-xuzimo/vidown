"""PyInstaller hook: 强制收集所有 vidown 子模块。"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("vidown")
