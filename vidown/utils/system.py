"""系统工具：平台识别、安装指引。"""

from __future__ import annotations

import subprocess
import sys


def detect_platform() -> str:
    """返回标准化平台名：darwin / windows / linux / 其他。"""
    p = sys.platform.lower()
    if p.startswith("darwin"):
        return "darwin"
    if p.startswith("win"):
        return "windows"
    if p.startswith("linux"):
        return "linux"
    return p


def install_ffmpeg_instructions() -> str:
    p = detect_platform()
    if p == "darwin":
        return "macOS:   brew install ffmpeg"
    if p == "windows":
        return (
            "Windows: 从 https://www.gyan.dev/ffmpeg/builds/ 下载 release，"
            "将 ffmpeg.exe / ffprobe.exe 所在目录加入 PATH。"
        )
    if p == "linux":
        return (
            "Linux:   sudo apt install ffmpeg   # Debian/Ubuntu\n"
            "         sudo dnf install ffmpeg   # Fedora\n"
            "         sudo pacman -S ffmpeg     # Arch"
        )
    return "请参考 https://ffmpeg.org/download.html 安装 ffmpeg/ffprobe。"


def install_ytdlp_instructions() -> str:
    return (
        "在任何平台执行:  pip install -U yt-dlp\n"
        "或使用包管理器:  brew install yt-dlp / pipx install yt-dlp"
    )


def open_path(path: str) -> bool:
    """在系统文件管理器中显示文件/目录。"""
    p = detect_platform()
    try:
        if p == "darwin":
            subprocess.Popen(["open", path])
        elif p == "windows":
            subprocess.Popen(["explorer", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return True
    except Exception:
        return False
