"""直链 / HTTP 单文件下载引擎。"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Optional

import requests

from ..core.config import Config
from ..core.exceptions import EngineError, NetworkError
from ..core.logger import get_logger
from ..core.models import (
    DownloadTask,
    FormatInfo,
    MediaKind,
    Platform,
    TaskProgress,
    VideoInfo,
)
from ..core.platform_detect import classify_url
from ..core.utils import (
    expand_path,
    find_executable,
    free_disk_bytes,
    human_readable_size,
    sanitize_filename,
)
from .base import BaseEngine, EngineCapability, EngineContext

logger = get_logger("engines.direct")


class DirectEngine(BaseEngine):
    """处理 .mp4 / .webm / .m4a / 已知文件后缀的直链。"""

    name = "direct"
    display_name = "HTTP 直链"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
    ]

    def __init__(self, config: Config):
        super().__init__(config)

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not url:
            return False
        p, _ = classify_url(url)
        return p == Platform.DIRECT or kind in (MediaKind.IMAGE, MediaKind.AUDIO)

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        if kind == MediaKind.IMAGE:
            return 50
        return 150

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        try:
            proxies = (
                {"http": self.config.network.proxy, "https": self.config.network.proxy}
                if self.config.network.proxy else None
            )
            resp = requests.head(
                url, allow_redirects=True, timeout=self.config.network.connect_timeout,
                headers={"User-Agent": self.config.network.user_agent},
                proxies=proxies,
            )
            if resp.status_code >= 400:
                # HEAD 失败则尝试 GET 一次拿到 headers
                resp = requests.get(
                    url, stream=True, timeout=self.config.network.connect_timeout,
                    headers={"User-Agent": self.config.network.user_agent},
                    proxies=proxies,
                )
        except Exception as e:
            raise NetworkError(f"探测直链失败: {e}") from e

        size = int(resp.headers.get("Content-Length") or 0) or None
        accept = resp.headers.get("Accept-Ranges", "").lower() == "bytes"
        ext = self._ext_from_url(url) or self._ext_from_content_type(
            resp.headers.get("Content-Type", "")
        )
        _, kind = classify_url(url)
        platform_enum, _ = classify_url(url)

        info = VideoInfo(
            url=url,
            webpage_url=url,
            platform=platform_enum,
            kind=kind,
            title=self._title_from_url(url),
        )
        info.formats.append(
            FormatInfo(
                format_id="direct",
                ext=ext or "bin",
                vcodec="unknown",
                acodec="unknown",
                tbr=0,
                filesize=size,
                protocol="http",
            )
        )
        info.extra["accept_ranges"] = accept
        return info

    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> str:
        download_dir = expand_path(self.config.general.download_dir)
        # 估算所需空间
        size = None
        if info.formats:
            size = info.formats[0].filesize
        if size:
            free = free_disk_bytes(str(download_dir))
            if free and free < size * 1.2:
                raise EngineError(
                    f"磁盘空间不足：需要约 {human_readable_size(size)}，"
                    f"剩余 {human_readable_size(free)}"
                )

        out_name = sanitize_filename(info.title or "download") + "." + (
            (info.formats[0].ext if info.formats else "bin") or "bin"
        )
        out_path = download_dir / out_name
        i = 1
        while out_path.exists():
            out_path = download_dir / f"{out_path.stem}-{i}{out_path.suffix}"
            i += 1

        proxies = (
            {"http": self.config.network.proxy, "https": self.config.network.proxy}
            if self.config.network.proxy else None
        )

        # 支持断点续传
        existing = 0
        mode = "wb"
        if out_path.exists():
            existing = out_path.stat().st_size
            mode = "ab"

        headers = {
            "User-Agent": self.config.network.user_agent,
        }
        if existing > 0 and info.extra.get("accept_ranges"):
            headers["Range"] = f"bytes={existing}-"

        ctx.log("info", f"开始下载直链: {info.url} -> {out_path}")
        try:
            with requests.get(
                info.url,
                stream=True,
                timeout=(self.config.network.connect_timeout, self.config.network.read_timeout),
                headers=headers,
                proxies=proxies,
            ) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("Content-Length") or 0) + existing
                downloaded = existing
                start = time.time()
                last_report = start
                with open(out_path, mode) as f:
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if ctx.cancel_flag and ctx.cancel_flag():
                            raise EngineError("用户取消")
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        if now - last_report > 0.3:
                            last_report = now
                            speed = (downloaded - existing) / max(1e-3, now - start)
                            eta = (total - downloaded) / speed if speed > 0 and total else None
                            ctx.update_progress(
                                TaskProgress(
                                    downloaded_bytes=downloaded,
                                    total_bytes=total or None,
                                    speed_bps=speed,
                                    eta_seconds=int(eta) if eta else None,
                                    percent=(downloaded * 100.0 / total) if total else 0,
                                    state="downloading",
                                )
                            )
        except requests.exceptions.RequestException as e:
            raise NetworkError(f"直链下载失败: {e}") from e
        except EngineError:
            raise
        except Exception as e:
            raise EngineError(f"直链下载失败: {e}") from e

        ctx.update_progress(
            TaskProgress(
                downloaded_bytes=downloaded,
                total_bytes=total or None,
                percent=100.0,
                state="finished",
            )
        )
        return str(out_path)

    @staticmethod
    def _ext_from_url(url: str) -> Optional[str]:
        m = re.search(r"\.([A-Za-z0-9]{2,5})(?:\?|$)", url)
        if m:
            return m.group(1).lower()
        return None

    @staticmethod
    def _ext_from_content_type(ct: str) -> Optional[str]:
        if not ct:
            return None
        ct = ct.split(";")[0].strip().lower()
        mapping = {
            "video/mp4": "mp4",
            "video/webm": "webm",
            "video/x-matroska": "mkv",
            "video/quicktime": "mov",
            "audio/mpeg": "mp3",
            "audio/mp4": "m4a",
            "audio/aac": "aac",
            "audio/flac": "flac",
            "audio/ogg": "ogg",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
        }
        return mapping.get(ct)

    @staticmethod
    def _title_from_url(url: str) -> str:
        from urllib.parse import urlparse, unquote
        p = urlparse(url)
        name = unquote(os.path.basename(p.path)) or p.netloc
        # 去掉扩展名
        return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
