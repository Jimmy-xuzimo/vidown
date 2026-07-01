"""测试：数据层。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from vidown.core.models import DownloadStatus, Platform, DownloadTask
from vidown.data.database import Database
from vidown.data.history import HistoryRepository


@pytest.fixture
def tmp_db():
    with tempfile.TemporaryDirectory() as d:
        yield Database(Path(d) / "test.db")


def test_db_init(tmp_db):
    assert tmp_db is not None


def test_history_upsert_and_list(tmp_db):
    repo = HistoryRepository(tmp_db)
    task = DownloadTask(
        url="https://www.youtube.com/watch?v=abc",
        title="Hello",
        platform=Platform.YOUTUBE,
        status=DownloadStatus.COMPLETED,
    )
    repo.upsert_task(task)
    entries = repo.list()
    assert len(entries) == 1
    assert entries[0].url == task.url
    assert entries[0].title == "Hello"


def test_history_search(tmp_db):
    repo = HistoryRepository(tmp_db)
    repo.upsert_task(
        DownloadTask(
            url="https://example.com/foo",
            title="foo bar",
            platform=Platform.YOUTUBE,
        )
    )
    repo.upsert_task(
        DownloadTask(
            url="https://example.com/baz",
            title="baz qux",
            platform=Platform.BILIBILI,
        )
    )
    results = repo.list(search="foo")
    assert len(results) == 1
    assert results[0].title == "foo bar"


def test_history_update(tmp_db):
    repo = HistoryRepository(tmp_db)
    task = DownloadTask(
        url="https://example.com",
        title="x",
        platform=Platform.YOUTUBE,
        status=DownloadStatus.DOWNLOADING,
    )
    repo.upsert_task(task)
    task.status = DownloadStatus.COMPLETED
    task.output_path = "/tmp/x.mp4"
    repo.upsert_task(task)
    e = repo.get(task.id)
    assert e.status == "completed"
    assert e.output_path == "/tmp/x.mp4"


def test_history_stats(tmp_db):
    repo = HistoryRepository(tmp_db)
    for status in [DownloadStatus.COMPLETED, DownloadStatus.COMPLETED, DownloadStatus.FAILED]:
        repo.upsert_task(
            DownloadTask(
                url=f"https://x/{status}",
                title="x",
                platform=Platform.YOUTUBE,
                status=status,
            )
        )
    stats = repo.stats()
    assert stats.get("completed") == 2
    assert stats.get("failed") == 1


def test_history_delete(tmp_db):
    repo = HistoryRepository(tmp_db)
    task = DownloadTask(
        url="https://x",
        title="x",
        platform=Platform.YOUTUBE,
        status=DownloadStatus.COMPLETED,
    )
    repo.upsert_task(task)
    repo.delete(task.id)
    assert repo.get(task.id) is None
