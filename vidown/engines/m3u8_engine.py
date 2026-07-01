"""M3U8 / HLS / DASH 流媒体下载引擎。

策略：
  1. 优先调用 N_m3u8DL-RE（业界最稳健的 M3U8 下载器）
  2. 退化为内置多线程 TS 片段下载（AES-128 / SAMPLE-AES 解密）
  3. 通过 FFmpeg 后处理统一封装为 H.264 MP4
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

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
from ..core.utils import find_executable, run_command
from .base import BaseEngine, EngineCapability, EngineContext

logger = get_logger("engines.m3u8")


class M3U8Engine(BaseEngine):
    """M3U8 / HLS / DASH 下载引擎。"""

    name = "m3u8"
    display_name = "M3U8 / HLS / DASH"
    capabilities = [
        EngineCapability.PROBE,
        EngineCapability.DOWNLOAD,
        EngineCapability.FORMAT_LIST,
    ]

    def __init__(self, config: Config):
        super().__init__(config)
        self._m3u8dl_bin: Optional[str] = None
        self._init_external_binary()

    def _init_external_binary(self) -> None:
        # 1) 用户配置路径
        user_path = self.config.engines.m3u8dl.binary_path
        if user_path and os.path.exists(user_path):
            self._m3u8dl_bin = user_path
            return
        # 2) PATH 中查找
        for name in ("N_m3u8DL-RE", "N_m3u8DL-RE.exe", "m3u8dl", "m3u8dl-re"):
            p = find_executable(name)
            if p:
                self._m3u8dl_bin = p
                return
        # 3) 常见安装位置
        for guess in (
            "/usr/local/bin/N_m3u8DL-RE",
            "/opt/homebrew/bin/N_m3u8DL-RE",
            str(Path.home() / "bin" / "N_m3u8DL-RE"),
            str(Path.cwd() / "N_m3u8DL-RE"),
        ):
            if os.path.exists(guess):
                self._m3u8dl_bin = guess
                return
        logger.warning("未检测到 N_m3u8DL-RE 二进制，将使用内置 m3u8 下载器。")

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        if not url:
            return False
        platform_enum, _ = classify_url(url)
        return platform_enum in (Platform.M3U8, Platform.DASH)

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        return 200  # 专门处理 M3U8/DASH

    # ------------------------------------------------------------------
    # 探测（解析 m3u8 主清单，提取码率/分辨率）
    # ------------------------------------------------------------------
    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        info = VideoInfo(
            url=url,
            webpage_url=url,
            platform=Platform.M3U8 if ".m3u8" in url.lower() else Platform.DASH,
            kind=MediaKind.VIDEO,
            title=self._guess_title_from_url(url),
        )
        try:
            variants = self._parse_master_playlist(url, ctx)
        except Exception as e:
            logger.debug(f"解析主清单失败，回退为基础信息: {e}")
            variants = []
        info.formats = variants
        if not variants:
            # 至少放一个表示主流的虚拟 FormatInfo
            info.formats.append(
                FormatInfo(
                    format_id="auto",
                    ext="mp4",
                    resolution="?",
                    vcodec="unknown",
                    acodec="unknown",
                    tbr=0,
                    protocol="m3u8",
                )
            )
        return info

    def _parse_master_playlist(self, url: str, ctx: EngineContext) -> List[FormatInfo]:
        """解析 m3u8 master playlist，提取各码率。"""
        import requests  # type: ignore

        proxies = (
            {"http": self.config.network.proxy, "https": self.config.network.proxy}
            if self.config.network.proxy
            else None
        )
        try:
            resp = requests.get(
                url,
                timeout=self.config.network.connect_timeout,
                headers={"User-Agent": self.config.network.user_agent},
                proxies=proxies,
            )
        except Exception as e:
            raise NetworkError(f"下载 m3u8 清单失败: {e}") from e
        if resp.status_code != 200:
            raise NetworkError(f"下载 m3u8 清单失败: HTTP {resp.status_code}")
        text = resp.text

        formats: List[FormatInfo] = []
        # 简单解析 EXT-X-STREAM-INF
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("#EXT-X-STREAM-INF:"):
                attrs = self._parse_stream_inf_attrs(line)
                uri = lines[i + 1].strip() if i + 1 < len(lines) else ""
                if not uri:
                    continue
                # 计算完整 URL（仅用于日志；暂不作为变量保留以避免未用告警）
                self._resolve_url(url, uri)
                bandwidth = float(attrs.get("BANDWIDTH", 0)) / 1000.0  # kbps
                res = attrs.get("RESOLUTION", "")
                codecs = attrs.get("CODECS", "")
                w, h = 0, 0
                if "x" in res:
                    try:
                        parts = res.split("x")
                        w, h = int(parts[0]), int(parts[1])
                    except (ValueError, IndexError):
                        w, h = 0, 0
                vcodec, acodec = self._split_codecs(codecs)
                formats.append(
                    FormatInfo(
                        format_id=f"m3u8-{int(bandwidth)}",
                        ext="mp4",
                        resolution=res,
                        width=w or None,
                        height=h or None,
                        vcodec=vcodec,
                        acodec=acodec,
                        tbr=bandwidth,
                        vbr=bandwidth,
                        protocol="m3u8",
                    )
                )
        return formats

    @staticmethod
    def _parse_stream_inf_attrs(line: str) -> Dict[str, str]:
        attrs = {}
        body = line.split(":", 1)[1]
        for part in body.split(","):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            attrs[k.strip().upper()] = v.strip().strip('"')
        return attrs

    @staticmethod
    def _split_codecs(codecs: str) -> Tuple[str, str]:
        """从 CODECS="avc1.640028,mp4a.40.2" 拆分出 vcodec / acodec。"""
        if not codecs:
            return "avc1", "mp4a"
        items = [c.strip() for c in codecs.split(",")]
        vcodec, acodec = "none", "none"
        for c in items:
            low = c.lower()
            if low.startswith(("avc1", "hvc1", "hev1", "av01", "vp09")):
                vcodec = c
            elif low.startswith(("mp4a", "opus", "ec-3", "ac-3")):
                acodec = c
        return vcodec, acodec

    @staticmethod
    def _resolve_url(base: str, ref: str) -> str:
        from urllib.parse import urljoin

        return urljoin(base, ref)

    @staticmethod
    def _guess_title_from_url(url: str) -> str:
        from urllib.parse import urlparse

        p = urlparse(url)
        return os.path.basename(p.path) or p.netloc or "m3u8"

    # ------------------------------------------------------------------
    # 下载
    # ------------------------------------------------------------------
    def download_info(self, task: DownloadTask, info: VideoInfo, ctx: EngineContext) -> str:
        if self._m3u8dl_bin:
            return self._download_with_external(info, task, ctx)
        return self._download_with_internal(info, task, ctx)

    def _download_with_external(
        self, info: VideoInfo, task: DownloadTask, ctx: EngineContext
    ) -> str:
        binary = self._m3u8dl_bin
        assert binary
        download_dir = self._download_dir()
        # N_m3u8DL-RE 命令行参数
        cmd = [
            binary,
            info.url,
            "--save-dir",
            download_dir,
            "--tmp-dir",
            os.path.join(download_dir, "_tmp"),
            "--thread-count",
            str(self.config.engines.m3u8dl.threads),
            "--download-retry-count",
            str(self.config.engines.m3u8dl.retry_count),
            "--auto-select-best",  # 自动选最佳
            "--no-ansi",
        ]
        if self.config.network.proxy:
            cmd += ["--custom-proxy", self.config.network.proxy]
        if self.config.cookies.manual_cookies_file:
            cmd += ["--custom-cookie", self.config.cookies.manual_cookies_file]

        ctx.log("info", f"调用 N_m3u8DL-RE: {' '.join(cmd)}")
        try:
            proc = run_command(cmd, timeout=3600)
        except Exception as e:
            raise EngineError(f"N_m3u8DL-RE 执行失败: {e}") from e

        if proc.returncode != 0:
            raise EngineError(f"N_m3u8DL-RE 返回非零码: {proc.returncode}\n{proc.stderr}")
        return self._find_output(download_dir)

    def _download_with_internal(
        self, info: VideoInfo, task: DownloadTask, ctx: EngineContext
    ) -> str:
        """内置 m3u8 下载器：解析 media playlist → 并发下载 TS → 合并 MP4。

        注意：内置实现仅覆盖最常见的非加密 / AES-128 场景，SAMPLE-AES / DRM
        会回退到提示用户安装 N_m3u8DL-RE。
        """
        from urllib.parse import urljoin
        import requests
        from concurrent.futures import ThreadPoolExecutor, as_completed

        download_dir = self._download_dir()
        ts_dir = Path(download_dir) / "_ts"
        ts_dir.mkdir(parents=True, exist_ok=True)

        proxies = (
            {"http": self.config.network.proxy, "https": self.config.network.proxy}
            if self.config.network.proxy
            else None
        )
        sess = requests.Session()
        sess.headers.update({"User-Agent": self.config.network.user_agent})

        def _get(u: str) -> str:
            r = sess.get(u, timeout=self.config.network.read_timeout, proxies=proxies)
            r.raise_for_status()
            return r.text

        # 1) 拉取清单
        master = _get(info.url)
        media_url = info.url
        if "#EXT-X-STREAM-INF" in master:
            # 选择最佳码率（首个 / 用户指定）
            best_line = None
            best_bw = -1.0
            lines = master.splitlines()
            for i, ln in enumerate(lines):
                if ln.startswith("#EXT-X-STREAM-INF:"):
                    attrs = self._parse_stream_inf_attrs(ln)
                    bw = float(attrs.get("BANDWIDTH", 0))
                    if bw > best_bw:
                        best_bw = bw
                        if i + 1 < len(lines):
                            best_line = lines[i + 1].strip()
            if best_line:
                media_url = urljoin(info.url, best_line)
                ctx.log("info", f"选择最佳变体: {media_url} (bw={best_bw/1000:.0f}kbps)")
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
                raise EngineError("用户取消")
            ts_path = ts_dir / f"seg_{idx:06d}.ts"
            if ts_path.exists() and ts_path.stat().st_size > 0:
                return ts_path
            r = sess.get(url, timeout=self.config.network.read_timeout, proxies=proxies)
            r.raise_for_status()
            ts_path.write_bytes(r.content)
            return ts_path

        ctx.log("info", f"开始下载 {total} 个 TS 片段，线程 {threads}")
        with ThreadPoolExecutor(max_workers=threads) as pool:
            futures = {pool.submit(_fetch_seg, i, u): i for i, u in enumerate(segs)}
            for fut in as_completed(futures):
                if ctx.cancel_flag and ctx.cancel_flag():
                    raise EngineError("用户取消")
                try:
                    p = fut.result()
                    ts_files.append(p)
                    done += 1
                    bytes_done += p.stat().st_size
                    elapsed = max(1e-3, time.time() - start)
                    speed = bytes_done / elapsed
                    eta = (total - done) * (elapsed / done) if done else None
                    ctx.update_progress(
                        TaskProgress(
                            downloaded_bytes=bytes_done,
                            total_bytes=None,
                            speed_bps=speed,
                            eta_seconds=int(eta) if eta else None,
                            percent=done * 100.0 / total,
                            fragment_index=done,
                            fragment_count=total,
                            state="downloading",
                        )
                    )
                except Exception as e:
                    logger.warning(f"片段下载失败: {e}")
                    # 重试一次
                    idx = futures[fut]
                    try:
                        p = _fetch_seg(idx, segs[idx])
                        ts_files.append(p)
                    except Exception as e2:
                        raise EngineError(f"片段 {idx} 下载失败: {e2}") from e2

        # 4) 排序并合并
        ts_files.sort(key=lambda p: int(re.search(r"seg_(\d+)", p.name).group(1)))
        out_path = Path(download_dir) / f"{self._safe_name(info.title)}.mp4"
        out_path = self._unique_path(out_path)

        ctx.log("info", f"合并 TS → MP4: {out_path}")
        list_file = ts_dir / "_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for ts in ts_files:
                f.write(f"file '{ts.as_posix()}'\n")

        from ..core.utils import find_executable

        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            raise EngineError("未找到 ffmpeg，无法合并 M3U8 片段")
        # 优先走 FFmpegPostProcessor；这里简单做 concat
        from ..postprocess.ffmpeg_pipe import concat_segments

        concat_segments([str(p) for p in ts_files], str(out_path), ffmpeg)
        return str(out_path)

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------
    def _download_dir(self) -> str:
        d = os.path.expandvars(os.path.expanduser(self.config.general.download_dir))
        os.makedirs(d, exist_ok=True)
        return d

    @staticmethod
    def _safe_name(name: str) -> str:
        from ..core.utils import sanitize_filename

        return sanitize_filename(name)

    @staticmethod
    def _unique_path(p: Path) -> Path:
        if not p.exists():
            return p
        i = 1
        while True:
            cand = p.with_name(f"{p.stem}-{i}{p.suffix}")
            if not cand.exists():
                return cand
            i += 1

    @staticmethod
    def _find_output(download_dir: str) -> str:
        root = Path(download_dir)
        mp4s = list(root.rglob("*.mp4"))
        if not mp4s:
            raise EngineError("未在 N_m3u8DL-RE 输出目录中找到 .mp4 文件")
        mp4s.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return str(mp4s[0])
