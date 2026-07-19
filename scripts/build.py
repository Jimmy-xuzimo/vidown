#!/usr/bin/env python
"""Vidown 跨平台打包脚本。

支持模式：
  onefile (默认)        单文件可执行
  onedir                目录形式（便于调试 / 代码签名）

支持平台：
  Windows  →  vidown.exe
  macOS    →  vidown + 可选 .app  (--app)
  Linux    →  vidown + 可选 AppImage (--appimage)

用法：
    python scripts/build.py                       # onefile
    python scripts/build.py --onedir              # 目录模式
    python scripts/build.py --clean               # 清理后再打包
    python scripts/build.py --skip-install        # 跳过 pip install
    python scripts/build.py --app                 # macOS: 额外生成 .app
    python scripts/build.py --no-upx              # 不用 UPX 压缩
    python scripts/build.py --sign               # macOS 代码签名
    python scripts/build.py --appimage            # Linux: 生成 AppImage
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_DIR / "dist"
BUILD_DIR = PROJECT_DIR / "build"
SPEC_FILE = PROJECT_DIR / "scripts" / "vidown.spec"
APP_DIR = PROJECT_DIR / "app"
ASSETS_DIR = PROJECT_DIR / "assets"

PLATFORM = platform.system().lower()  # windows / darwin / linux
ARCH = platform.machine().lower()  # x86_64 / arm64 / amd64
IS_WINDOWS = PLATFORM == "windows"
IS_MACOS = PLATFORM == "darwin"
IS_LINUX = PLATFORM == "linux"


# ----------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------


def log(msg: str) -> None:
    print(f"==> {msg}", flush=True)


def run(cmd: list, cwd: Path | None = None, check: bool = True, env: dict | None = None) -> int:
    """运行子命令并打印输出。"""
    print(f"    $ {' '.join(str(c) for c in cmd)}", flush=True)
    e = os.environ.copy()
    if env:
        e.update(env)
    return subprocess.call(cmd, cwd=cwd or PROJECT_DIR, env=e)


def clean() -> None:
    for d in (DIST_DIR, BUILD_DIR, APP_DIR):
        if d.exists():
            shutil.rmtree(d)
            print(f"  cleaned {d}")
    # 清理 .pyc 与 __pycache__
    for pyc in PROJECT_DIR.rglob("__pycache__"):
        if pyc.is_dir():
            shutil.rmtree(pyc, ignore_errors=True)


def ensure_dependencies() -> None:
    """确保 PyInstaller 已安装。"""
    try:
        import PyInstaller  # noqa
    except ImportError:
        log("PyInstaller 未安装，正在安装...")
        run(
            [sys.executable, "-m", "pip", "install", "pyinstaller", "pyinstaller-hooks-contrib"],
            env={"PIP_BREAK_SYSTEM_PACKAGES": "1"},
        )

    # 验证 vidown 可正常导入
    sys.path.insert(0, str(PROJECT_DIR))
    try:
        import vidown  # noqa
        from vidown import __version__

        log(f"Vidown v{__version__} 可正常导入")
    except Exception as e:
        log(f"⚠️  vidown 导入失败: {e}")
        log("   建议先运行: pip install -e .")
        sys.exit(1)


def run_pyinstaller(onedir: bool = False, no_upx: bool = False) -> int:
    """执行 PyInstaller。"""
    env = {}
    if onedir:
        env["VIDOWN_ONEDIR"] = "1"
    if no_upx:
        env["VIDOWN_NO_UPX"] = "1"

    # UPX 处理
    upx_args = []
    if no_upx:
        upx_args = ["--noupx"]

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(SPEC_FILE),
        "--noconfirm",
        "--clean",
        *upx_args,
    ]
    return run(cmd, env=env)


# ----------------------------------------------------------------------
# macOS .app 打包
# ----------------------------------------------------------------------


def build_macos_app() -> int:
    """在 macOS 上将 vidown 可执行文件包装为 .app bundle。"""
    if not IS_MACOS:
        log("⚠️  --app 仅在 macOS 上支持")
        return 1
    exe = DIST_DIR / "vidown"
    if not exe.exists():
        log(f"❌ 未找到 {exe}，请先运行 onefile 打包")
        return 1
    app_path = APP_DIR / "Vidown.app"
    if app_path.exists():
        shutil.rmtree(app_path)
    contents = app_path / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)

    # 复制可执行文件
    shutil.copy2(exe, macos / "vidown")
    os.chmod(macos / "vidown", 0o755)

    # Info.plist
    info_plist = """\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Vidown</string>
    <key>CFBundleDisplayName</key>
    <string>Vidown — 通用视频下载器</string>
    <key>CFBundleIdentifier</key>
    <string>com.vidown.app</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleExecutable</key>
    <string>vidown</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppleEventsUsageDescription</key>
    <string>Vidown 需要启动浏览器以打开 Web GUI。</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.utilities</string>
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key>
            <string>URL</string>
            <key>CFBundleTypeRole</key>
            <string>Viewer</string>
            <key>LSItemContentTypes</key>
            <array>
                <string>public.url</string>
                <string>public.text</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
