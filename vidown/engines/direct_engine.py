"""直链 / HTTP 单文件下载引擎。"""

from __future__ import annotations

import os
import re
import time
from typing import Optional

from ..core.config import Config
from ..core.exceptions import (
    EngineError,
    InsufficientDiskSpaceError,
    NetworkError,
    UserCancelledError,
)
from ..core.logger import get_logger
from ..core.models import (
    DownloadResult,
    DownloadTask,
    FormatInfo,
    MediaKind,
    Platform,
    TaskProgress,
    VideoInfo,
)
from ..core.network import http_get, http_head
from ..core.path_utils import get_download_dir, unique_path
from ..core.platform_detect import classify_url
from ..core.utils import free_disk_bytes, human_readable_size, sanitize_filename
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
            resp = http_head(url, self.config, allow_redirects=True)
        except NetworkError:
            raise
        except Exception as e:
            raise NetworkError(f"探测直链失败: {e}") from e

        # 某些服务器对 HEAD 返回 200 但无 Content-Length，
        # 这里尽量从已有 headers 中读取；必要时 download_info 再补一次。
        size = self._parse_content_length(resp.headers.get("Content-Length"))
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
    ) -> DownloadResult:
        download_dir = get_download_dir(self.config)
        # 估算所需空间
        size = None
        if info.formats:
            size = info.formats[0].filesize
        if size:
            free = free_disk_bytes(str(download_dir))
            if free and free < size * 1.2:
                raise InsufficientDiskSpaceError(
                    f"磁盘空间不足：需要约 {human_readable_size(size)}，"
                    f"剩余 {human_readable_size(free)}"
                )

        out_name = (
            sanitize_filename(info.title or "download")
            + "."
            + ((info.formats[0].ext if info.formats else "bin") or "bin")
        )
        base_path = download_dir / out_name

        # 支持断点续传：仅当服务器支持 Range 且目标文件已存在时复用原文件名
        existing = 0
        mode = "wb"
        out_path = base_path
        if base_path.exists() and info.extra.get("accept_ranges"):
            existing = base_path.stat().st_size
            mode = "ab"
        elif base_path.exists():
            # 不续传但文件已存在：生成唯一文件名
            out_path = unique_path(base_path)

        headers = {}
        if existing > 0 and info.extra.get("accept_ranges"):
            headers["Range"] = f"bytes={existing}-"

        ctx.log(
            "info",
            f"开始下载直链: {info.url} -> {out_path}, "
            f"existing={existing}, accept_ranges={info.extra.get('accept_ranges')}, "
            f"mode={mode}",
        )
        try:
            with http_get(
                info.url,
                self.config,
                stream=True,
                headers=headers,
            ) as resp:
                total = int(resp.headers.get("Content-Length") or 0) + existing
                downloaded = existing
                start = time.time()
                last_report = start
                ctx.log(
                    "info",
                    f"HTTP 响应: status={resp.status_code}, "
                    f"content_length={resp.headers.get('Content-Length')}, "
                    f"total={total}",
                )
                with open(out_path, mode) as f:
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if ctx.cancel_flag and ctx.cancel_flag():
                            ctx.log("warning", "用户取消直链下载")
                            raise UserCancelledError("用户取消")
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        if now - last_report > 0.3:
                            last_report = now
                            speed = (downloaded - existing) / max(1e-3, now - start)
                            eta = (total - downloaded) / speed if speed > 0 and total else None
                            percent = (downloaded * 100.0 / total) if total else 0.0
                            ctx.log(
                                "debug",
                                f"直链进度: downloaded={downloaded}, total={total}, "
                                f"percent={percent:.2f}%, speed={human_readable_size(int(speed))}/s",
                            )
                            ctx.update_progress(
                                TaskProgress(
                                    downloaded_bytes=downloaded,
                                    total_bytes=total or None,
                                    speed_bps=speed,
                                    eta_seconds=int(eta) if eta else None,
                                    percent=percent,
                                    state="downloading",
                                )
                            )
        except UserCancelledError:
            raise
        except NetworkError:
            raise
        except Exception as e:
            raise EngineError(f"直链下载失败: {e}") from e

        ctx.log("info", f"直链下载完成: {out_path}, size={downloaded}")
        ctx.update_progress(
            TaskProgress(
                downloaded_bytes=downloaded,
                total_bytes=total or None,
                percent=100.0,
                state="finished",
            )
        )
        return DownloadResult(
            output_path=str(out_path),
            needs_postprocess=False,
            metadata=info,
            engine_name=self.name,
        )

    @staticmethod
    def _parse_content_length(value: Optional[str]) -> Optional[int]:
        if not value:
            return None
        try:
            return int(value)
        except ValueError:
            return None

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
        from urllib.parse import unquote, urlparse

        p = urlparse(url)
        name = unquote(os.path.basename(p.path)) or p.netloc
        # 去掉扩展名
        return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
