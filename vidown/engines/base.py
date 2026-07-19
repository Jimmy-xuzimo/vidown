"""下载引擎抽象基类与注册表。"""

from __future__ import annotations

import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from ..core.config import Config
from ..core.models import (
    VideoInfo,
    DownloadTask,
    TaskProgress,
    DownloadResult,
    Platform,
    MediaKind,
)
from ..core.exceptions import EngineError
from ..core.logger import get_logger

logger = get_logger("engines")


class EngineCapability(enum.Enum):
    PROBE = "probe"  # 支持信息探测
    DOWNLOAD = "download"  # 支持下载
    FORMAT_LIST = "format_list"  # 能列出格式
    SUBTITLE = "subtitle"  # 支持字幕
    THUMBNAIL = "thumbnail"  # 支持缩略图
    POSTPROCESS = "postprocess"  # 内置后处理


@dataclass
class EngineContext:
    """引擎运行时的共享上下文。"""

    config: Config
    progress_callback: Optional[Callable[[TaskProgress], None]] = None
    cancel_flag: Optional[Callable[[], bool]] = None
    log_callback: Optional[Callable[[str, str], None]] = None
    extra: Optional[Dict[str, Any]] = None

    def log(self, level: str, msg: str) -> None:
        logger.log(getattr(__import__("logging"), level.upper(), 20), msg)
        if self.log_callback:
            try:
                self.log_callback(level, msg)
            except Exception:
                pass

    def update_progress(self, p: TaskProgress) -> None:
        if self.progress_callback:
            try:
                self.progress_callback(p)
            except Exception as e:
                logger.warning(f"progress callback error: {e}")


class BaseEngine(ABC):
    """所有下载引擎的抽象基类。"""

    name: str = "base"
    display_name: str = "Base Engine"
    capabilities: List[EngineCapability] = []

    def __init__(self, config: Config):
        self.config = config

    # ---- 能力声明 ----
    def supports(self, cap: EngineCapability) -> bool:
        return cap in self.capabilities

    def can_handle(self, url: str, platform: Platform, kind: MediaKind) -> bool:
        """是否适合处理该 URL/平台/类型。默认返回 False。"""
        return False

    def priority(self, url: str, platform: Platform, kind: MediaKind) -> int:
        """引擎优先级（数字越大越优先）。用于调度器选引擎。"""
        return 0

    # ---- 流程接口 ----
    @abstractmethod
    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        """探测视频元数据。"""

    def download(self, task: DownloadTask, ctx: EngineContext) -> DownloadResult:
        """下载并返回统一结果。默认实现 = probe + 自身 download_info。"""
        info = self.probe(task.url, ctx)
        task.info = info
        return self.download_info(task, info, ctx)

    def download_info(
        self, task: DownloadTask, info: VideoInfo, ctx: EngineContext
    ) -> DownloadResult:
        raise EngineError(f"{self.name} 未实现 download_info")


# ----------------------------------------------------------------------
# 引擎注册表
# ----------------------------------------------------------------------


class EngineRegistry:
    """引擎注册与调度中心。"""

    def __init__(self, config: Config):
        self.config = config
        self._engines: List[BaseEngine] = []

    def register(self, engine: BaseEngine) -> None:
        self._engines.append(engine)
        logger.debug(f"已注册引擎: {engine.name}")

    @property
    def engines(self) -> List[BaseEngine]:
        return list(self._engines)

    def select(self, url: str, platform: Platform, kind: MediaKind) -> Optional[BaseEngine]:
        """为给定 URL 选择最佳引擎。"""
        candidates = [e for e in self._engines if e.can_handle(url, platform, kind)]
        if not candidates:
            # 兜底：未声明 can_handle 但支持探测+下载的引擎
            candidates = [
                e
                for e in self._engines
                if EngineCapability.PROBE in e.capabilities
                and EngineCapability.DOWNLOAD in e.capabilities
            ]
        if not candidates:
            return None
        candidates.sort(key=lambda e: e.priority(url, platform, kind), reverse=True)
        return candidates[0]

    def fallback_chain(self, url: str, platform: Platform, kind: MediaKind) -> List[BaseEngine]:
        """获取可用的 fallback 链（含主引擎）。"""
        all_handlers = [e for e in self._engines if e.can_handle(url, platform, kind)]
        all_handlers.sort(key=lambda e: e.priority(url, platform, kind), reverse=True)
        return all_handlers