"""
    (contents / "Info.plist").write_text(info_plist, encoding="utf-8")

    # 图标
    icon_png = ASSETS_DIR / "icon_512.png"
    icon_icns = resources / "icon.icns"
    if icon_png.exists():
        # 用 iconutil 生成 .icns (macOS 自带工具)
        iconset = resources / "icon.iconset"
        iconset.mkdir(exist_ok=True)
        for size in [16, 32, 64, 128, 256, 512]:
            for scale in [1, 2]:
                actual = size * scale
                target = iconset / (f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png")
                # 使用 sips 缩放
                try:
                    subprocess.run(
                        [
                            "sips",
                            "-z",
                            str(actual),
                            str(actual),
                            str(icon_png),
                            "--out",
                            str(target),
                        ],
                        check=True,
                        capture_output=True,
                    )
                except Exception:
                    # 退化：直接复制
                    shutil.copy2(icon_png, target)
        # 打包为 icns
        try:
            subprocess.run(
                ["iconutil", "-c", "icns", str(iconset), "-o", str(icon_icns)], check=True
            )
            shutil.rmtree(iconset)
        except Exception as e:
            log(f"⚠️  iconutil 失败: {e}")
            shutil.rmtree(iconset, ignore_errors=True)

    log(f"✅ 已生成 {app_path}")
    return 0


# ----------------------------------------------------------------------
# Linux AppImage
# ----------------------------------------------------------------------


def build_appimage() -> int:
    """在 Linux 上生成 AppImage。"""
    if not IS_LINUX:
        log("⚠️  --appimage 仅在 Linux 上支持")
        return 1

    # AppImage 工具：appimagetool
    appimagetool = shutil.which("appimagetool")
    if not appimagetool:
        log("❌ 未找到 appimagetool，请先下载：")
        log(
            "   wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
        )
        log("   chmod +x appimagetool-x86_64.AppImage")
        log("   sudo mv appimagetool-x86_64.AppImage /usr/local/bin/appimagetool")
        return 1

    # 先以 onedir 模式构建（AppImage 推荐）
    onedir_dir = DIST_DIR / "vidown"
    if not onedir_dir.exists():
        log("AppImage 需要 onedir 目录，先构建 onedir ...")
        run_pyinstaller(onedir=True)

    appdir = APP_DIR / "Vidown.AppDir"
    if appdir.exists():
        shutil.rmtree(appdir)
    appdir.mkdir(parents=True)

    # AppRun
    apprun = appdir / "AppRun"
    apprun.write_text("""#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"
export PATH="$HERE/usr/bin:$PATH"
exec "$HERE/usr/bin/vidown/vidown" "$@"
""")
    os.chmod(apprun, 0o755)

    # usr/bin
    (appdir / "usr" / "bin").mkdir(parents=True)
    shutil.copytree(onedir_dir, appdir / "usr" / "bin" / "vidown")

    # desktop entry
    desktop = appdir / "Vidown.desktop"
    desktop.write_text("""[Desktop Entry]
