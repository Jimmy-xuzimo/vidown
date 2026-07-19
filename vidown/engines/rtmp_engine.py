"""RTMP / RTMPS / RTSP 直播流下载引擎。

基于 FFmpeg 直接录制网络流，适用于：
  - 直播平台 RTMP 推流地址
  - 监控/会议 RTSP 流
  - 部分网站的 rtmp:// 媒体链接

由于直播流无固定时长，默认录制到用户取消或达到最大时长限制。
"""

from __future__ import annotations

import threading
import time

from ..core.config import Config
from ..core.exceptions import BinaryNotFoundError, EngineError, UserCancelledError
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
from ..core.path_utils import (
    get_download_dir,
    get_work_dir,
    move_to_download_dir,
    safe_name,
    unique_path,
)
from ..core.platform_detect import classify_url
from ..core.utils import find_executable
from ..postprocess.ffmpeg_pipe import FFmpegPipe
from .base import BaseEngine, EngineCapability, EngineContext

logger = get_logger("engines.rtmp")


class RtmpEngine(BaseEngine):
    """RTMP / RTSP 直播流录制引擎。"""

    name = "rtmp"
    display_name = "RTMP / RTSP"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
    ]

    # 默认最大直播录制时长（秒）
    DEFAULT_MAX_DURATION = 7200

    def __init__(self, config: Config):
        super().__init__(config)
        self._ffmpeg = find_executable("ffmpeg")

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not url:
            return False
        platform_enum, _ = classify_url(url)
        return platform_enum == Platform.RTMP

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        return 200

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        info = VideoInfo(
            url=url,
            webpage_url=url,
            platform=Platform.RTMP,
            kind=MediaKind.VIDEO,
            title=self._guess_title(url),
            is_live=True,
            extra={"protocol": self._detect_protocol(url)},
        )
        info.formats.append(
            FormatInfo(
                format_id="rtmp_default",
                ext="mp4",
                vcodec="unknown",
                acodec="unknown",
                tbr=0,
                protocol=self._detect_protocol(url),
                format_note="直播流（时长未知）",
            )
        )
        ctx.log("info", f"RTMP 探测完成: {url}")
        return info

    def download_info(
        self,
        task: DownloadTask,
        info: VideoInfo,
        ctx: EngineContext,
    ) -> DownloadResult:
        if not self._ffmpeg:
            raise BinaryNotFoundError("未找到 ffmpeg，无法录制 RTMP/RTSP 流")

        download_dir = get_download_dir(self.config)
        work_dir = get_work_dir(download_dir, task.id)
        out_path = work_dir / f"{safe_name(info.title, self.config)}.mp4"
        out_path = unique_path(out_path)

        max_duration = self._get_max_duration()
        protocol = info.extra.get("protocol", "rtmp")

        ctx.log("info", f"开始录制 {protocol.upper()} 直播: {info.url}")
        ctx.update_progress(
            TaskProgress(
                downloaded_bytes=0,
                total_bytes=None,
                speed_bps=0.0,
                eta_seconds=None,
                percent=0.0,
                fragment_index=0,
                fragment_count=0,
                state="downloading",
            )
        )

        args = [
            "-fflags",
            "+discardcorrupt",
            "-i",
            info.url,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-t",
            str(max_duration),
            str(out_path),
        ]

        pipe = FFmpegPipe(binary=self._ffmpeg)
        started = time.time()
        cancelled = False

        def _monitor() -> None:
            """后台监控：检查取消标志并定期上报进度。"""
            nonlocal cancelled
            ctx.log("debug", f"RTMP 监控线程启动: max_duration={max_duration}s")
            while not cancelled:
                if ctx.cancel_flag and ctx.cancel_flag():
                    ctx.log("warning", "RTMP 收到取消信号，终止录制")
                    cancelled = True
                    pipe.cancel()
                    return
                elapsed = time.time() - started
                if elapsed >= max_duration:
                    ctx.log("info", f"RTMP 达到最大录制时长 {max_duration}s，正常结束")
                    pipe.cancel()
                    return
                if out_path.exists():
                    size = out_path.stat().st_size
                    percent = min(100.0, elapsed * 100.0 / max_duration)
                    ctx.log(
                        "debug",
                        f"RTMP 进度: elapsed={elapsed:.1f}s, size={size}, "
                        f"percent={percent:.2f}%, speed={size / max(elapsed, 1e-3):.2f} B/s",
                    )
                    ctx.update_progress(
                        TaskProgress(
                            downloaded_bytes=size,
                            total_bytes=None,
                            speed_bps=size / max(elapsed, 1e-3),
                            eta_seconds=None,
                            percent=percent,
                            fragment_index=0,
                            fragment_count=0,
                            state="downloading",
                        )
                    )
                time.sleep(1)

        monitor_thread = threading.Thread(target=_monitor, daemon=True)
        monitor_thread.start()

        try:
            pipe.run(args, timeout=max_duration + 30)
        except TimeoutError:
            # 达到最大录制时长，正常结束
            pass
        except Exception as e:
            if cancelled or (ctx.cancel_flag and ctx.cancel_flag()):
                raise UserCancelledError("用户取消录制") from e
            if not out_path.exists():
                raise EngineError(f"{protocol.upper()} 录制失败: {e}") from e
        finally:
            cancelled = True
            monitor_thread.join(timeout=2)

        if not out_path.exists():
            if ctx.cancel_flag and ctx.cancel_flag():
                raise UserCancelledError("用户取消录制")
            raise EngineError("直播录制未生成输出文件")

        recorded = time.time() - started
        ctx.update_progress(
            TaskProgress(
                downloaded_bytes=out_path.stat().st_size,
                total_bytes=None,
                speed_bps=0.0,
                eta_seconds=0,
                percent=100.0,
                fragment_index=0,
                fragment_count=0,
                state="finished",
            )
        )
        ctx.log("info", f"{protocol.upper()} 录制完成: {out_path} ({recorded:.1f}s)")

        final_path = move_to_download_dir(out_path, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name=self.name,
        )

    def _detect_protocol(self, url: str) -> str:
        lower = url.lower()
        if lower.startswith("rtmps://"):
            return "rtmps"
        if lower.startswith("rtsp://"):
            return "rtsp"
        return "rtmp"

    def _guess_title(self, url: str) -> str:
        # 去掉协议前缀取主机名/路径作为标题
        lower = url.lower()
        for prefix in ("rtmp://", "rtmps://", "rtsp://"):
            if lower.startswith(prefix):
                rest = url[len(prefix) :]
                return rest.split("/")[-1] or rest.split("/")[0] or "rtmp_stream"
        return "rtmp_stream"

    def _get_max_duration(self) -> int:
        # 未来可扩展为配置项；目前使用默认值
        return self.DEFAULT_MAX_DURATION
