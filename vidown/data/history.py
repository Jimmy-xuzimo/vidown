"""下载历史仓储。"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ..core.models import DownloadTask
from .database import Database, get_db


@dataclass
class HistoryEntry:
    task_id: str
    url: str
    title: str
    platform: str
    status: str
    output_path: str
    file_size: int
    duration: int
    engine: str
    error_message: str
    created_at: float
    finished_at: float

    @classmethod
    def from_row(cls, row) -> "HistoryEntry":
        return cls(
            task_id=row["task_id"],
            url=row["url"],
            title=row["title"] or "",
            platform=row["platform"] or "",
            status=row["status"] or "",
            output_path=row["output_path"] or "",
            file_size=row["file_size"] or 0,
            duration=row["duration"] or 0,
            engine=row["engine"] or "",
            error_message=row["error_message"] or "",
            created_at=row["created_at"] or 0.0,
            finished_at=row["finished_at"] or 0.0,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "url": self.url,
            "title": self.title,
            "platform": self.platform,
            "status": self.status,
            "output_path": self.output_path,
            "file_size": self.file_size,
            "duration": self.duration,
            "engine": self.engine,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


class HistoryRepository:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or get_db()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def upsert_task(self, task: DownloadTask) -> None:
        info = task.info
        file_size = 0
        if info and info.formats:
            file_size = info.formats[0].filesize or 0
        sql = """
        INSERT INTO history (task_id, url, title, platform, status, output_path, file_size, engine, error_message, created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
            title=excluded.title,
            platform=excluded.platform,
            status=excluded.status,
            output_path=excluded.output_path,
            file_size=excluded.file_size,
            engine=excluded.engine,
            error_message=excluded.error_message,
            finished_at=excluded.finished_at
        """
        self.db.execute(
            sql,
            (
                task.id,
                task.url,
                task.title or (info.title if info else ""),
                task.platform.value if task.platform else "unknown",
                task.status.value,
                task.output_path or "",
                file_size,
                task.engine_used or "",
                task.error_message or "",
                task.created_at,
                task.finished_at or 0.0,
            ),
        )

    def mark_finished(self, task: DownloadTask) -> None:
        sql = """
        UPDATE history SET status=?, output_path=?, engine=?, error_message=?, finished_at=?
        WHERE task_id=?
        """
        self.db.execute(
            sql,
            (
                task.status.value,
                task.output_path or "",
                task.engine_used or "",
                task.error_message or "",
                task.finished_at or time.time(),
                task.id,
            ),
        )

    def get(self, task_id: str) -> Optional[HistoryEntry]:
        row = self.db.query_one("SELECT * FROM history WHERE task_id=?", (task_id,))
        return HistoryEntry.from_row(row) if row else None

    def list(
        self,
        limit: int = 100,
        offset: int = 0,
        search: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[HistoryEntry]:
        sql = "SELECT * FROM history WHERE 1=1"
        params: List[Any] = []
        if search:
            sql += " AND (title LIKE ? OR url LIKE ?)"
            params += [f"%{search}%", f"%{search}%"]
        if status:
            sql += " AND status=?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params += [limit, offset]
        rows = self.db.query(sql, tuple(params))
        return [HistoryEntry.from_row(r) for r in rows]

    def delete(self, task_id: str) -> None:
        self.db.execute("DELETE FROM history WHERE task_id=?", (task_id,))

    def clear(self) -> None:
        self.db.execute("DELETE FROM history")

    def stats(self) -> Dict[str, int]:
        rows = self.db.query("SELECT status, COUNT(*) AS c FROM history GROUP BY status")
        result: Dict[str, int] = {}
        for r in rows:
            result[r["status"]] = r["c"]
        return result
