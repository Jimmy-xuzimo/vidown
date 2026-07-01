"""Vidown 命令行界面。

用法：
    vidown <URL> [选项]            下载单个链接
    vidown <FILE> [选项]          批量下载文件中的所有链接
    vidown probe <URL>            仅探测链接信息
    vidown history                查看历史
    vidown config show            显示配置
    vidown gui [--port 8765]      启动 Web GUI
    vidown check                  检查依赖
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import List, Optional

# Windows cp1252 兼容：必须在第一次写 stdout 之前钉住环境变量，
# 这是子进程（如 test_cli.py 启动 `python -m vidown`）能拿到 utf-8
# stdout 的最稳方式。
from ..compat import configure_utf8_stdout

configure_utf8_stdout()

from .. import __version__  # noqa: E402  必须在 configure_utf8_stdout 之后
from ..core.config import load_config  # noqa: E402
from ..core.logger import get_logger, setup_logging  # noqa: E402
from ..core.models import DownloadStatus  # noqa: E402
from ..core.platform_detect import classify_url, filter_urls  # noqa: E402
from ..core.scheduler import DownloadScheduler  # noqa: E402

logger = get_logger("cli")


# ----------------------------------------------------------------------
# 进度展示
# ----------------------------------------------------------------------


class ProgressPrinter:
    def __init__(self, use_tty: bool = True):
        self.use_tty = use_tty and sys.stdout.isatty()
        self._last = ""

    def on_progress(self, task) -> None:
        p = task.progress
        line = (
            f"[{task.id}] {task.status.value:14s} "
            f"{p.percent:6.2f}% "
            f"{_hr_speed(p.speed_bps):>10s} "
            f"ETA {_hr_eta(p.eta_seconds):>8s} "
            f"{(p.downloaded_bytes/1024/1024):8.2f}MB"
        )
        self._print(line)

    def on_status(self, task) -> None:
        self._print(
            f"[{task.id}] 状态 -> {task.status.value}"
            f"{(': ' + task.error_message) if task.error_message else ''}"
        )

    def on_log(self, task, level: str, msg: str) -> None:
        if level in ("error", "warning"):
            self._print(f"[{task.id}] {level}: {msg}")

    def _print(self, line: str) -> None:
        if self.use_tty:
            sys.stdout.write("\r" + " " * max(len(self._last), len(line)) + "\r")
            sys.stdout.write(line)
            sys.stdout.flush()
        else:
            print(line)
        self._last = line


def _hr_speed(bps: float) -> str:
    if not bps:
        return "0 B/s"
    units = ["B/s", "KB/s", "MB/s", "GB/s"]
    v = float(bps)
    for u in units:
        if v < 1024:
            return f"{v:.2f} {u}"
        v /= 1024
    return f"{v:.2f} TB/s"


def _hr_eta(secs: Optional[int]) -> str:
    if secs is None:
        return "--"
    m, s = divmod(int(secs), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


# ----------------------------------------------------------------------
# 子命令
# ----------------------------------------------------------------------


def cmd_download(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    if args.output:
        config.general.download_dir = args.output
    if args.quality:
        config.quality.preference = args.quality
    if args.codec:
        config.quality.force_codec = args.codec

    urls: List[str] = []
    for a in args.urls:
        p = Path(a)
        if p.exists() and p.is_file():
            urls.extend(filter_urls([p.read_text(encoding="utf-8")]))
        else:
            urls.extend(filter_urls([a]))
    urls = list(dict.fromkeys(urls))
    if not urls:
        print("未提供有效 URL", file=sys.stderr)
        return 1

    setup_logging(level="INFO" if not args.verbose else "DEBUG")
    scheduler = DownloadScheduler(config)
    printer = ProgressPrinter(use_tty=not args.no_progress)
    scheduler.on_progress(printer.on_progress)
    scheduler.on_status(printer.on_status)
    scheduler.on_log(printer.on_log)

    for u in urls:
        platform_enum, kind = classify_url(u)
        scheduler.add_task(u, platform=platform_enum, kind=kind)

    scheduler.start()
    scheduler.shutdown(wait=True)

    # 汇总
    tasks = scheduler.list_tasks()
    success = sum(1 for t in tasks if t.status == DownloadStatus.COMPLETED)
    failed = sum(1 for t in tasks if t.status == DownloadStatus.FAILED)
    print(f"\n完成: {success}, 失败: {failed}, 总数: {len(tasks)}")
    return 0 if failed == 0 else 2


def cmd_probe(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    setup_logging(level="INFO")
    scheduler = DownloadScheduler(config)
    scheduler._ensure_registry()
    assert scheduler._registry is not None
    from ..engines.base import EngineContext

    for u in args.urls:
        platform_enum, kind = classify_url(u)
        engine = scheduler._registry.select(u, platform_enum, kind)
        if not engine:
            print(f"{u}: 无可用引擎", file=sys.stderr)
            continue
        try:
            info = engine.probe(u, EngineContext(config=config))
            print(json.dumps(info.to_dict(), ensure_ascii=False, indent=2))
        except Exception as e:
            print(f"{u}: 探测失败: {e}", file=sys.stderr)
    return 0


def cmd_history(args: argparse.Namespace) -> int:
    from ..data.history import HistoryRepository

    repo = HistoryRepository()
    entries = repo.list(limit=args.limit, search=args.search, status=args.status)
    for e in entries:
        print(
            f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(e.created_at))}  "
            f"{e.status:<14s}  {e.title[:40]:<40s}  "
            f"{e.platform:<10s}  {e.url[:60]}"
        )
    print(f"\n共 {len(entries)} 条记录")
    if args.stats:
        print("统计:", json.dumps(repo.stats(), ensure_ascii=False))
    return 0


def cmd_config_show(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    print(config.to_json())
    return 0


def cmd_config_set(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    # 简化: --set key=value
    for kv in args.set:
        if "=" not in kv:
            print(f"无效: {kv}（需为 key=value）", file=sys.stderr)
            continue
        k, v = kv.split("=", 1)
        keys = k.split(".")
        obj = config
        for kk in keys[:-1]:
            obj = getattr(obj, kk, None)
            if obj is None:
                break
        if obj is None:
            print(f"未找到配置项: {k}", file=sys.stderr)
            continue
        cur = getattr(obj, keys[-1], None)
        if isinstance(cur, bool):
            v = v.lower() in ("1", "true", "yes", "on")
        elif isinstance(cur, int):
            try:
                v = int(v)
            except ValueError:
                pass
        setattr(obj, keys[-1], v)
    config.save()
    print("配置已保存")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    from ..core.utils import check_ffmpeg, check_yt_dlp, check_optional_tool

    print(f"Vidown v{__version__}\n")

    print("核心依赖:")
    try:
        ffmpeg, ffprobe = check_ffmpeg()
        print(f"  ✓ ffmpeg:   {ffmpeg}")
        print(f"  ✓ ffprobe:  {ffprobe}")
    except Exception as e:
        print(f"  ✗ ffmpeg:   {e}")

    ytdlp = check_yt_dlp()
    print(f"  {'✓' if ytdlp else '✗'} yt-dlp:   {ytdlp or '未安装'}")

    print("\n可选依赖:")
    for name in ("N_m3u8DL-RE", "you-get", "lux", "gallery-dl"):
        path = check_optional_tool(name)
        print(f"  {'✓' if path else '○'} {name}:   {path or '未检测到'}")
    return 0


def cmd_gui(args: argparse.Namespace) -> int:
    from ..gui import run_server

    run_server(host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


# ----------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="vidown",
        description="通用视频下载器 —— 类 Downie4 的全能流媒体工具",
    )
    p.add_argument("--version", action="version", version=f"vidown {__version__}")
    p.add_argument("-c", "--config", help="配置文件路径", default=None)
    p.add_argument("-v", "--verbose", action="store_true", help="调试日志")

    sub = p.add_subparsers(dest="command")

    # 默认 download
    dl = sub.add_parser("download", help="下载视频", aliases=["dl", "d"])
    dl.add_argument("urls", nargs="+", help="URL 或文本文件")
    dl.add_argument("-o", "--output", help="下载目录")
    dl.add_argument("-q", "--quality", help="质量偏好: best/8k/2160p/1080p/720p/480p")
    dl.add_argument("-c", "--codec", help="视频编码: h264/hevc/av1/original")
    dl.add_argument("--no-progress", action="store_true", help="禁用进度条")
    dl.set_defaults(func=cmd_download)

    pb = sub.add_parser("probe", help="仅探测链接", aliases=["p"])
    pb.add_argument("urls", nargs="+", help="URL")
    pb.set_defaults(func=cmd_probe)

    hi = sub.add_parser("history", help="查看历史", aliases=["h"])
    hi.add_argument("-n", "--limit", type=int, default=50)
    hi.add_argument("-s", "--search", help="搜索关键词")
    hi.add_argument("--status", help="按状态过滤")
    hi.add_argument("--stats", action="store_true", help="显示统计")
    hi.set_defaults(func=cmd_history)

    cfg = sub.add_parser("config", help="配置管理")
    cfg_sub = cfg.add_subparsers(dest="config_cmd")
    cfg_show = cfg_sub.add_parser("show", help="显示配置")
    cfg_show.set_defaults(func=cmd_config_show)
    cfg_set = cfg_sub.add_parser("set", help="设置配置项")
    cfg_set.add_argument(
        "--set", action="append", default=[], help="形如 general.download_dir=~/Downloads"
    )
    cfg_set.set_defaults(func=cmd_config_set)

    ck = sub.add_parser("check", help="检查依赖")
    ck.set_defaults(func=cmd_check)

    gp = sub.add_parser("gui", help="启动 Web 图形界面")
    gp.add_argument("--host", default="127.0.0.1")
    gp.add_argument("--port", type=int, default=8765)
    gp.add_argument("--no-browser", action="store_true")
    gp.set_defaults(func=cmd_gui)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    # Windows cp1252 兼容：argparse 在 --help 之前会格式化带中文的 help 文本，
    # 这要求 stdout 是 utf-8 编码。
    configure_utf8_stdout()
    parser = build_parser()
    if not argv:
        argv = sys.argv[1:]
    # 兼容：vidown <URL> 直接当 download
    if (
        argv
        and not argv[0].startswith("-")
        and argv[0]
        not in {
            "download",
            "dl",
            "d",
            "probe",
            "p",
            "history",
            "h",
            "config",
            "check",
            "gui",
            "help",
            "-h",
            "--help",
        }
    ):
        argv = ["download", *argv]
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
