"""备用引擎集合：you-get / lux / gallery-dl。

这些引擎在 yt-dlp / M3U8 引擎失败时作为 fallback。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import List, Optional

from ..core.config import Config
from ..core.exceptions import EngineError
from ..core.logger import get_logger
from ..core.models import (
    DownloadTask,
    MediaKind,
    Platform,
    VideoInfo,
)
from ..core.utils import find_executable
from .base import BaseEngine, EngineCapability, EngineContext

logger = get_logger("engines.fallback")


# ----------------------------------------------------------------------
# 通用：解析命令行下载器输出
# ----------------------------------------------------------------------


def _find_most_recent(download_dir: Path, exts: List[str]) -> Optional[Path]:
    candidates: List[Path] = []
    for ext in exts:
        candidates.extend(download_dir.rglob(f"*.{ext}"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


# ----------------------------------------------------------------------
# you-get
# ----------------------------------------------------------------------


class YouGetEngine(BaseEngine):
    name = "you_get"
    display_name = "you-get"
    capabilities = [EngineCapability.PROBE, EngineCapability.DOWNLOAD]

    def __init__(self, config: Config):
        super().__init__(config)
        try:
            import you_get  # type: ignore

            self._module = you_get
            self._has_python = True
        except ImportError:
            self._module = None
            self._has_python = False
        self._binary = find_executable("you-get")

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        # you-get 主要支持中文站点
        cn = {
            Platform.BILIBILI,
            Platform.DOUYIN,
            Platform.IQIYI,
            Platform.YOUKU,
            Platform.TENCENT,
            Platform.MANGETV,
        }
        if platform in cn:
            return True
        # 兜底：通用
        if self._has_python or self._binary:
            return True
        return False

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        cn = {
            Platform.BILIBILI,
            Platform.DOUYIN,
            Platform.IQIYI,
            Platform.YOUKU,
            Platform.TENCENT,
            Platform.MANGETV,
        }
        if platform in cn:
            return 60  # 低于 yt-dlp
        return 10

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        # 简化：直接返回基本信息
        return VideoInfo(url=url, title=url, platform=Platform.UNKNOWN)

    def download_info(self, task: DownloadTask, info: VideoInfo, ctx: EngineContext) -> str:
        download_dir = self._download_dir()
        if self._binary:
            cmd = [self._binary, "-o", download_dir, "-f", info.url]
        else:
            cmd = ["python", "-m", "you_get", "-o", download_dir, "-f", info.url]
        ctx.log("info", f"调用 you-get: {' '.join(cmd)}")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
            )
        except Exception as e:
            raise EngineError(f"you-get 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"you-get 失败: {proc.stderr}")
        out = _find_most_recent(Path(download_dir), ["mp4", "webm", "flv"])
        if not out:
            raise EngineError("you-get 未产出可识别的视频文件")
        return str(out)

    def _download_dir(self) -> str:
        d = os.path.expandvars(os.path.expanduser(self.config.general.download_dir))
        os.makedirs(d, exist_ok=True)
        return d


# ----------------------------------------------------------------------
# lux
# ----------------------------------------------------------------------


class LuxEngine(BaseEngine):
    name = "lux"
    display_name = "lux"
    capabilities = [EngineCapability.DOWNLOAD]

    def __init__(self, config: Config):
        super().__init__(config)
        self._binary = find_executable("lux") or find_executable("annie")

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not self._binary:
            return False
        # lux 主要支持部分国内站点 + 通用视频直链
        return True

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        return 5

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        return VideoInfo(url=url, title=url, platform=Platform.UNKNOWN)

    def download_info(self, task: DownloadTask, info: VideoInfo, ctx: EngineContext) -> str:
        download_dir = self._download_dir()
        cmd = [self._binary, "-d", download_dir, "-o", download_dir, info.url]
        ctx.log("info", f"调用 lux: {' '.join(cmd)}")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
            )
        except Exception as e:
            raise EngineError(f"lux 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"lux 失败: {proc.stderr}")
        out = _find_most_recent(Path(download_dir), ["mp4", "mkv", "webm"])
        if not out:
            raise EngineError("lux 未产出可识别的视频文件")
        return str(out)

    def _download_dir(self) -> str:
        d = os.path.expandvars(os.path.expanduser(self.config.general.download_dir))
        os.makedirs(d, exist_ok=True)
        return d


# ----------------------------------------------------------------------
# gallery-dl
# ----------------------------------------------------------------------


class GalleryDLEngine(BaseEngine):
    name = "gallery_dl"
    display_name = "gallery-dl"
    capabilities = [EngineCapability.DOWNLOAD]

    def __init__(self, config: Config):
        super().__init__(config)
        try:
            import gallery_dl  # type: ignore

            self._module = gallery_dl
            self._has_python = True
        except ImportError:
            self._module = None
            self._has_python = False
        self._binary = find_executable("gallery-dl")

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not (self._binary or self._has_python):
            return False
        if kind == MediaKind.IMAGE:
            return True
        # 兜底：gallery-dl 也支持部分图集型视频站点
        return True

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        if kind == MediaKind.IMAGE:
            return 80
        return 5

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        return VideoInfo(url=url, title=url, platform=Platform.UNKNOWN, kind=MediaKind.IMAGE)

    def download_info(self, task: DownloadTask, info: VideoInfo, ctx: EngineContext) -> str:
        download_dir = self._download_dir()
        if self._binary:
            cmd = [self._binary, "-d", download_dir, info.url]
        else:
            cmd = ["python", "-m", "gallery_dl", "-d", download_dir, info.url]
        ctx.log("info", f"调用 gallery-dl: {' '.join(cmd)}")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except Exception as e:
            raise EngineError(f"gallery-dl 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"gallery-dl 失败: {proc.stderr}")
        # gallery-dl 多为目录，压缩成 zip
        root = Path(download_dir)
        sub = sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        if not sub:
            raise EngineError("gallery-dl 未产出可识别文件")
        return str(sub[0])

    def _download_dir(self) -> str:
        d = os.path.expandvars(os.path.expanduser(self.config.general.download_dir))
        os.makedirs(d, exist_ok=True)
        return d
