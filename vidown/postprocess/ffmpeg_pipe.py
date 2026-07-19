"""FFmpeg 后处理管道。

封装常见的转码/合并/拼接/嵌入操作：
  - merge_streams: 视频流 + 音频流 → MP4
  - transcode_to_h264: 任意视频 → H.264 + AAC MP4
  - concat_segments: 多个片段 (TS/MP4) → 单个 MP4
  - embed_thumbnail: 嵌入封面
  - embed_metadata: 写入元数据
  - burn_subtitle: 字幕硬烧
  - extract_subtitle: 提取字幕轨
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Sequence

from ..core.exceptions import FFmpegNotFoundError
from ..core.logger import get_logger

logger = get_logger("postprocess.ffmpeg")


# ----------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------


def find_ffmpeg() -> str:
    p = shutil.which("ffmpeg")
    if not p:
        raise FFmpegNotFoundError("未找到 ffmpeg 可执行文件")
    return p


def find_ffprobe() -> str:
    p = shutil.which("ffprobe")
    if not p:
        raise FFmpegNotFoundError("未找到 ffprobe 可执行文件")
    return p


def is_h264(codec: str) -> bool:
    if not codec:
        return False
    return any(k in codec.lower() for k in ("h264", "avc", "h.264"))


def run_ffmpeg(
    args: Sequence[str],
    ffmpeg_bin: Optional[str] = None,
    timeout: Optional[int] = None,
) -> subprocess.CompletedProcess:
    binary = ffmpeg_bin or find_ffmpeg()
    cmd = [binary, "-hide_banner", "-loglevel", "error", "-y", *args]
    logger.debug(f"ffmpeg cmd: {' '.join(cmd)}")
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout
        )
    except subprocess.TimeoutExpired as e:
        raise TimeoutError(f"ffmpeg 执行超时: {' '.join(cmd[:6])}...") from e


# ----------------------------------------------------------------------
# 进度回调封装
# ----------------------------------------------------------------------


@dataclass
class FFmpegPipe:
    """带进度回调的 ffmpeg 包装器。"""

    binary: Optional[str] = None
    progress_callback: Optional[Callable[[float, str], None]] = None
    log_callback: Optional[Callable[[str], None]] = None
    _proc: Optional[subprocess.Popen] = None
    _reader_thread: Optional[threading.Thread] = None
    _stop_flag: bool = False
    _last_duration: float = 0.0

    def run(
        self, args: Sequence[str], duration: Optional[float] = None, timeout: Optional[int] = None
    ) -> int:
        binary = self.binary or find_ffmpeg()
        cmd = [binary, "-hide_banner", "-y", "-progress", "pipe:2", *args]
        logger.debug(f"ffmpeg: {' '.join(cmd[:8])}...")
        self._stop_flag = False
        self._last_duration = duration or 0
        try:
            self._proc = subprocess.Popen(
                cmd,
                stderr=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except FileNotFoundError as e:
            raise FFmpegNotFoundError(str(e)) from e

        if self.progress_callback and self._proc.stderr:
            self._reader_thread = threading.Thread(target=self._read_progress, daemon=True)
            self._reader_thread.start()

        try:
            rc = self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            raise TimeoutError("ffmpeg 执行超时")
        if self._reader_thread:
            self._reader_thread.join(timeout=2)
        if rc != 0:
            stderr = self._proc.stderr.read() if self._proc.stderr else ""
            raise RuntimeError(f"ffmpeg 返回 {rc}: {stderr}")
        return rc

    def _read_progress(self) -> None:
        if not self._proc or not self._proc.stderr:
            return
        for line in self._proc.stderr:
            if self._stop_flag:
                break
            line = line.strip()
            if not line:
                continue
            if "=" not in line:
                if self.log_callback:
                    self.log_callback(line)
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip()
            if k == "out_time_ms" and self.progress_callback:
                try:
                    cur = int(v) / 1_000_000.0
                    if self._last_duration > 0:
                        pct = min(100.0, cur * 100.0 / self._last_duration)
                        self.progress_callback(pct, "transcoding")
                except ValueError:
                    pass
            elif k == "progress" and self.progress_callback:
                if v == "end":
                    self.progress_callback(100.0, "finished")
                elif v == "continue":
                    pass

    def cancel(self) -> None:
        self._stop_flag = True
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
            except Exception:
                pass


# ----------------------------------------------------------------------
# 高层 API
# ----------------------------------------------------------------------


def merge_streams(
    video_path: str,
    audio_path: str,
    output_path: str,
    ffmpeg_bin: Optional[str] = None,
    prefer_copy: bool = True,
    crf: int = 18,
    preset: str = "slow",
    audio_bitrate: str = "320k",
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> str:
    """将分离的视频+音频合并为 MP4。

    - prefer_copy=True 且视频为 H.264 / 音频为 AAC 时，使用 -c copy 避免重编码。
    - 否则使用 libx264 + aac 重编码。
    """
    from .probe import probe_media

    ffprobe = find_ffprobe()
    v_info = probe_media(video_path, ffprobe)
    a_info = probe_media(audio_path, ffprobe)

    video_codec = v_info.vcodec
    audio_codec = a_info.acodec

    if prefer_copy and is_h264(video_codec) and audio_codec in ("aac", "mp4a", ""):
        args = [
            "-i",
            video_path,
            "-i",
            audio_path,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            output_path,
        ]
    else:
        args = [
            "-i",
            video_path,
            "-i",
            audio_path,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "libx264",
            "-crf",
            str(crf),
            "-preset",
            preset,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            audio_bitrate,
            "-movflags",
            "+faststart",
            output_path,
        ]

    pipe = FFmpegPipe(binary=ffmpeg_bin, progress_callback=progress_callback)
    pipe.run(args, timeout=4 * 3600)
    return output_path


def transcode_to_h264(
    input_path: str,
    output_path: str,
    ffmpeg_bin: Optional[str] = None,
    crf: int = 18,
    preset: str = "slow",
    audio_codec: str = "aac",
    audio_bitrate: str = "320k",
    progress_callback: Optional[Callable[[float, str], None]] = None,
    copy_if_already_h264: bool = True,
) -> str:
    """任意视频 → H.264 MP4。若源已是 H.264 则直接复制。"""
    from .probe import probe_media

    ffprobe = find_ffprobe()
    info = probe_media(input_path, ffprobe)
    if copy_if_already_h264 and is_h264(info.vcodec):
        args = [
            "-i",
            input_path,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            output_path,
        ]
    else:
        args = [
            "-i",
            input_path,
            "-c:v",
            "libx264",
            "-crf",
            str(crf),
            "-preset",
            preset,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            audio_codec,
            "-b:a",
            audio_bitrate,
            "-movflags",
            "+faststart",
            output_path,
        ]
    pipe = FFmpegPipe(binary=ffmpeg_bin, progress_callback=progress_callback)
    pipe.run(args, duration=info.duration, timeout=8 * 3600)
    return output_path


def concat_segments(
    segment_paths: Sequence[str],
    output_path: str,
    ffmpeg_bin: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> str:
    """将多个 .ts / .mp4 片段合并为单个 MP4。"""
    list_file = output_path + ".list.txt"
    with open(list_file, "w", encoding="utf-8") as f:
        for seg in segment_paths:
            # ffmpeg concat demuxer 要求单引号 + 转义
            safe = str(Path(seg).resolve()).replace("'", "'\\''")
            f.write(f"file '{safe}'\n")

    args = [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_file,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output_path,
    ]
    pipe = FFmpegPipe(binary=ffmpeg_bin, progress_callback=progress_callback)
    pipe.run(args, timeout=4 * 3600)
    try:
        os.remove(list_file)
    except OSError:
        pass
    return output_path


def embed_thumbnail(
    video_path: str,
    thumbnail_path: str,
    output_path: Optional[str] = None,
    ffmpeg_bin: Optional[str] = None,
) -> str:
    """将 jpg/png 封面嵌入 MP4。"""
    output_path = output_path or video_path
    args = [
        "-i",
        video_path,
        "-i",
        thumbnail_path,
        "-map",
        "0",
        "-map",
        "1",
        "-c",
        "copy",
        "-disposition:v:1",
        "attached_pic",
        "-movflags",
        "+faststart",
        output_path,
    ]
    pipe = FFmpegPipe(binary=ffmpeg_bin)
    pipe.run(args, timeout=2 * 3600)
    return output_path


def embed_metadata(
    video_path: str,
    metadata: Dict[str, str],
    output_path: Optional[str] = None,
    ffmpeg_bin: Optional[str] = None,
) -> str:
    """写入元数据 (title/artist/comment 等)。"""
    output_path = output_path or video_path
    args = ["-i", video_path, "-map", "0", "-c", "copy"]
    for k, v in metadata.items():
        args += ["-metadata", f"{k}={v}"]
    args += ["-movflags", "+faststart", output_path]
    pipe = FFmpegPipe(binary=ffmpeg_bin)
    pipe.run(args, timeout=3600)
    return output_path


def burn_subtitle(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    ffmpeg_bin: Optional[str] = None,
) -> str:
    """将字幕硬烧到视频上。"""
    # 需要重新编码视频
    args = [
        "-i",
        video_path,
        "-vf",
        f"subtitles={subtitle_path}",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "slow",
        "-c:a",
        "copy",
        output_path,
    ]
    pipe = FFmpegPipe(binary=ffmpeg_bin)
    pipe.run(args, timeout=8 * 3600)
    return output_path


def extract_subtitle(
    video_path: str,
    output_path: str,
    stream_index: int = 0,
    ffmpeg_bin: Optional[str] = None,
) -> str:
    """从视频中提取字幕轨。"""
    args = [
        "-i",
        video_path,
        "-map",
        f"0:s:{stream_index}",
        "-c",
        "copy",
        output_path,
    ]
    pipe = FFmpegPipe(binary=ffmpeg_bin)
    pipe.run(args, timeout=3600)
    return output_path


def get_media_info(path: str) -> Dict[str, Any]:
    from .probe import probe_media

    return probe_media(path).to_dict()
