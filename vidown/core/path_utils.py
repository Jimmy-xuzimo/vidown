"""统一的路径、目录与文件管理工具。

为各引擎提供一致的下载目录、工作目录、文件移动与命名逻辑，
避免在 direct_engine / m3u8_engine / fallback_engines 中重复实现。
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional

from .config import Config
from .utils import sanitize_filename


def get_download_dir(config: Config, ensure_exists: bool = True) -> Path:
    """返回已展开环境变量与用户目录的下载目录。"""
    d = Path(os.path.expandvars(os.path.expanduser(config.general.download_dir)))
    if ensure_exists:
        d.mkdir(parents=True, exist_ok=True)
    return d


def get_work_dir(download_dir: Path, task_id: str, ensure_exists: bool = True) -> Path:
    """返回任务专属工作目录。"""
    work = download_dir / ".vidown_work" / task_id
    if ensure_exists:
        work.mkdir(parents=True, exist_ok=True)
    return work


def unique_path(path: Path) -> Path:
    """若 path 已存在，则在文件名后追加递增序号，返回可用路径。"""
    if not path.exists():
        return path
    i = 1
    while True:
        cand = path.with_name(f"{path.stem}-{i}{path.suffix}")
        if not cand.exists():
            return cand
        i += 1


def safe_name(name: str, config: Optional[Config] = None) -> str:
    """根据配置清理文件名。"""
    if config is None:
        return sanitize_filename(name)
    return sanitize_filename(
        name,
        max_length=config.naming.max_length,
        windows_safe=config.naming.sanitize_windows,
    )


def move_to_download_dir(src: Path, download_dir: Path, work_dir: Path) -> str:
    """将工作目录中的产物移动到下载目录，并在冲突时生成唯一文件名。

    使用 shutil.move 以兼容跨文件系统移动。移动完成后尝试清理空工作目录。
    """
    download_dir.mkdir(parents=True, exist_ok=True)
    dest = unique_path(download_dir / src.name)
    shutil.move(str(src), str(dest))
    try:
        work_dir.rmdir()
    except OSError:
        pass
    return str(dest)
