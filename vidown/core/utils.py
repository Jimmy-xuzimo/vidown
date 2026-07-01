"""通用工具函数。"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional, Tuple

from .exceptions import FFmpegNotFoundError


# ----------------------------------------------------------------------
# 路径
# ----------------------------------------------------------------------

def expand_path(path: str) -> Path:
    """展开 ~ 和环境变量，并确保父目录存在。"""
    if not path:
        path = str(Path.cwd())
    p = Path(os.path.expandvars(os.path.expanduser(path)))
    p.mkdir(parents=True, exist_ok=True)
    return p


def sanitize_filename(name: str, max_length: int = 200, windows_safe: bool = True) -> str:
    """清理文件名中的非法字符。"""
    if not name:
        return "untitled"
    if windows_safe:
        # Windows 非法字符
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
        # Windows 保留名
        reserved = {
            "CON", "PRN", "AUX", "NUL",
            *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10)),
        }
        if name.split(".")[0].upper() in reserved:
            name = "_" + name
        # 去掉结尾空格与点
        name = name.rstrip(" .")
    # 替换其它控制字符
    name = re.sub(r"[\r\n\t]", " ", name)
    # 折叠空白
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) > max_length:
        name = name[:max_length].rstrip()
    return name or "untitled"


# ----------------------------------------------------------------------
# 外部依赖探测
# ----------------------------------------------------------------------

def find_executable(name: str) -> Optional[str]:
    """跨平台查找可执行文件。"""
    return shutil.which(name)


def check_ffmpeg() -> Tuple[str, str]:
    """检测 ffmpeg / ffprobe，未找到时抛出异常。"""
    ffmpeg = find_executable("ffmpeg")
    ffprobe = find_executable("ffprobe")
    if not ffmpeg or not ffprobe:
        raise FFmpegNotFoundError(
            "未检测到 ffmpeg / ffprobe，请先安装 FFmpeg 并加入 PATH。"
            " macOS: brew install ffmpeg    Ubuntu: apt install ffmpeg    "
            "Windows: https://www.gyan.dev/ffmpeg/builds/"
        )
    return ffmpeg, ffprobe


def check_yt_dlp() -> Optional[str]:
    """检测 yt-dlp 可用性。

    支持两种模式：
      1. 普通模式：检测系统的 yt-dlp 包
      2. 冻结模式（PyInstaller）：检测 frozen 状态下的 yt_dlp 模块
    """
    try:
        import yt_dlp  # type: ignore
        version = getattr(yt_dlp.version, "__version__", None)
        if version is None:
            # 新版 yt-dlp
            version = getattr(yt_dlp, "__version__", "unknown")
        return version
    except ImportError:
        return None


def check_optional_tool(name: str) -> Optional[str]:
    """检测可选工具（N_m3u8DL-RE / you-get / lux / gallery-dl）。"""
    binary = find_executable(name)
    if binary:
        return binary
    # 探测 Python 模块
    try:
        __import__(name.replace("-", "_"))
        return f"python:{name}"
    except ImportError:
        return None


# ----------------------------------------------------------------------
# 子进程
# ----------------------------------------------------------------------

def run_command(
    cmd,
    timeout: Optional[int] = None,
    env: Optional[dict] = None,
    cwd: Optional[str] = None,
    check: bool = False,
) -> subprocess.CompletedProcess:
    """运行外部命令并返回 CompletedProcess。"""
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=cwd,
            check=check,
        )
    except FileNotFoundError as e:
        raise RuntimeError(f"可执行文件不存在: {cmd[0]}") from e
    except subprocess.TimeoutExpired as e:
        raise TimeoutError(f"命令执行超时: {' '.join(cmd)}") from e


def human_readable_size(size_bytes: Optional[int]) -> str:
    if not size_bytes:
        return "未知"
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    for u in units:
        if size < 1024:
            return f"{size:.2f} {u}"
        size /= 1024
    return f"{size:.2f} PB"


def human_readable_duration(seconds: Optional[int]) -> str:
    if seconds is None:
        return "未知"
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def human_readable_speed(bps: float) -> str:
    if bps <= 0:
        return "0 B/s"
    return human_readable_size(int(bps)) + "/s"


def is_windows() -> bool:
    return sys.platform.startswith("win")


def is_macos() -> bool:
    return sys.platform == "darwin"


def is_linux() -> bool:
    return sys.platform.startswith("linux")


def free_disk_bytes(path: str) -> int:
    """获取指定路径所在磁盘的剩余空间（字节）。"""
    try:
        usage = shutil.disk_usage(Path(path).expanduser())
        return usage.free
    except Exception:
        return 0
