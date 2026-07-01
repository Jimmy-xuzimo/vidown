"""剪贴板监听：自动识别新粘贴的视频链接。"""

from __future__ import annotations

import threading
from typing import Callable, List, Optional, Set

from ..core.logger import get_logger
from ..core.platform_detect import (
    classify_url,
    extract_urls,
    Platform,
    MediaKind,
)

logger = get_logger("utils.clipboard")


class ClipboardWatcher:
    """跨平台剪贴板监听器（轻量级实现）。

    实现说明：
      - macOS:   pbpaste
      - Linux:   xclip / xsel / wl-paste
      - Windows: PowerShell Get-Clipboard
    """

    def __init__(
        self,
        callback: Callable[[str, Platform, MediaKind], None],
        poll_interval: float = 1.5,
    ):
        self.callback = callback
        self.poll_interval = poll_interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_value: str = ""
        self._seen: Set[str] = set()

    # ------------------------------------------------------------------
    # 启动 / 停止
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="clipboard-watcher", daemon=True)
        self._thread.start()
        logger.info("剪贴板监听已启动")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        logger.info("剪贴板监听已停止")

    # ------------------------------------------------------------------
    # 主循环
    # ------------------------------------------------------------------
    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                text = self._read_clipboard()
                if text and text != self._last_value:
                    self._last_value = text
                    for url in extract_urls(text):
                        if url in self._seen:
                            continue
                        platform_enum, kind = classify_url(url)
                        if platform_enum == Platform.UNKNOWN:
                            continue
                        self._seen.add(url)
                        try:
                            self.callback(url, platform_enum, kind)
                        except Exception as e:
                            logger.warning(f"剪贴板回调错误: {e}")
            except Exception as e:
                logger.debug(f"剪贴板读取异常: {e}")
            self._stop.wait(self.poll_interval)

    # ------------------------------------------------------------------
    # 平台相关读取
    # ------------------------------------------------------------------
    def _read_clipboard(self) -> str:
        import sys

        if sys.platform == "darwin":
            return self._run_get(["pbpaste"])
        if sys.platform.startswith("win"):
            return self._run_get(["powershell", "-NoProfile", "-Command", "Get-Clipboard"])
        # Linux: 优先 wl-paste (Wayland)，再 xclip，最后 xsel
        for cmd in (
            ["wl-paste", "--no-newline"],
            ["xclip", "-selection", "clipboard", "-o"],
            ["xsel", "--clipboard", "--output"],
        ):
            try:
                return self._run_get(cmd)
            except FileNotFoundError:
                continue
            except Exception:
                continue
        return ""

    @staticmethod
    def _run_get(cmd: List[str]) -> str:
        import subprocess

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
        except FileNotFoundError:
            raise
        except Exception:
            return ""
        if proc.returncode != 0:
            return ""
        return proc.stdout or ""
