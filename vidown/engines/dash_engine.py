"""DASH / MPD 下载引擎入口。

职责：
  - 识别 DASH URL（.mpd / manifest）
  - 调用 MPDProbe 解析清单
  - 调用 DashDownloader 下载分段
  - 对复杂或 DRM 场景优雅降级到 yt-dlp（若用户启用）
"""

from __future__ import annotations

from ..core.config import Config
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, MediaKind, Platform, VideoInfo
from ..core.path_utils import get_download_dir, get_work_dir
from ..core.platform_detect import classify_url
from .base import BaseEngine, EngineCapability, EngineContext
from .dash_downloader import DashDownloader
from .dash_probe import MPDProbe

logger = get_logger("engines.dash")


class DashEngine(BaseEngine):
    """DASH / MPD 下载引擎。"""

    name = "dash"
    display_name = "DASH / MPD"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
        EngineCapability.FORMAT_LIST,
    ]

    def __init__(self, config: Config):
        super().__init__(config)
        self._probe = MPDProbe(config)
        self._downloader = DashDownloader(config)

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not url:
            return False
        platform_enum, _ = classify_url(url)
        return platform_enum == Platform.DASH

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        return 200

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        return self._probe.probe(url, ctx)

    def download_info(
        self,
        task: DownloadTask,
        info: VideoInfo,
        ctx: EngineContext,
    ) -> DownloadResult:
        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        return self._downloader.download(info, task, ctx, work_dir, download_dir)
