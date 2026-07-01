"""SQLite 数据库连接与建表。"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from ..core.logger import get_logger

logger = get_logger("data.db")

DEFAULT_DB_PATH = Path.home() / ".vidown" / "vidown.db"

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    platform TEXT,
    status TEXT,
    output_path TEXT,
    file_size INTEGER,
    duration INTEGER,
    engine TEXT,
    error_message TEXT,
    created_at REAL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_status ON history(status);

CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    platform TEXT,
    status TEXT,
    priority INTEGER DEFAULT 0,
    payload TEXT,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    browser TEXT UNIQUE,
    cookies_file TEXT,
    imported_at REAL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


class Database:
    """轻量级 SQLite 封装。线程安全。"""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else DEFAULT_DB_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(_SCHEMA_SQL)
            conn.commit()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = sqlite3.connect(
                self.path, detect_types=sqlite3.PARSE_DECLTYPES, timeout=30
            )
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

    def execute(self, sql: str, params: tuple = ()) -> None:
        with self._connect() as conn:
            conn.execute(sql, params)
            conn.commit()

    def executemany(self, sql: str, params_seq) -> None:
        with self._connect() as conn:
            conn.executemany(sql, params_seq)
            conn.commit()

    def query(self, sql: str, params: tuple = ()) -> list:
        with self._connect() as conn:
            cur = conn.execute(sql, params)
            return cur.fetchall()

    def query_one(self, sql: str, params: tuple = ()):
        with self._connect() as conn:
            cur = conn.execute(sql, params)
            return cur.fetchone()


_db_instance: Optional[Database] = None
_db_lock = threading.Lock()


def get_db(path: Optional[Path] = None) -> Database:
    global _db_instance
    with _db_lock:
        if _db_instance is None:
            _db_instance = Database(path)
        return _db_instance
