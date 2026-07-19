"""M3U8 / HLS / DASH 流媒体下载引擎。

策略：
  1. 优先调用 N_m3u8DL-RE（业界最稳健的 M3U8 下载器）
  2. 退化为内置多线程 TS 片段下载（AES-128 / SAMPLE-AES 解密）
  3. 通过 FFmpeg 后处理统一封装为 H.264 MP4

本模块作为调度入口，具体的探测/外部下载/内部下载逻辑已拆分到：
  - m3u8_probe.py
  - m3u8_external.py
  - m3u8_internal.py
"""

from __future__ import annotations

from pathlib import Path

from ..core.config import Config
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, MediaKind, Platform, VideoInfo
from ..core.path_utils import get_download_dir, get_work_dir, move_to_download_dir, safe_name
from ..core.platform_detect import classify_url
from .base import BaseEngine, EngineCapability, EngineContext
from .m3u8_external import M3U8ExternalDownloader
from .m3u8_internal import M3U8InternalDownloader
from .m3u8_probe import M3U8Probe

logger = get_logger("engines.m3u8")


class M3U8Engine(BaseEngine):
    """M3U8 / HLS / DASH 下载引擎（调度入口）。"""

    name = "m3u8"
    display_name = "M3U8 / HLS / DASH"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
        EngineCapability.FORMAT_LIST,
    ]

    def __init__(self, config: Config):
        super().__init__(config)
        self._probe = M3U8Probe(config)
        self._external = M3U8ExternalDownloader(config)
        self._internal = M3U8InternalDownloader(config)

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not url:
            return False
        platform_enum, _ = classify_url(url)
        return platform_enum == Platform.M3U8

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        return 200  # 专门处理 M3U8/DASH

    # ------------------------------------------------------------------
    # 探测（解析 m3u8 主清单，提取码率/分辨率）
    # ------------------------------------------------------------------
    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        return self._probe.probe(url, ctx)

    # ------------------------------------------------------------------
    # 下载
    # ------------------------------------------------------------------
    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        if self._external.available:
            return self._external.download(info, task, ctx, work_dir, download_dir)
        return self._internal.download(
            info,
            task,
            ctx,
            work_dir,
            download_dir,
            safe_name,
            self._unique_path,
            move_to_download_dir,
        )

    @staticmethod
    def _unique_path(p: Path) -> Path:
        from ..core.path_utils import unique_path

        return unique_path(p)
