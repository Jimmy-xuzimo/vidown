"""M3U8 外部下载器模块。

封装 N_m3u8DL-RE 二进制调用，将其输出整理为统一的 DownloadResult。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

from ..core.config import Config
from ..core.exceptions import BinaryNotFoundError, EngineError
from ..core.logger import get_logger
from ..core.models import DownloadResult, DownloadTask, VideoInfo
from ..core.path_utils import move_to_download_dir
from ..core.utils import find_executable, run_command
from .base import EngineContext

logger = get_logger("engines.m3u8.external")


class M3U8ExternalDownloader:
    """基于 N_m3u8DL-RE 的外部 M3U8 下载器。"""

    def __init__(self, config: Config):
        self.config = config
        self._binary: Optional[str] = None
        self._init_binary()

    @property
    def available(self) -> bool:
        """外部下载器是否可用。"""
        return self._binary is not None

    def _init_binary(self) -> None:
        # 1) 用户配置路径
        user_path = self.config.engines.m3u8dl.binary_path
        if user_path and os.path.exists(user_path):
            self._binary = user_path
            return
        # 2) PATH 中查找
        for name in ("N_m3u8DL-RE", "N_m3u8DL-RE.exe", "m3u8dl", "m3u8dl-re"):
            p = find_executable(name)
            if p:
                self._binary = p
                return
        # 3) 常见安装位置
        for guess in (
            "/usr/local/bin/N_m3u8DL-RE",
            "/opt/homebrew/bin/N_m3u8DL-RE",
            str(Path.home() / "bin" / "N_m3u8DL-RE"),
            str(Path.cwd() / "N_m3u8DL-RE"),
        ):
            if os.path.exists(guess):
                self._binary = guess
                return
        logger.warning("未检测到 N_m3u8DL-RE 二进制，将使用内置 m3u8 下载器。")

    def download(
        self,
        info: VideoInfo,
        task: DownloadTask,
        ctx: EngineContext,
        work_dir: Path,
        download_dir: Path,
    ) -> DownloadResult:
        """调用 N_m3u8DL-RE 完成下载。"""
        binary = self._binary
        if not binary:
            raise BinaryNotFoundError("N_m3u8DL-RE 未配置或不可用")

        tmp_dir = work_dir / "_tmp"
        # N_m3u8DL-RE 命令行参数
        cmd: List[str] = [
            binary,
            info.url,
            "--save-dir",
            str(work_dir),
            "--tmp-dir",
            str(tmp_dir),
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
        except FileNotFoundError as e:
            raise BinaryNotFoundError(f"N_m3u8DL-RE 可执行文件不存在: {e}") from e
        except TimeoutError as e:
            raise EngineError(f"N_m3u8DL-RE 执行超时: {e}") from e
        except RuntimeError as e:
            raise EngineError(f"N_m3u8DL-RE 执行失败: {e}") from e

        if proc.returncode != 0:
            raise EngineError(f"N_m3u8DL-RE 返回非零码: {proc.returncode}\n{proc.stderr}")
        output_path = Path(self._find_output(work_dir))
        final_path = move_to_download_dir(output_path, download_dir, work_dir)
        return DownloadResult(
            output_path=final_path,
            needs_postprocess=False,
            metadata=info,
            engine_name="m3u8",
        )

    @staticmethod
    def _find_output(work_dir: Path) -> str:
        mp4s = list(work_dir.rglob("*.mp4"))
        if not mp4s:
            raise EngineError("未在 N_m3u8DL-RE 输出目录中找到 .mp4 文件")
        mp4s.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return str(mp4s[0])
