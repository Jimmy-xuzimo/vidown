"""测试：下载调度器（离线行为）。"""

from __future__ import annotations


from vidown.core.config import Config
from vidown.core.models import DownloadStatus, Platform
from vidown.core.scheduler import DownloadScheduler


def test_add_and_list_task():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    t = sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    assert t.id in [x.id for x in sched.list_tasks()]
    assert t.status == DownloadStatus.QUEUED


def test_cancel_works():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    t = sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    sched.cancel(t.id)
    assert t.status == DownloadStatus.CANCELLED


def test_pause_resume():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    t = sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    sched.pause(t.id)
    # 不应崩溃
    sched.resume(t.id)


def test_remove():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    t = sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    sched.remove_task(t.id)
    assert sched.get_task(t.id) is None


def test_callbacks_fire():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    status_calls = []

    sched.on_status(lambda t: status_calls.append(t.status))
    sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    assert DownloadStatus.QUEUED in status_calls


def test_shutdown_does_not_block_indefinitely():
    cfg = Config()
    sched = DownloadScheduler(cfg)
    sched.add_task("https://example.com", platform=Platform.UNKNOWN)
    sched.shutdown(wait=True)
    assert sched._executor is None
