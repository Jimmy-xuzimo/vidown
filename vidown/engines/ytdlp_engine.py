"""yt-dlp 主引擎。

集成 yt-dlp 作为核心提取器：探测、下载、字幕、缩略图、元数据。
最终交给 FFmpegPostProcessor 强制转码 H.264 封装 MP4。
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.config import Config
from ..core.exceptions import (
    EngineError,
    DRMRestrictedError,
    FormatNotFoundError,
)
from ..core.format_selector import build_ytdlp_format_string
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
from ..core.platform_detect import classify_url
from ..core.utils import check_yt_dlp
from .base import BaseEngine, EngineCapability, EngineContext

logger = get_logger("engines.ytdlp")


class YtDlpEngine(BaseEngine):
    """封装 yt-dlp 作为主下载引擎。"""

    name = "ytdlp"
    display_name = "yt-dlp"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
        EngineCapability.FORMAT_LIST,
        EngineCapability.SUBTITLE,
        EngineCapability.THUMBNAIL,
    ]

    _H264_CODEC_RE = re.compile(r"^((he|a)vc|h26[45])", re.IGNORECASE)
    _HEVC_CODEC_RE = re.compile(r"^(hevc|h26[45])", re.IGNORECASE)

    def __init__(self, config: Config):
        super().__init__(config)
        version = check_yt_dlp()
        if not version:
            raise EngineError("yt-dlp 未安装，请运行 `pip install -U yt-dlp` 安装。")
        self._version = version
        # 延迟导入，加快启动速度
        import yt_dlp  # type: ignore

        self._yt_dlp = yt_dlp
        logger.info(f"yt-dlp 引擎就绪 (version={version})")

    # ------------------------------------------------------------------
    # 调度
    # ------------------------------------------------------------------
    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        # yt-dlp 能处理几乎所有 HTTP URL
        if not url:
            return False
        platform_enum, _ = classify_url(url)
        # 直链与 M3U8/MPD 让位给专用引擎
        if platform_enum in (Platform.M3U8, Platform.DASH, Platform.DIRECT):
            return False
        return True

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        # M3U8 / DASH / DIRECT 引擎优先；YouTube / Bilibili 等 100+
        priority_map = {
            Platform.YOUTUBE: 100,
            Platform.BILIBILI: 100,
            Platform.DOUYIN: 100,
            Platform.TIKTOK: 100,
            Platform.TWITTER: 100,
            Platform.X: 100,
            Platform.INSTAGRAM: 100,
            Platform.FACEBOOK: 100,
            Platform.VIMEO: 100,
            Platform.TWITCH: 100,
            Platform.YOUKU: 100,
            Platform.IQIYI: 100,
            Platform.TENCENT: 100,
            Platform.MANGETV: 100,
            Platform.NETFLIX: 50,  # 可能受 DRM 限制
            # 音频流媒体默认走 yt-dlp
            Platform.SOUNDCLOUD: 100,
            Platform.SPOTIFY: 100,
            Platform.BANDCAMP: 100,
            Platform.APPLE_MUSIC: 100,
            Platform.AMAZON_MUSIC: 100,
            Platform.TIDAL: 100,
            Platform.DEEZER: 100,
            Platform.AUDIUS: 100,
            Platform.MIXCLOUD: 100,
            Platform.HEARTHIS: 100,
            Platform.UNKNOWN: 80,
        }
        return priority_map.get(platform, 80)

    # ------------------------------------------------------------------
    # 探测
    # ------------------------------------------------------------------
    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        try:
            opts = self._build_ydl_options(ctx, download=False)
            with self._yt_dlp.YoutubeDL(opts) as ydl:
                data = ydl.extract_info(url, download=False, process=True)
        except self._yt_dlp.utils.DownloadError as e:
            msg = str(e)
            if "DRM" in msg or "Widevine" in msg:
                raise DRMRestrictedError(f"该资源受 DRM 保护: {msg}") from e
            if "Unable to extract" in msg or "No video formats" in msg:
                raise FormatNotFoundError(msg) from e
            raise EngineError(f"yt-dlp 探测失败: {msg}") from e
        except Exception as e:
            raise EngineError(f"yt-dlp 探测失败: {e}") from e
        return self._to_video_info(data, url)

    # ------------------------------------------------------------------
    # 下载
    # ------------------------------------------------------------------
    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        out_template, work_dir = self._build_output_template(task, info)
        opts = self._build_ydl_options(ctx, download=True, outtmpl=out_template)
        # 用户指定格式
        if task.selected_format_id:
            opts["format"] = task.selected_format_id
        else:
            opts["format"] = build_ytdlp_format_string(self.config.quality)

        # 下载进度 hook
        def _hook(d: Dict[str, Any]) -> None:
            self._on_ytdlp_progress(d, ctx, info)

        opts["progress_hooks"] = [_hook]

        # cookies
        if self.config.cookies.manual_cookies_file:
            opts["cookiefile"] = self.config.cookies.manual_cookies_file

        # 代理
        if self.config.network.proxy:
            opts["proxy"] = self.config.network.proxy

        # SponsorBlock
        # 兼容性说明：yt-dlp 较新版本中 ModifyChaptersPP 不再接受
        # `sponsorblock_mark` 关键字（已迁移到 SponsorBlock 处理器内部
        # 通过 `mark` 字段自动处理）。这里只注册 SponsorBlock PP，
        # 由它自己生成/更新 chapter 标记，避免触发
        # `ModifyChaptersPP.__init__() got an unexpected keyword argument`
        # 错误。
        if self.config.network.use_sponsorblock:
            opts["postprocessors"] = opts.get("postprocessors", [])
            opts["postprocessors"].append(
                {
                    "key": "SponsorBlock",
                    "categories": self.config.network.sponsorblock_categories,
                    "api": "https://sponsor.anjok.gq",
                }
            )

        # 格式统一转封装/转码由 vidown.postprocess 接管，
        # 不再依赖 yt-dlp 的 FFmpegVideoConvertor，避免其版本兼容问题。

        # 嵌入元数据
        if self.config.postprocess.embed_metadata:
            opts["postprocessors"].append({"key": "FFmpegMetadata"})
        if self.config.postprocess.embed_thumbnail:
            opts["writethumbnail"] = True
            opts["postprocessors"].append(
                {
                    "key": "EmbedThumbnail",
                    "already_have_thumbnail": False,
                }
            )
        if self.config.postprocess.embed_subtitles:
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = self.config.postprocess.subtitle_languages
            opts["postprocessors"].append(
                {
                    "key": "FFmpegEmbedSubtitle",
                }
            )

        # 重命名 / 不修改源
        if self.config.postprocess.preserve_original:
            opts["keepvideo"] = True

        try:
            with self._yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([info.url or info.webpage_url or task.url])

            # 定位最终文件
            output_path = self._find_final_file(work_dir)
            ctx.log("info", f"yt-dlp 下载完成: {output_path}")
            # 仅当输出非 MP4 时才需要后处理转封装
            needs_pp = not output_path.lower().endswith(".mp4")
            return DownloadResult(
                output_path=output_path,
                needs_postprocess=needs_pp,
                metadata=info,
                engine_name=self.name,
            )
        except self._yt_dlp.utils.DownloadError as e:
            msg = str(e)
            if "DRM" in msg or "Widevine" in msg:
                raise DRMRestrictedError(f"该资源受 DRM 保护: {msg}") from e
            raise EngineError(f"yt-dlp 下载失败: {msg}") from e
        except Exception as e:
            raise EngineError(f"yt-dlp 下载失败: {e}") from e

    # ------------------------------------------------------------------
    # 内部：构建 options / 转换数据
    # ------------------------------------------------------------------
    def _build_ydl_options(
        self, ctx: EngineContext, download: bool, outtmpl: Optional[str] = None
    ) -> Dict[str, Any]:
        opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "skip_download": not download,
            "retries": self.config.network.retry_max,
            "fragment_retries": self.config.network.retry_max,
            "concurrent_fragment_downloads": self.config.general.max_concurrent_fragments,
            "user_agent": self.config.network.user_agent,
            "socket_timeout": self.config.network.read_timeout,
            "ignoreerrors": False,
            "nocheckcertificate": False,
            "continuedl": True,
            "overwrites": False,
        }
        if outtmpl:
            opts["outtmpl"] = outtmpl
        if self.config.network.speed_limit_kbps > 0:
            opts["ratelimit"] = self.config.network.speed_limit_kbps * 1024  # bytes/s
        if self.config.cookies.manual_cookies_file:
            opts["cookiefile"] = self.config.cookies.manual_cookies_file
        if self.config.network.proxy:
            opts["proxy"] = self.config.network.proxy
        return opts

    def _build_output_template(self, task: DownloadTask, info: VideoInfo) -> tuple[str, Path]:
        # 每个任务独立的临时工作目录，避免全局搜索最终文件
        download_dir = Path(
            os.path.expandvars(os.path.expanduser(self.config.general.download_dir))
        )
        work_dir = download_dir / ".vidown_work" / task.id
        work_dir.mkdir(parents=True, exist_ok=True)

        # yt-dlp 输出模板
        tpl = self.config.naming.template
        # 将自定义模板中的字段替换为 yt-dlp 支持的占位符
        tpl = tpl.replace("%(uploader)s", "%(uploader,channel,uploader_id)s")
        tpl = tpl.replace("%(resolution)s", "%(res)r")
        # Windows 兼容
        if self.config.naming.sanitize_windows:
            tpl = tpl.replace("/", "／").replace("\\", "＼")
        # 限制长度
        tpl = tpl[: self.config.naming.max_length]
        # 强制以 .%(ext)s 结尾；无扩展名时直接追加
        if "." in tpl:
            tpl = tpl.rsplit(".", 1)[0] + ".%(ext)s"
        else:
            tpl = tpl + ".%(ext)s"
        return str(work_dir / tpl), work_dir

    def _find_final_file(self, work_dir: Path) -> str:
        """yt-dlp 下载完成后在工作目录中找到产出文件并移回下载目录。"""
        media_exts = {".mp4", ".mkv", ".webm", ".mov", ".flv", ".avi", ".m4a", ".m4v"}
        candidates = []
        for p in work_dir.rglob("*"):
            if p.is_file() and p.suffix.lower() in media_exts:
                candidates.append((p.stat().st_mtime, p))
        candidates.sort(reverse=True)
        if not candidates:
            raise EngineError("yt-dlp 下载后未找到媒体文件")

        src = candidates[0][1]
        download_dir = work_dir.parent.parent  # .vidown_work/<task_id> -> download_dir
        dest = download_dir / src.name
        # 处理同名文件：追加序号
        if dest.exists():
            stem, suffix = dest.stem, dest.suffix
            i = 1
            while True:
                dest = download_dir / f"{stem}-{i}{suffix}"
                if not dest.exists():
                    break
                i += 1
        src.replace(dest)

        # 清理空工作目录
        try:
            work_dir.rmdir()
        except OSError:
            pass
        return str(dest)

    def _to_video_info(self, data: Dict[str, Any], original_url: str) -> VideoInfo:
        # 平台
        platform_enum, _ = classify_url(data.get("webpage_url") or original_url)
        kind = MediaKind.PLAYLIST if data.get("_type") == "playlist" else MediaKind.VIDEO

        formats: List[FormatInfo] = []
        for f in data.get("formats", []) or []:
            formats.append(self._to_format(f))

        subtitles: Dict[str, List[str]] = {}
        for lang, subs in (data.get("subtitles") or {}).items():
            subtitles[lang] = [s.get("url", "") for s in subs if s.get("url")]

        chapters = data.get("chapters") or []
        tags = data.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

        info = VideoInfo(
            url=original_url,
            webpage_url=data.get("webpage_url") or original_url,
            platform=platform_enum,
            kind=kind,
            title=data.get("title") or data.get("id") or "untitled",
            uploader=data.get("uploader") or data.get("channel") or "",
            uploader_id=data.get("uploader_id") or data.get("channel_id") or "",
            duration=data.get("duration"),
            description=data.get("description") or "",
            thumbnail=data.get("thumbnail") or "",
            upload_date=str(data.get("upload_date") or ""),
            view_count=data.get("view_count"),
            like_count=data.get("like_count"),
            tags=tags,
            formats=formats,
            subtitles=subtitles,
            chapters=chapters,
            is_live=bool(data.get("is_live")),
            is_drm=False,
            extra={"ytdlp_id": data.get("id"), "extractor": data.get("extractor")},
        )
        return info

    def _to_format(self, f: Dict[str, Any]) -> FormatInfo:
        return FormatInfo(
            format_id=str(f.get("format_id") or ""),
            ext=f.get("ext") or "",
            resolution=f.get("resolution") or "",
            width=f.get("width"),
            height=f.get("height"),
            vcodec=f.get("vcodec") or "none",
            acodec=f.get("acodec") or "none",
            vbr=float(f.get("vbr") or 0) or 0.0,
            abr=float(f.get("abr") or 0) or 0.0,
            fps=f.get("fps"),
            tbr=float(f.get("tbr") or 0) or 0.0,
            filesize=f.get("filesize"),
            filesize_approx=f.get("filesize_approx"),
            format_note=f.get("format_note") or "",
            protocol=f.get("protocol") or "",
        )

    # ------------------------------------------------------------------
    # 进度回调
    # ------------------------------------------------------------------
    def _on_ytdlp_progress(self, d: Dict[str, Any], ctx: EngineContext, info: VideoInfo) -> None:
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            downloaded = d.get("downloaded_bytes") or 0
            speed = d.get("speed") or 0
            eta = d.get("eta")
            percent = 0.0
            if total:
                percent = downloaded * 100.0 / total
            progress = TaskProgress(
                downloaded_bytes=downloaded,
                total_bytes=total,
                speed_bps=float(speed),
                eta_seconds=int(eta) if eta else None,
                percent=min(100.0, percent),
                state="downloading",
            )
            ctx.update_progress(progress)
        elif status == "finished":
            ctx.update_progress(
                TaskProgress(
                    downloaded_bytes=d.get("downloaded_bytes") or 0,
                    total_bytes=d.get("total_bytes") or d.get("total_bytes_estimate"),
                    percent=100.0,
                    state="finished",
                )
            )
        elif status == "error":
            ctx.update_progress(TaskProgress(state="error"))
