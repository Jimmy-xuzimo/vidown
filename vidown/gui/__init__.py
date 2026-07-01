"""Web 图形界面。

使用 Python 标准库 http.server + WebSocket 简化实现，无第三方依赖。
- 前端为单页 HTML（Downie4 风格）
- 后端提供 REST API + 实时进度（WebSocket）
"""

from .server import run_server, VidownHTTPServer

__all__ = ["run_server", "VidownHTTPServer"]
