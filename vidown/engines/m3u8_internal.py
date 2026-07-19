"""M3U8 内置下载器模块。

内置多线程 TS 片段下载与合并，覆盖非加密 / AES-128 等常见场景。
SAMPLE-AES / DRM 场景会抛出明确错误，提示用户切换到 N_m3u8DL-RE。
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, List
from urllib.parse import urljoin

import requests  # type: ignore

from ..core.config import Config
from ..core.exceptions import BinaryNotFoundError, EngineError, UserCancelledError
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, TaskProgress, VideoInfo
from ..core.network import get_proxies, make_session
from ..core.utils import find_executable
from .base import EngineContext
from .m3u8_probe import M3U8Probe

logger = get_logger("engines.m3u8.internal")


class M3U8InternalDownloader:
    """内置 M3U8 / HLS 下载器。"""

    def __init__(self, config: Config):
        self.config = config

    def download(
        self,
        info: VideoInfo,
        task: DownloadTask,
        ctx: EngineContext,
        work_dir: Path,
        download_dir: Path,
        safe_name: Callable[[str], str],
        unique_path: Callable[[Path], Path],
        move_to_download_dir_fn: Callable[[Path, Path, Path], str],
    ) -> DownloadResult:
        """内置 m3u8 下载器：解析 media playlist → 并发下载 TS → 合并 MP4。"""
        ts_dir = work_dir / "_ts"
        ts_dir.mkdir(parents=True, exist_ok=True)

        proxies = get_proxies(self.config)
        sess = make_session(self.config)

        def _get(u: str) -> str:
            r = sess.get(u, timeout=self.config.network.read_timeout, proxies=proxies)
            r.raise_for_status()
            return r.text

        # 1) 拉取清单
        master = _get(info.url)
        media_url = info.url

        # 优先使用用户选择的格式对应的 variant_url
        if task.selected_format_id:
            for fmt in info.formats:
                if fmt.format_id == task.selected_format_id:
                    variant = fmt.extra.get("variant_url")
                    if variant:
                        media_url = variant
                        ctx.log("info", f"使用选择变体: {media_url}")
                        break

        if media_url == info.url and "#EXT-X-STREAM-INF" in master:
            # 选择最佳码率
            best_line = None
            best_bw = -1.0
            lines = master.splitlines()
            for i, ln in enumerate(lines):
                if ln.startswith("#EXT-X-STREAM-INF:"):
                    attrs = M3U8Probe._parse_stream_inf_attrs(ln)
                    bw = float(attrs.get("BANDWIDTH", 0))
                    if bw > best_bw:
                        best_bw = bw
                        if i + 1 < len(lines):
                            best_line = lines[i + 1].strip()
            if best_line:
                media_url = urljoin(info.url, best_line)
                ctx.log("info", f"选择最佳变体: {media_url} (bw={best_bw / 1000:.0f}kbps)")
        media = _get(media_url)
        if "#EXT-X-KEY" in media and "METHOD=SAMPLE-AES" in media:
            raise EngineError("检测到 SAMPLE-AES 加密，请安装 N_m3u8DL-RE 后重试。")

        # 2) 解析 TS 片段
        segs: List[str] = []
        for ln in media.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                # 加密的 m3u8 暂不支持；保留解析位以便后续扩展
                continue
            segs.append(urljoin(media_url, ln))

        if not segs:
            raise EngineError("m3u8 清单中未发现任何片段")

        # 3) 多线程下载
        ts_files: List[Path] = []
        total = len(segs)
        done = 0
        bytes_done = 0
        start = time.time()
        threads = self.config.engines.m3u8dl.threads

        def _fetch_seg(idx: int, url: str) -> Path:
            if ctx.cancel_flag and ctx.cancel_flag():
                raise UserCancelledError("用户取消")
            ts_path = ts_dir / f"seg_{idx:06d}.ts"
            if ts_path.exists() and ts_path.stat().st_size > 0:
                return ts_path
            try:
                r = sess.get(url, timeout=self.config.network.read_timeout, proxies=proxies)
                r.raise_for_status()
                ts_path.write_bytes(r.content)
            except requests.exceptions.RequestException as e:
                raise EngineError(f"片段 {idx} 下载失败: {e}") from e
            return ts_path

        ctx.log("info", f"开始下载 {total} 个 TS 片段，线程 {threads}")
        with ThreadPoolExecutor(max_workers=threads) as pool:
            futures = {pool.submit(_fetch_seg, i, u): i for i, u in enumerate(segs)}
            for fut in as_completed(futures):
                if ctx.cancel_flag and ctx.cancel_flag():
                    raise UserCancelledError("用户取消")
                try:
                    p = fut.result()
                    ts_files.append(p)
                    done += 1
                    bytes_done += p.stat().st_size
                    elapsed = max(1e-3, time.time() - start)
                    speed = bytes_done / elapsed
                    eta = (total - done) * (elapsed / done) if done else None
                    percent = done * 100.0 / total
                    ctx.log(
                        "debug",
                        f"M3U8 进度: fragment={done}/{total}, "
                        f"percent={percent:.2f}%, bytes={bytes_done}, "
                        f"speed={speed:.2f} B/s, eta={eta}",
                    )
                    ctx.update_progress(
                        TaskProgress(
                            downloaded_bytes=bytes_done,
                            total_bytes=None,
                            speed_bps=speed,
                            eta_seconds=int(eta) if eta else None,
                            percent=percent,
                            fragment_index=done,
                            fragment_count=total,
                            state="downloading",
                        )
                    )
                except Exception:
                    # 重试一次
                    idx = futures[fut]
                    try:
                        p = _fetch_seg(idx, segs[idx])
                        ts_files.append(p)
                    except Exception as e2:
                        raise EngineError(f"片段 {idx} 下载失败: {e2}") from e2

        # 4) 排序并合并
        ts_files.sort(key=lambda p: int(re.search(r"seg_(\d+)", p.name).group(1)))
        out_path = work_dir / f"{safe_name(info.title)}.mp4"
        out_path = unique_path(out_path)

        ctx.log("info", f"合并 TS → MP4: {out_path}")

        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            raise BinaryNotFoundError("未找到 ffmpeg，无法合并 M3U8 片段")
        # 优先走 FFmpegPostProcessor；这里简单做 concat
        from ..postprocess.ffmpeg_pipe import concat_segments

        concat_segments([str(p) for p in ts_files], str(out_path), ffmpeg)
        final_path = move_to_download_dir_fn(out_path, download_dir, work_dir)
        ctx.log("info", f"M3U8 下载完成: {final_path}")
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name="m3u8",
        )
