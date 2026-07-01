# -*- mode: python ; coding: utf-8 -*-
"""
Vidown —— PyInstaller 打包规格 (Windows / macOS / Linux 通用)

使用：
    pyinstaller scripts/vidown.spec

或：
    python -m PyInstaller scripts/vidown.spec
"""

import os
import platform
import sys
from pathlib import Path

PROJECT_DIR = Path(SPECPATH).resolve().parent
DIST_DIR = PROJECT_DIR / "dist"
BUILD_DIR = PROJECT_DIR / "build"

# ----------------------------------------------------------------------
# 资源数据
# ----------------------------------------------------------------------

# 路径分隔符：Windows 是 ;, Unix 是 :
SEPARATOR = ";" if os.name == "nt" else ":"


def data(*pairs):
    """生成 (源, 目标) 列表。"""
    return [(str(src), dst) for src, dst in pairs]


# 资源文件：configs + GUI 模板 + 静态文件 + 文档
datas = data(
    (PROJECT_DIR / "configs" / "config.default.json", "configs"),
    (PROJECT_DIR / "configs" / "config.example.yaml", "configs"),
    (PROJECT_DIR / "vidown" / "gui" / "templates", "vidown/gui/templates"),
    (PROJECT_DIR / "vidown" / "gui" / "static", "vidown/gui/static"),
    (PROJECT_DIR / "README.md", "."),
    (PROJECT_DIR / "LICENSE", "."),
)

# ----------------------------------------------------------------------
# 隐藏导入（动态加载的模块）
# ----------------------------------------------------------------------

hiddenimports = [
    # vidown 自身子包
    "vidown",
    "vidown.cli",
    "vidown.gui",
    "vidown.engines",
    "vidown.engines.base",
    "vidown.engines.ytdlp_engine",
    "vidown.engines.m3u8_engine",
    "vidown.engines.direct_engine",
    "vidown.engines.fallback_engines",
    "vidown.postprocess",
    "vidown.postprocess.ffmpeg_pipe",
    "vidown.postprocess.probe",
    "vidown.data",
    "vidown.utils",
    "vidown.utils.clipboard",
    "vidown.utils.download_enhancer",
    "vidown.utils.system",
    # 第三方
    "yt_dlp",
    "yt_dlp.extractor",
    "yt_dlp.extractor.common",
    "yt_dlp.postprocessor",
    "yt_dlp.postprocessor.ffmpeg",
    "yt_dlp.postprocessor.metadata",
    "yt_dlp.postprocessor.embedthumbnail",
    "yt_dlp.postprocessor.sponsorblock",
    "yt_dlp.downloader",
    "yt_dlp.downloader.common",
    "yt_dlp.downloader.hls",
    "yt_dlp.downloader.dash",
    "yt_dlp.downloader.fragment",
    "requests",
    "requests.packages.urllib3",
    "m3u8",
    "bs4",
    "yaml",
    "sqlite3",
    "http.server",
    "http.server",  # for gui
    "socketserver",
    "urllib.parse",
    # 备用引擎（按需）
    "you_get",
    "you_get.cli_wrapper",
    "you_get.common",
    "you_get.extractors",
    "you_get.processor",
    "you_get.util",
    "you_get.util.fs",
    "you_get.util.git",
    "you_get.util.strings",
    "you_get.util.term",
    "you_get.util.time",
    "you_get.util.url",
    "gallery_dl",
    "gallery_dl.extractor",
]

# ----------------------------------------------------------------------
# 排除的模块（减小体积）
# ----------------------------------------------------------------------

excludes = [
    "tkinter",
    "matplotlib",
    "numpy.tests",
    "PIL.tests",
    "PyQt5",
    "PyQt6",
    "PySide2",
    "PySide6",
    "IPython",
    "jupyter",
    "notebook",
    "pandas",
    "scipy",
    "sympy",
    "test",
    "unittest",
    "setuptools",
    "pkg_resources",
    "pip",
    "wheel",
    "sphinx",
]

# ----------------------------------------------------------------------
# 主程序
# ----------------------------------------------------------------------

a = Analysis(
    [str(PROJECT_DIR / "scripts" / "vidown_entry.py")],
    pathex=[str(PROJECT_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[str(PROJECT_DIR / "scripts" / "pyinstaller_hooks")],
    hooksconfig={},
    runtime_hooks=[str(PROJECT_DIR / "scripts" / "pyinstaller_hooks" / "runtime_hook.py")],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

# ----------------------------------------------------------------------
# 单文件 vs 单目录：根据参数选择
# ----------------------------------------------------------------------

# 默认使用 onefile（更便携）；CI 中通过 --onedir 切换
ONEFILE = os.environ.get("VIDOWN_ONEDIR", "0") != "1"

if ONEFILE:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        [],
        name="vidown",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=True,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=str(PROJECT_DIR / "assets" / "icon.ico") if (PROJECT_DIR / "assets" / "icon.ico").exists() else None,
    )
else:
    # onedir 模式：方便调试与代码签名
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="vidown",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        console=True,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=str(PROJECT_DIR / "assets" / "icon.ico") if (PROJECT_DIR / "assets" / "icon.ico").exists() else None,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name="vidown",
    )
