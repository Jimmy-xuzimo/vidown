"""DASH 分段下载与合并模块。

负责下载 Representation 的 initialization segment 与 media segments，
并通过 ffmpeg 合并为最终 MP4。

对直播(dynamic) MPD，采用 ffmpeg 直接拉取，避免持续刷新 MPD 的复杂度。
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

import requests  # type: ignore

from ..core.config import Config
from ..core.exceptions import BinaryNotFoundError, EngineError, UserCancelledError
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, TaskProgress, VideoInfo
from ..core.network import get_proxies, make_session
from ..core.path_utils import move_to_download_dir
from ..core.utils import find_executable
from ..postprocess.ffmpeg_pipe import run_ffmpeg
from .base import EngineContext
from .dash_probe import DashManifest, SegmentInfo

logger = get_logger("engines.dash.downloader")


class DashDownloader:
    """DASH 下载器。"""

    def __init__(self, config: Config):
        self.config = config

    def download(
        self,
        info: VideoInfo,
        task: DownloadTask,
        ctx: EngineContext,
        work_dir: Path,
        download_dir: Path,
    ) -> DownloadResult:
        manifest = info.extra.get("manifest")
        if not isinstance(manifest, DashManifest):
            raise EngineError("DASH 下载缺少已解析的 manifest")

        if manifest.is_dynamic:
            # 直播流：直接用 ffmpeg 拉取，避免持续刷新 MPD
            return self._download_live(info, task, ctx, work_dir, download_dir, manifest)

        return self._download_vod(
            info,
            task,
            ctx,
            work_dir,
            download_dir,
            manifest,
        )

    def _download_vod(
        self,
        info: VideoInfo,
        task: DownloadTask,
        ctx: EngineContext,
        work_dir: Path,
        download_dir: Path,
        manifest: DashManifest,
    ) -> DownloadResult:
        # 确定要下载的视频/音频 representation
        video_seg, audio_seg = self._select_segments(info, task, manifest)
        if not video_seg and not audio_seg:
            raise EngineError("未找到可下载的视频或音频 Representation")

        sess = make_session(self.config)
        proxies = get_proxies(self.config)

        # 下载视频
        ctx.log(
            "info",
            f"DASH VOD 选择: video={video_seg.representation_id if video_seg else None}, "
            f"audio={audio_seg.representation_id if audio_seg else None}",
        )

        video_path: Optional[Path] = None
        if video_seg:
            video_path = self._download_representation(
                video_seg,
                work_dir / "video",
                sess,
                proxies,
                ctx,
                label="视频",
            )

        # 下载音频
        audio_path: Optional[Path] = None
        if audio_seg:
            audio_path = self._download_representation(
                audio_seg,
                work_dir / "audio",
                sess,
                proxies,
                ctx,
                label="音频",
            )

        if ctx.cancel_flag and ctx.cancel_flag():
            raise UserCancelledError("用户取消")

        # 合并
        out_path = work_dir / f"{self._safe_name(info.title)}.mp4"
        out_path = self._unique_path(out_path)

        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            raise BinaryNotFoundError("未找到 ffmpeg，无法合并 DASH 分段")

        if video_path and audio_path:
            from ..postprocess.ffmpeg_pipe import merge_streams

            merge_streams(
                str(video_path),
                str(audio_path),
                str(out_path),
                ffmpeg_bin=ffmpeg,
                prefer_copy=True,
            )
        elif video_path:
            self._ffmpeg_copy(str(video_path), str(out_path), ffmpeg)
        elif audio_path:
            self._ffmpeg_copy(str(audio_path), str(out_path), ffmpeg)

        final_path = move_to_download_dir(out_path, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name="dash",
        )

    def _download_live(
        self,
        info: VideoInfo,
        task: DownloadTask,
        ctx: EngineContext,
        work_dir: Path,
        download_dir: Path,
        manifest: DashManifest,
    ) -> DownloadResult:
        """直播流使用 ffmpeg 直接录制。"""
        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            raise BinaryNotFoundError("未找到 ffmpeg，无法录制直播流")

        out_path = work_dir / f"{self._safe_name(info.title)}.mp4"
        out_path = self._unique_path(out_path)

        ctx.log("info", f"开始录制 DASH 直播: {manifest.url}")

        # 直播默认录制 2 小时或直到用户取消；可在配置中扩展
        duration = self.config.engines.m3u8dl.retry_count * 600  # 占位，用通用配置
        args = [
            "-i",
            manifest.url,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-t",
            str(duration),
            str(out_path),
        ]

        proc = None
        try:
            proc = run_ffmpeg(args, ffmpeg_bin=ffmpeg, timeout=None)
        except TimeoutError:
            # 达到最大录制时长，视为成功
            pass
        except Exception as e:
            raise EngineError(f"DASH 直播录制失败: {e}") from e

        if proc and proc.returncode != 0 and not out_path.exists():
            raise EngineError(f"ffmpeg 录制失败: {proc.stderr}")

        if not out_path.exists():
            raise EngineError("DASH 直播未生成输出文件")

        final_path = move_to_download_dir(out_path, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name="dash",
        )

    def _select_segments(
        self,
        info: VideoInfo,
        task: DownloadTask,
        manifest: DashManifest,
    ) -> tuple[Optional[SegmentInfo], Optional[SegmentInfo]]:
        video_segs = [s for s in manifest.segments if s.mime_type.startswith("video/")]
        audio_segs = [s for s in manifest.segments if s.mime_type.startswith("audio/")]

        selected_id = task.selected_format_id
        video_seg: Optional[SegmentInfo] = None
        audio_seg: Optional[SegmentInfo] = None

        if selected_id:
            for seg in manifest.segments:
                if seg.representation_id == selected_id:
                    if seg.mime_type.startswith("video/"):
                        video_seg = seg
                    else:
                        audio_seg = seg
                    break

        if not video_seg and video_segs:
            video_seg = max(video_segs, key=lambda s: s.bandwidth)
        if not audio_seg and audio_segs:
            audio_seg = max(audio_segs, key=lambda s: s.bandwidth)

        return video_seg, audio_seg

    def _download_representation(
        self,
        seg: SegmentInfo,
        seg_dir: Path,
        sess: requests.Session,
        proxies: Optional[dict],
        ctx: EngineContext,
        label: str,
    ) -> Path:
        seg_dir.mkdir(parents=True, exist_ok=True)
        output_path = (
            seg_dir
            / f"stream.{seg.representation_id}.{'m4v' if seg.mime_type.startswith('video/') else 'm4a'}"
        )

        init_url = seg.initialization
        segs = seg.media_segments
        total = len(segs) + (1 if init_url else 0)
        done = 0
        bytes_done = 0
        start = time.time()

        # 写入 init segment
        with open(output_path, "wb") as out_f:
            if init_url:
                data = self._fetch_segment(init_url, sess, proxies, ctx)
                out_f.write(data)
                done += 1
                bytes_done += len(data)

            threads = self.config.engines.m3u8dl.threads

            def _fetch_and_write(idx: int, url: str) -> int:
                data = self._fetch_segment(url, sess, proxies, ctx)
                return idx, len(data), data

            results: List[tuple[int, int, bytes]] = []
            with ThreadPoolExecutor(max_workers=threads) as pool:
                futures = {pool.submit(_fetch_and_write, i, u): i for i, u in enumerate(segs)}
                for fut in as_completed(futures):
                    if ctx.cancel_flag and ctx.cancel_flag():
                        raise UserCancelledError("用户取消")
                    try:
                        idx, size, data = fut.result()
                        results.append((idx, size, data))
                        done += 1
                        bytes_done += size
                        elapsed = max(1e-3, time.time() - start)
                        speed = bytes_done / elapsed
                        percent = done * 100.0 / total
                        ctx.log(
                            "debug",
                            f"DASH {label} 进度: fragment={done}/{total}, "
                            f"percent={percent:.2f}%, bytes={bytes_done}, speed={speed:.2f} B/s",
                        )
                        ctx.update_progress(
                            TaskProgress(
                                downloaded_bytes=bytes_done,
                                total_bytes=None,
                                speed_bps=speed,
                                eta_seconds=None,
                                percent=percent,
                                fragment_index=done,
                                fragment_count=total,
                                state="downloading",
                            )
                        )
                    except Exception as e:
                        raise EngineError(f"DASH {label} 片段下载失败: {e}") from e

            # 按顺序写入
            results.sort(key=lambda x: x[0])
            for _, _, data in results:
                out_f.write(data)

        ctx.log("info", f"DASH {label} 下载完成: {output_path}")
        return output_path

    def _fetch_segment(
        self,
        url: str,
        sess: requests.Session,
        proxies: Optional[dict],
        ctx: EngineContext,
    ) -> bytes:
        try:
            resp = sess.get(url, timeout=self.config.network.read_timeout, proxies=proxies)
            resp.raise_for_status()
            return resp.content
        except requests.exceptions.RequestException as e:
            raise EngineError(f"请求失败 {url}: {e}") from e

    def _ffmpeg_copy(self, input_path: str, output_path: str, ffmpeg: str) -> None:
        run_ffmpeg(
            ["-i", input_path, "-c", "copy", "-movflags", "+faststart", output_path],
            ffmpeg_bin=ffmpeg,
            timeout=4 * 3600,
        )

    def _safe_name(self, name: str) -> str:
        from ..core.path_utils import safe_name

        return safe_name(name, self.config)

    def _unique_path(self, path: Path) -> Path:
        from ..core.path_utils import unique_path

        return unique_path(path)