Type=Application
Name=Vidown
GenericName=Video Downloader
Comment=通用视频下载器
Exec=vidown %u
Icon=vidown
Terminal=true
Categories=Network;AudioVideo;Utility;
StartupNotify=true
MimeType=text/uri-list;x-scheme-handler/http;x-scheme-handler/https;
""")

    # 图标
    icon_png = ASSETS_DIR / "icon_512.png"
    if icon_png.exists():
        shutil.copy2(icon_png, appdir / "vidown.png")
        # AppImage 通常需要多个尺寸
        for size in [16, 32, 64, 128, 256]:
            scaled = appdir / f"vidown_{size}x{size}.png"
            try:
                from PIL import Image

                img = Image.open(icon_png)
                img.thumbnail((size, size))
                img.save(scaled)
            except Exception:
                shutil.copy2(icon_png, scaled)

    # 运行 appimagetool
    out = DIST_DIR / "Vidown-x86_64.AppImage"
    if (out).exists():
        out.unlink()
    rc = run([appimagetool, str(appdir), str(out)])
    if rc == 0 and out.exists():
        os.chmod(out, 0o755)
        log(f"✅ 已生成 {out}")
    return rc


# ----------------------------------------------------------------------
# 验证产出
# ----------------------------------------------------------------------


def verify_binary() -> int:
    """运行产出的可执行文件进行冒烟测试。"""
    if IS_WINDOWS:
        bin_path = DIST_DIR / "vidown.exe"
    else:
        bin_path = DIST_DIR / "vidown"

    if not bin_path.exists():
        log(f"❌ 找不到 {bin_path}")
        return 1

    log(f"测试运行: {bin_path}")
    rc = run([str(bin_path), "--version"])
    if rc != 0:
        log("⚠️  --version 失败")
        return rc
    rc = run([str(bin_path), "check"])
    return rc


# ----------------------------------------------------------------------
# 主入口
# ----------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Vidown 跨平台打包")
    parser.add_argument("--clean", action="store_true", help="先清理 build/dist")
    parser.add_argument("--onedir", action="store_true", help="生成目录而非单文件")
    parser.add_argument("--skip-install", action="store_true", help="跳过依赖检查")
    parser.add_argument("--app", action="store_true", help="macOS: 生成 .app")
    parser.add_argument("--appimage", action="store_true", help="Linux: 生成 AppImage")
    parser.add_argument("--no-upx", action="store_true", help="不用 UPX 压缩")
    parser.add_argument("--sign", action="store_true", help="macOS: 代码签名")
    parser.add_argument("--verify", action="store_true", help="打包后冒烟测试")
    args = parser.parse_args()

    log(f"Vidown 打包 — {PLATFORM} ({ARCH})")

    if args.clean:
        clean()
    if not args.skip_install:
        ensure_dependencies()

    # 1. PyInstaller
    t0 = time.time()
    rc = run_pyinstaller(onedir=args.onedir, no_upx=args.no_upx)
    if rc != 0:
        log(f"❌ PyInstaller 失败: {rc}")
        return rc
    log(f"PyInstaller 完成 ({time.time() - t0:.1f}s)")

    # 2. macOS .app
    if args.app and IS_MACOS:
        build_macos_app()

    # 3. Linux AppImage
    if args.appimage and IS_LINUX:
        build_appimage()

    # 4. macOS 代码签名
    if args.sign and IS_MACOS:
        run(["codesign", "--force", "--deep", "--sign", "-", str(APP_DIR / "Vidown.app")])

    # 5. 验证
    if args.verify:
        verify_binary()

    # 6. 产物清单
    log("\n打包产物:")
    for p in sorted(DIST_DIR.rglob("*")):
        if p.is_file():
            sz = p.stat().st_size
            print(f"  {p.relative_to(DIST_DIR)}  ({sz/1024/1024:.1f} MB)")
        elif p.is_dir():
            print(f"  {p.relative_to(DIST_DIR)}/")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
