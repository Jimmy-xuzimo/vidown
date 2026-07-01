"""Cookie 存储：浏览器的 cookie 文件导入与导出。"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.logger import get_logger
from .database import Database, get_db

logger = get_logger("data.cookies")

COOKIES_DIR = Path.home() / ".vidown" / "cookies"


class CookieStore:
    """Cookie 元信息管理。实际 cookie 文件路径存在数据库中。"""

    def __init__(self, db: Optional[Database] = None):
        self.db = db or get_db()
        COOKIES_DIR.mkdir(parents=True, exist_ok=True)

    def import_from_browser(self, browser: str) -> str:
        """从浏览器导出 cookie（Netscape 格式）并存储。"""
        try:
            import browser_cookie3  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "browser_cookie3 未安装，请运行 `pip install browser-cookie3`"
            ) from e

        fn = getattr(browser_cookie3, browser, None)
        if not fn:
            raise ValueError(f"不支持的浏览器: {browser}")
        jar = fn(domain_name="")
        out = COOKIES_DIR / f"{browser}_{int(time.time())}.txt"
        with open(out, "w", encoding="utf-8") as f:
            f.write("# Netscape HTTP Cookie File\n")
            for c in jar:
                # 格式参考 yt-dlp cookiefile
                secure = "TRUE" if c.secure else "FALSE"
                httponly = "TRUE" if c._rest.get("HttpOnly") else "FALSE"
                expires = int(c.expires) if c.expires else 0
                f.write(
                    f"{c.domain}\tTRUE\t{c.path}\t{secure}\t{expires}\t{c.name}\t{c.value}\n"
                )
        # 记录
        self.db.execute(
            "INSERT OR REPLACE INTO cookies (browser, cookies_file, imported_at) VALUES (?, ?, ?)",
            (browser, str(out), time.time()),
        )
        logger.info(f"已从 {browser} 导入 cookie: {out}")
        return str(out)

    def get_cookies_file(self, browser: str) -> Optional[str]:
        row = self.db.query_one(
            "SELECT cookies_file FROM cookies WHERE browser=? ORDER BY imported_at DESC LIMIT 1",
            (browser,),
        )
        return row["cookies_file"] if row else None

    def list_browsers(self) -> List[Dict[str, Any]]:
        rows = self.db.query("SELECT * FROM cookies ORDER BY imported_at DESC")
        return [dict(r) for r in rows]

    def clear(self, browser: Optional[str] = None) -> None:
        if browser:
            self.db.execute("DELETE FROM cookies WHERE browser=?", (browser,))
        else:
            self.db.execute("DELETE FROM cookies")


def import_cookies_from_browser(browser: str) -> str:
    """便捷函数：从浏览器导入 cookie。"""
    return CookieStore().import_from_browser(browser)
