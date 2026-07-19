"""测试：统一路径工具。"""

from __future__ import annotations

from pathlib import Path

from vidown.core.config import Config
from vidown.core.path_utils import (
    get_download_dir,
    get_work_dir,
    move_to_download_dir,
    safe_name,
    unique_path,
)


def test_get_download_dir_expands_tilde(tmp_path):
    cfg = Config()
    cfg.general.download_dir = str(tmp_path / "downloads")
    d = get_download_dir(cfg)
    assert d.exists()
    assert d.name == "downloads"


def test_get_work_dir_creates_hidden_work(tmp_path):
    work = get_work_dir(tmp_path, "task-123")
    assert work.exists()
    assert work.name == "task-123"
    assert work.parent.name == ".vidown_work"


def test_unique_path_avoids_collision(tmp_path):
    existing = tmp_path / "file.txt"
    existing.write_text("x")
    p = unique_path(tmp_path / "file.txt")
    assert p.name == "file-1.txt"


def test_safe_name_with_config(tmp_path):
    cfg = Config()
    cfg.naming.max_length = 10
    cfg.naming.sanitize_windows = True
    assert safe_name("a/b:c?d", cfg) == "a_b_c_d"
    assert len(safe_name("very long name here", cfg)) <= 10


def test_move_to_download_dir(tmp_path):
    src = tmp_path / "work" / "video.mp4"
    src.parent.mkdir()
    src.write_text("video")
    download_dir = tmp_path / "downloads"
    work_dir = tmp_path / "work"
    final = move_to_download_dir(src, download_dir, work_dir)
    assert Path(final).exists()
    assert Path(final).parent == download_dir
    assert not src.exists()
