"""Vidown 统一日志。"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

DEFAULT_FORMAT = "[%(asctime)s] %(levelname)-7s %(name)s :: %(message)s"
DEFAULT_LEVEL = os.environ.get("VIDOWN_LOG_LEVEL", "INFO").upper()

_configured = False


def setup_logging(
    level: str = DEFAULT_LEVEL,
    log_file: Optional[str] = None,
    file_max_bytes: int = 5 * 1024 * 1024,
    file_backup_count: int = 5,
) -> None:
    """初始化全局日志配置。多次调用安全。"""
    global _configured

    root = logging.getLogger("vidown")
    if _configured:
        root.setLevel(level)
        return

    root.setLevel(level)
    root.propagate = False

    formatter = logging.Formatter(DEFAULT_FORMAT, datefmt="%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(formatter)
    root.addHandler(console)

    if log_file:
        log_path = Path(log_file).expanduser()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=file_max_bytes,
            backupCount=file_backup_count,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    # 屏蔽一些噪音
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    _configured = True


def get_logger(name: Optional[str] = None) -> logging.Logger:
    if not _configured:
        setup_logging()
    if name:
        return logging.getLogger(f"vidown.{name}")
    return logging.getLogger("vidown")
