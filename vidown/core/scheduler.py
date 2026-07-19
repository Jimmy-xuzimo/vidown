"""下载调度器：管理任务队列、并发、引擎选择、状态回调。"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

from .config import Config
from .exceptions import (
    VidownError,
    EngineError,
    DRMRestrictedError,
    FormatNotFoundError,
    InsufficientDiskSpaceError,
    NetworkError,
    UserCancelledError,
)
from .format_selector import select_formats
from .logger import get_logger
from .models import (
    DownloadResult,
    DownloadStatus,
    DownloadTask,
    MediaKind,
    Platform,
    TaskProgress,
    VideoInfo,
)
from .platform_detect import classify_url

logger = get_logger("scheduler")


# 类型别名
ProgressCB = Callable[[DownloadTask], None]
StatusCB = Callable[[DownloadTask], None]
LogCB = Callable[[DownloadTask, str, str], None]


class DownloadScheduler:
    """下载任务调度器。"""

    def __init__(
        self,
        config: Config,
        engine_factory: Optional[Callable[[Config], Any]] = None,
    ):
        self.config = config
        self.engine_factory = engine_factory
        self._registry: Optional[Any] = None
        self._engine_lock = threading.Lock()
        self._registry_initialized = False

        # 任务管理
        self._tasks: Dict[str, DownloadTask] = {}
        self._task_order: List[str] = []  # FIFO
        self._task_lock = threading.Lock()

        # 取消标记
        self._cancels: Dict[str, threading.Event] = {}
        self._pauses: Dict[str, threading.Event] = {}

        # 线程池
        self._executor: Optional[ThreadPoolExecutor] = None

        # 回调
        self._progress_callbacks: List[ProgressCB] = []
        self._status_callbacks: List[StatusCB] = []
        self._log_callbacks: List[LogCB] = []

    # ------------------------------------------------------------------
    # 引擎注册
    # ------------------------------------------------------------------
    def _ensure_registry(self) -> None:
        if self._registry_initialized:
            return
        with self._engine_lock:
            if self._registry_initialized:
                return
            if self.engine_factory:
                self._registry = self.engine_factory(self.config)
            else:
                self._registry = self._build_default_registry(self.config)
            self._registry_initialized = True

    @staticmethod
    def _build_default_registry(config: Config):
        from ..engines import (
            EngineRegistry,
            YtDlpEngine,
            M3U8Engine,
            DashEngine,
            DirectEngine,
            RtmpEngine,
            YouGetEngine,
            LuxEngine,
            GalleryDLEngine,
        )

        registry = EngineRegistry(config)
        if config.engines.ytdlp.enabled:
            try:
                registry.register(YtDlpEngine(config))
            except Exception as e:
                logger.warning(f"yt-dlp 引擎加载失败: {e}")
        if config.engines.m3u8dl.enabled:
            try:
                registry.register(M3U8Engine(config))
            except Exception as e:
                logger.warning(f"M3U8 引擎加载失败: {e}")
        try:
            registry.register(DashEngine(config))
        except Exception as e:
            logger.warning(f"DASH 引擎加载失败: {e}")
        try:
            registry.register(DirectEngine(config))
        except Exception as e:
            logger.warning(f"直链引擎加载失败: {e}")
        try:
            registry.register(RtmpEngine(config))
        except Exception as e:
            logger.warning(f"RTMP 引擎加载失败: {e}")

        # 备用引擎
        for name in ("you_get", "lux", "gallery_dl"):
            cfg = config.engines.fallbacks.get(name)
            if not cfg or not cfg.enabled:
                continue
            try:
                if name == "you_get":
                    registry.register(YouGetEngine(config))
                elif name == "lux":
                    registry.register(LuxEngine(config))
                elif name == "gallery_dl":
                    registry.register(GalleryDLEngine(config))
            except Exception as e:
                logger.warning(f"备用引擎 {name} 加载失败: {e}")

        logger.info(
            f"已注册 {len(registry.engines)} 个引擎: " f"{[e.name for e in registry.engines]}"
        )
        return registry

    # ------------------------------------------------------------------
    # 回调注册
    # ------------------------------------------------------------------
    def on_progress(self, cb: ProgressCB) -> None:
        self._progress_callbacks.append(cb)

    def on_status(self, cb: StatusCB) -> None:
        self._status_callbacks.append(cb)

    def on_log(self, cb: LogCB) -> None:
        self._log_callbacks.append(cb)

    # ------------------------------------------------------------------
    # 任务管理
    # ------------------------------------------------------------------
    def add_task(
        self,
        url: str,
        title: Optional[str] = None,
        platform: Optional[Platform] = None,
        kind: Optional[MediaKind] = None,
        selected_format_id: Optional[str] = None,
    ) -> DownloadTask:
        if not url:
            raise VidownError("URL 不能为空")
        # 平台特定规范化（如抖音 jingxuan?modal_id → douyin.com/video/...）
        # 让 yt-dlp 等下游引擎拿到可识别的标准链接。
        from .platform_detect import canonicalize_url

        url = canonicalize_url(url)
        # 自动检测
        if platform is None or kind is None:
            p, k = classify_url(url)
            platform = platform or p
            kind = kind or k

        task = DownloadTask(
            url=url,
            title=title or "",
            platform=platform,
            kind=kind,
            status=DownloadStatus.QUEUED,
        )
        if selected_format_id:
            task.selected_format_id = selected_format_id

        with self._task_lock:
            if task.id in self._tasks:
                raise VidownError(f"任务 ID 冲突: {task.id}")
            self._tasks[task.id] = task
            self._task_order.append(task.id)
            self._cancels[task.id] = threading.Event()
            self._pauses[task.id] = threading.Event()
            self._pauses[task.id].set()  # 默认可执行

        self._emit_status(task)
        return task

    def list_tasks(self) -> List[DownloadTask]:
        with self._task_lock:
            return [self._tasks[tid] for tid in self._task_order]

    def get_task(self, task_id: str) -> Optional[DownloadTask]:
        with self._task_lock:
            return self._tasks.get(task_id)

    def cancel(self, task_id: str) -> None:
        evt = self._cancels.get(task_id)
        if evt:
            evt.set()
        task = self.get_task(task_id)
        if task and task.status not in (
            DownloadStatus.COMPLETED,
            DownloadStatus.FAILED,
            DownloadStatus.CANCELLED,
        ):
            task.status = DownloadStatus.CANCELLED
            self._emit_status(task)

    def pause(self, task_id: str) -> None:
        evt = self._pauses.get(task_id)
        if evt:
            evt.clear()

    def resume(self, task_id: str) -> None:
        evt = self._pauses.get(task_id)
        if evt:
            evt.set()

    def remove_task(self, task_id: str) -> None:
        with self._task_lock:
            self._tasks.pop(task_id, None)
            self._task_order = [t for t in self._task_order if t != task_id]
            self._cancels.pop(task_id, None)
            self._pauses.pop(task_id, None)

    def clear_finished(self) -> None:
        with self._task_lock:
            done_ids = [
                tid
                for tid, t in self._tasks.items()
                if t.status
                in (
                    DownloadStatus.COMPLETED,
                    DownloadStatus.FAILED,
                    DownloadStatus.CANCELLED,
                    DownloadStatus.SKIPPED,
                )
            ]
        for tid in done_ids:
            self.remove_task(tid)

    # ------------------------------------------------------------------
    # 执行
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(
                max_workers=self.config.general.max_concurrent_downloads,
                thread_name_prefix="vidown-dl",
            )
        self._ensure_registry()
        # 派发所有未完成任务
        with self._task_lock:
            pending_ids = [
                tid
                for tid in self._task_order
                if self._tasks[tid].status in (DownloadStatus.QUEUED, DownloadStatus.PENDING)
            ]
        for tid in pending_ids:
            self._executor.submit(self._run_task, tid)

    def shutdown(self, wait: bool = True) -> None:
        if self._executor:
            self._executor.shutdown(wait=wait, cancel_futures=not wait)
            self._executor = None
        for evt in self._cancels.values():
            evt.set()
        for evt in self._pauses.values():
            evt.set()

    # ------------------------------------------------------------------
    # 单任务流程
    # ------------------------------------------------------------------
    def _run_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        if not task:
            return
        cancel_evt = self._cancels[task_id]
        pause_evt = self._pauses[task_id]

        def cancel_check() -> bool:
            return cancel_evt.is_set()

        try:
            task.status = DownloadStatus.PROBING
            self._emit_status(task)

            self._ensure_registry()
            assert self._registry is not None

            # 选择引擎
            self._log(
                task,
                "info",
                f"开始选择引擎: url={task.url}, platform={task.platform.value}, kind={task.kind.value}",
            )
            engine = self._registry.select(task.url, task.platform, task.kind)
            if not engine:
                available = [e.name for e in self._registry.engines]
                self._log(task, "error", f"没有可用引擎处理此链接，已注册引擎: {available}")
                raise EngineError("没有可用引擎处理此链接")

            self._log(task, "info", f"选中引擎: {engine.display_name} ({engine.name})")
            task.engine_used = engine.name

            # 引擎上下文
            from ..engines.base import EngineContext

            def _on_progress(progress: TaskProgress) -> None:
                if task.status != DownloadStatus.DOWNLOADING:
                    self._log(
                        task,
                        "info",
                        f"状态切换: {task.status.value} -> downloading (收到首个进度)",
                    )
                    task.status = DownloadStatus.DOWNLOADING
                    self._emit_status(task)
                task.progress = progress
                self._log(
                    task,
                    "debug",
                    f"进度上报: state={progress.state}, "
                    f"percent={progress.percent:.2f}%, "
                    f"downloaded={progress.downloaded_bytes}, "
                    f"total={progress.total_bytes}, "
                    f"speed={progress.speed_bps:.2f} B/s, "
                    f"eta={progress.eta_seconds}s, "
                    f"fragment={progress.fragment_index}/{progress.fragment_count}",
                )
                self._emit_progress(task)

            ctx = EngineContext(
                config=self.config,
                progress_callback=_on_progress,
                cancel_flag=cancel_check,
                log_callback=lambda level, msg: self._log(task, level, msg),
            )

            # 探测（带超时，避免网络阻塞无限挂起）
            probe_timeout = getattr(self.config.network, "probe_timeout", 60)
            try:
                info = self._probe_with_timeout(task, engine, task.url, ctx, timeout=probe_timeout)
            except DRMRestrictedError:
                task.status = DownloadStatus.SKIPPED
                task.error_message = "该资源受 DRM 保护，无法下载。"
                self._persist(task)
                self._emit_status(task)
                return
            except FormatNotFoundError as e:
                task.error_message = f"未找到匹配格式: {e}"
                task.status = DownloadStatus.FAILED
                self._persist(task)
                self._emit_status(task)
                return
            except EngineError as e:
                # 尝试 fallback
                self._log(task, "warning", f"主引擎失败: {e}，尝试 fallback")
                info = self._try_fallback_probe(task, ctx, exclude=engine.name)
                if not info:
                    raise

            task.info = info
            task.title = info.title
            if not task.selected_format_id and info.formats:
                # 自动选择
                sel = select_formats(info, self.config.quality, kind=info.kind)
                if sel.video:
                    task.selected_format_id = sel.video.format_id
                    task.selected_resolution = sel.video.resolution
                elif sel.audio:
                    task.selected_format_id = sel.audio.format_id
                    task.selected_resolution = "audio"
                elif sel.single:
                    task.selected_format_id = sel.single.format_id
                    task.selected_resolution = sel.single.resolution
            self._log(
                task,
                "info",
                f"标题: {info.title} | 平台: {info.platform.value} | "
                f"格式: {task.selected_format_id}",
            )

            # 检查暂停
            while not pause_evt.is_set():
                if cancel_check():
                    raise UserCancelledError("用户取消")
                time.sleep(0.3)

            # 进入下载（支持失败后 fallback）
            task.status = DownloadStatus.DOWNLOADING
            self._emit_status(task)
            result = self._download_with_fallback(task, info, ctx, engine)

            # 取消检查
            if cancel_check():
                raise UserCancelledError("用户取消")

            # 记录下载结果
            task.output_path = result.output_path
            task.engine_used = result.engine_name or engine.name

            # 后处理（转码/封装）
            if result.needs_postprocess and task.output_path:
                task.status = DownloadStatus.POSTPROCESSING
                self._emit_status(task)
                task.output_path = self._postprocess(task, task.output_path)

            # 完成
            task.status = DownloadStatus.COMPLETED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "info", f"完成: {task.output_path}")
            self._emit_status(task)

        except UserCancelledError as e:
            task.error_message = str(e)
            task.status = DownloadStatus.CANCELLED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "warning", "任务已取消")
            self._emit_status(task)
        except InsufficientDiskSpaceError as e:
            task.error_message = str(e)
            task.status = DownloadStatus.FAILED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "error", f"磁盘空间不足: {e}")
            self._emit_status(task)
        except NetworkError as e:
            task.error_message = f"网络错误: {e}"
            task.status = DownloadStatus.FAILED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "error", f"网络错误: {e}")
            self._emit_status(task)
        except VidownError as e:
            task.error_message = str(e)
            task.status = DownloadStatus.FAILED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "error", f"任务失败: {e}")
            self._emit_status(task)
        except Exception as e:
            logger.exception(f"任务 {task_id} 未知异常")
            task.error_message = f"未知错误: {e}"
            task.status = DownloadStatus.FAILED
            task.finished_at = time.time()
            self._persist(task)
            self._log(task, "error", f"未知异常: {e}")
            self._emit_status(task)

    def _probe_with_timeout(
        self, task: DownloadTask, engine, url: str, ctx, timeout: float
    ) -> VideoInfo:
        """在独立线程中执行 probe 并设置硬超时。"""
        self._log(
            task,
            "info",
            f"开始探测: engine={engine.display_name}, timeout={timeout}s",
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(engine.probe, url, ctx)
            try:
                info = future.result(timeout=timeout)
                self._log(
                    task,
                    "info",
                    f"探测完成: title={info.title}, platform={info.platform.value}, "
                    f"formats={len(info.formats)}, is_live={info.is_live}",
                )
                return info
            except TimeoutError as e:
                self._log(
                    task,
                    "warning",
                    f"探测 {engine.display_name} 超时（{timeout}s）",
                )
                raise EngineError(f"探测 {engine.display_name} 超时（{timeout}s）") from e

    def _download_with_fallback(
        self,
        task: DownloadTask,
        info: VideoInfo,
        ctx,
        primary_engine,
    ) -> DownloadResult:
        """先使用主引擎下载；失败后依次尝试 fallback 引擎。"""
        engines = [primary_engine] + [
            e
            for e in (self._registry.fallback_chain(task.url, task.platform, task.kind))
            if e.name != primary_engine.name
        ]
        self._log(
            task,
            "info",
            f"下载链: {[eng.display_name for eng in engines]}",
        )
        last_error = EngineError("没有可用引擎")
        for eng in engines:
            try:
                self._log(task, "info", f"开始下载: engine={eng.display_name}")
                result = eng.download_info(task, info, ctx)
                if result and result.output_path:
                    self._log(
                        task,
                        "info",
                        f"下载成功: engine={eng.display_name}, output={result.output_path}",
                    )
                    return result
                self._log(task, "warning", f"{eng.display_name} 返回空结果")
                last_error = EngineError(f"{eng.display_name} 返回空结果")
            except Exception as e:
                self._log(task, "warning", f"{eng.display_name} 下载失败: {e}")
                last_error = e
        self._log(task, "error", f"所有引擎下载失败: {last_error}")
        raise last_error

    def _postprocess(self, task: DownloadTask, input_path: str) -> str:
        """使用 FFmpeg 将下载结果统一转码/封装为 H.264 MP4。"""
        from pathlib import Path
        from ..postprocess.ffmpeg_pipe import transcode_to_h264

        input_p = Path(input_path)
        output_path = input_p.with_suffix(".mp4")
        if output_path.exists():
            i = 1
            while True:
                cand = output_path.with_name(f"{output_path.stem}-{i}{output_path.suffix}")
                if not cand.exists():
                    output_path = cand
                    break
                i += 1
        self._log(task, "info", f"开始转码: {input_path} -> {output_path}")
        try:
            transcode_to_h264(
                str(input_path),
                str(output_path),
                crf=self.config.quality.video_crf,
                preset=self.config.quality.video_preset,
                audio_codec=self.config.quality.audio_codec,
                audio_bitrate=self.config.quality.audio_bitrate,
                copy_if_already_h264=True,
            )
            if not self.config.postprocess.preserve_original and input_p != output_path:
                try:
                    input_p.unlink()
                except OSError:
                    pass
            return str(output_path)
        except Exception as e:
            self._log(task, "warning", f"后处理失败，保留原文件: {e}")
            return input_path

    def _try_fallback_probe(
        self,
        task: DownloadTask,
        ctx,
        exclude: str,
    ) -> Optional[VideoInfo]:
        assert self._registry is not None
        for engine in self._registry.fallback_chain(task.url, task.platform, task.kind):
            if engine.name == exclude:
                continue
            try:
                self._log(task, "info", f"fallback 探测: {engine.display_name}")
                return engine.probe(task.url, ctx)
            except Exception as e:
                self._log(task, "warning", f"{engine.display_name} 也失败: {e}")
        return None

    # ------------------------------------------------------------------
    # 持久化与回调
    # ------------------------------------------------------------------
    def _persist(self, task: DownloadTask) -> None:
        try:
            from ..data.history import HistoryRepository

            HistoryRepository().upsert_task(task)
        except Exception as e:
            logger.debug(f"历史记录写入失败: {e}")

    def _emit_progress(self, task: DownloadTask) -> None:
        if not self._progress_callbacks:
            logger.debug(f"[{task.id}] 无进度回调注册")
            return
        for cb in self._progress_callbacks:
            try:
                cb(task)
            except Exception as e:
                logger.warning(f"[{task.id}] progress callback 异常: {e}")

    def _emit_status(self, task: DownloadTask) -> None:
        logger.debug(f"[{task.id}] 状态变更: {task.status.value}")
        if not self._status_callbacks:
            logger.debug(f"[{task.id}] 无状态回调注册")
            return
        for cb in self._status_callbacks:
            try:
                cb(task)
            except Exception as e:
                logger.warning(f"[{task.id}] status callback 异常: {e}")

    def _log(self, task: DownloadTask, level: str, msg: str) -> None:
        logger.log(getattr(__import__("logging"), level.upper(), 20), f"[{task.id}] {msg}")
        for cb in self._log_callbacks:
            try:
                cb(task, level, msg)
            except Exception:
                pass
