"""备用引擎集合：you-get / lux / gallery-dl。

这些引擎在 yt-dlp / M3U8 引擎失败时作为 fallback。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import List, Optional

from ..core.config import Config
from ..core.exceptions import BinaryNotFoundError, EngineError
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, MediaKind, Platform, VideoInfo
from ..core.path_utils import get_download_dir, get_work_dir, move_to_download_dir
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

    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        if self._binary:
            cmd = [self._binary, "-o", str(work_dir), info.url]
        elif self._has_python:
            cmd = [sys.executable, "-m", "you_get", "-o", str(work_dir), info.url]
        else:
            raise BinaryNotFoundError("you-get 未安装")
        ctx.log("info", f"调用 you-get: {' '.join(cmd)}")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.config.engines.fallbacks["you_get"].timeout,
            )
        except FileNotFoundError as e:
            raise BinaryNotFoundError(f"you-get 可执行文件不存在: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise EngineError(f"you-get 执行超时: {e}") from e
        except Exception as e:
            raise EngineError(f"you-get 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"you-get 失败: {proc.stderr}")
        out = _find_most_recent(work_dir, ["mp4", "webm", "flv"])
        if not out:
            raise EngineError("you-get 未产出可识别的视频文件")
        final_path = move_to_download_dir(out, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name=self.name,
        )


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

    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        if not self._binary:
            raise BinaryNotFoundError("lux 未安装")
        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        cmd = [self._binary, "-d", str(work_dir), "-o", str(work_dir), info.url]
        ctx.log("info", f"调用 lux: {' '.join(cmd)}")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.config.engines.fallbacks["lux"].timeout,
            )
        except FileNotFoundError as e:
            raise BinaryNotFoundError(f"lux 可执行文件不存在: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise EngineError(f"lux 执行超时: {e}") from e
        except Exception as e:
            raise EngineError(f"lux 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"lux 失败: {proc.stderr}")
        out = _find_most_recent(work_dir, ["mp4", "mkv", "webm"])
        if not out:
            raise EngineError("lux 未产出可识别的视频文件")
        final_path = move_to_download_dir(out, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name=self.name,
        )


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

    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        if self._binary:
            cmd = [self._binary, "-d", str(work_dir), info.url]
        elif self._has_python:
            cmd = [sys.executable, "-m", "gallery_dl", "-d", str(work_dir), info.url]
        else:
            raise BinaryNotFoundError("gallery-dl 未安装")
        ctx.log("info", f"调用 gallery-dl: {' '.join(cmd)}")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.config.engines.fallbacks["gallery_dl"].timeout,
            )
        except FileNotFoundError as e:
            raise BinaryNotFoundError(f"gallery-dl 可执行文件不存在: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise EngineError(f"gallery-dl 执行超时: {e}") from e
        except Exception as e:
            raise EngineError(f"gallery-dl 执行失败: {e}") from e
        if proc.returncode != 0:
            raise EngineError(f"gallery-dl 失败: {proc.stderr}")
        # gallery-dl 多为目录，取工作目录内最新项
        sub = sorted(work_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        if not sub:
            raise EngineError("gallery-dl 未产出可识别文件")
        out = sub[0]
        final_path = move_to_download_dir(out, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name=self.name,
        )
