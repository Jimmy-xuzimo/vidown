"""Vidown 嵌入式 Web 服务器。"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import webbrowser
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from ..core.config import Config, load_config, save_config
from ..core.exceptions import VidownError
from ..core.logger import get_logger
from ..core.models import DownloadStatus, DownloadTask
from ..core.platform_detect import classify_url, filter_urls, platform_display_name
from ..core.scheduler import DownloadScheduler
from ..data.history import HistoryRepository

logger = get_logger("gui")

STATIC_DIR = Path(__file__).parent / "static"
TEMPLATE_DIR = Path(__file__).parent / "templates"


# ----------------------------------------------------------------------
# 应用上下文
# ----------------------------------------------------------------------

class AppContext:
    """Web GUI 后端上下文。"""

    def __init__(self, config: Config):
        self.config = config
        self.scheduler = DownloadScheduler(config)
        self.history = HistoryRepository()
        self._clipboard_thread: Optional[threading.Thread] = None
        self._clipboard_running = False
        self._sse_clients: List[Any] = []  # Server-Sent Events
        self._lock = threading.Lock()

        # 注册回调以推送到前端
        self.scheduler.on_progress(self._push_progress)
        self.scheduler.on_status(self._push_status)
        self.scheduler.on_log(self._push_log)

    # ------------------------------------------------------------------
    # 剪贴板
    # ------------------------------------------------------------------
    def start_clipboard(self) -> bool:
        if self._clipboard_running:
            return True
        if not self.config.general.enable_clipboard_watcher:
            return False
        try:
            from ..utils.clipboard import ClipboardWatcher

            def _on_new_link(url, platform, kind):
                task = self.scheduler.add_task(url, platform=platform, kind=kind)
                self._push_event("clipboard", {
                    "url": url, "platform": platform.value, "kind": kind.value,
                    "task_id": task.id,
                })

            self._clipboard_watcher = ClipboardWatcher(_on_new_link)
            self._clipboard_watcher.start()
            self._clipboard_running = True
            return True
        except Exception as e:
            logger.warning(f"剪贴板监听启动失败: {e}")
            return False

    def stop_clipboard(self) -> None:
        if not self._clipboard_running:
            return
        try:
            self._clipboard_watcher.stop()
        except Exception:
            pass
        self._clipboard_running = False

    # ------------------------------------------------------------------
    # 事件推送（SSE）
    # ------------------------------------------------------------------
    def _push_progress(self, task: DownloadTask) -> None:
        self._push_event("progress", task.to_dict())

    def _push_status(self, task: DownloadTask) -> None:
        self._push_event("status", task.to_dict())

    def _push_log(self, task: DownloadTask, level: str, msg: str) -> None:
        if level in ("error", "warning", "info"):
            self._push_event("log", {
                "task_id": task.id, "level": level, "message": msg,
            })

    def _push_event(self, event: str, data: Dict[str, Any]) -> None:
        with self._lock:
            stale = []
            for client in self._sse_clients:
                try:
                    client.send(event, data)
                except Exception:
                    stale.append(client)
            for s in stale:
                try:
                    self._sse_clients.remove(s)
                except ValueError:
                    pass

    def add_sse_client(self, client) -> None:
        with self._lock:
            self._sse_clients.append(client)

    def remove_sse_client(self, client) -> None:
        with self._lock:
            try:
                self._sse_clients.remove(client)
            except ValueError:
                pass


# ----------------------------------------------------------------------
# SSE 客户端模拟
# ----------------------------------------------------------------------

class _SSEClient:
    def __init__(self, wfile):
        self.wfile = wfile
        self._lock = threading.Lock()

    def send(self, event: str, data: Dict[str, Any]) -> None:
        msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        with self._lock:
            try:
                self.wfile.write(msg.encode("utf-8"))
                self.wfile.flush()
            except Exception:
                raise


# ----------------------------------------------------------------------
# HTTP Handler
# ----------------------------------------------------------------------

class VidownHTTPHandler(BaseHTTPRequestHandler):
    server_version = "VidownHTTP/1.0"
    app: AppContext  # 由 build_handler 注入

    # 静默默认日志
    def log_message(self, format, *args):  # noqa
        logger.debug(f"HTTP {self.address_string()} - {format % args}")

    # ---- 工具 ----
    def _send_json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text: str, status: int = 200,
                   content_type: str = "text/plain; charset=utf-8") -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.exists():
            self._send_text("Not Found", 404)
            return
        ctype = "text/plain; charset=utf-8"
        if path.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        elif path.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif path.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif path.suffix in (".svg",):
            ctype = "image/svg+xml"
        elif path.suffix in (".png",):
            ctype = "image/png"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    # ---- 路由 ----
    def do_GET(self):  # noqa
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            self._send_file(TEMPLATE_DIR / "index.html")
            return
        if path == "/static/style.css":
            self._send_file(STATIC_DIR / "style.css")
            return
        if path == "/static/app.js":
            self._send_file(STATIC_DIR / "app.js")
            return
        if path == "/favicon.ico":
            self._send_file(STATIC_DIR / "favicon.svg")
            return
        if path == "/api/version":
            from .. import __version__
            self._send_json({"version": __version__})
            return
        if path == "/api/config":
            self._send_json(self.app.config.to_dict())
            return
        if path == "/api/tasks":
            self._send_json([t.to_dict() for t in self.app.scheduler.list_tasks()])
            return
        if path == "/api/history":
            entries = self.app.history.list(limit=200)
            self._send_json([e.to_dict() for e in entries])
            return
        if path == "/api/events":
            self._handle_sse()
            return
        if path.startswith("/api/info"):
            from urllib.parse import parse_qs
            qs = parse_qs(urlparse(self.path).query)
            url = qs.get("url", [""])[0]
            self._probe(url)
            return
        self._send_text("Not Found", 404)

    def do_POST(self):  # noqa
        path = urlparse(self.path).path
        if path == "/api/add":
            data = self._read_json()
            url = data.get("url", "").strip()
            if not url:
                return self._send_json({"error": "URL 不能为空"}, 400)
            urls = filter_urls([url])
            if not urls:
                return self._send_json({"error": "无效的 URL"}, 400)
            added = []
            for u in urls:
                p, k = classify_url(u)
                task = self.app.scheduler.add_task(
                    u, title=data.get("title", ""), platform=p, kind=k
                )
                added.append(task.to_dict())
            self.app.scheduler.start()
            return self._send_json({"tasks": added})
        if path == "/api/batch":
            data = self._read_json()
            text = data.get("text", "")
            urls = filter_urls([text])
            added = []
            for u in urls:
                p, k = classify_url(u)
                t = self.app.scheduler.add_task(u, platform=p, kind=k)
                added.append(t.to_dict())
            self.app.scheduler.start()
            return self._send_json({"tasks": added, "count": len(added)})
        if path == "/api/cancel":
            data = self._read_json()
            tid = data.get("task_id", "")
            self.app.scheduler.cancel(tid)
            return self._send_json({"ok": True})
        if path == "/api/pause":
            data = self._read_json()
            tid = data.get("task_id", "")
            self.app.scheduler.pause(tid)
            return self._send_json({"ok": True})
        if path == "/api/resume":
            data = self._read_json()
            tid = data.get("task_id", "")
            self.app.scheduler.resume(tid)
            return self._send_json({"ok": True})
        if path == "/api/remove":
            data = self._read_json()
            tid = data.get("task_id", "")
            self.app.scheduler.remove_task(tid)
            return self._send_json({"ok": True})
        if path == "/api/clear-finished":
            self.app.scheduler.clear_finished()
            return self._send_json({"ok": True})
        if path == "/api/clipboard/start":
            ok = self.app.start_clipboard()
            return self._send_json({"ok": ok})
        if path == "/api/clipboard/stop":
            self.app.stop_clipboard()
            return self._send_json({"ok": True})
        if path == "/api/config":
            data = self._read_json()
            self._save_config(data)
            return self._send_json({"ok": True})
        self._send_text("Not Found", 404)

    # ---- SSE ----
    def _handle_sse(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        client = _SSEClient(self.wfile)
        self.app.add_sse_client(client)
        try:
            while True:
                time.sleep(15)
                # 发送心跳
                try:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                except Exception:
                    break
        finally:
            self.app.remove_sse_client(client)

    # ---- 探测 ----
    def _probe(self, url: str) -> None:
        if not url:
            return self._send_json({"error": "URL 不能为空"}, 400)
        self.app.scheduler._ensure_registry()
        assert self.app.scheduler._registry is not None
        from ..engines.base import EngineContext
        platform_enum, kind = classify_url(url)
        engine = self.app.scheduler._registry.select(url, platform_enum, kind)
        if not engine:
            return self._send_json({"error": "无可用引擎"}, 400)
        try:
            info = engine.probe(url, EngineContext(config=self.app.config))
            self._send_json({
                "engine": engine.name,
                "platform": platform_display_name(platform_enum),
                "info": info.to_dict(),
            })
        except VidownError as e:
            self._send_json({"error": str(e)}, 400)
        except Exception as e:
            self._send_json({"error": f"探测失败: {e}"}, 500)

    # ---- 配置 ----
    def _save_config(self, data: Dict[str, Any]) -> None:
        # 简单合并：只覆盖用户提交的字段
        cfg = self.app.config
        if "general" in data:
            for k, v in data["general"].items():
                setattr(cfg.general, k, v)
        if "quality" in data:
            for k, v in data["quality"].items():
                setattr(cfg.quality, k, v)
        if "naming" in data:
            for k, v in data["naming"].items():
                setattr(cfg.naming, k, v)
        if "network" in data:
            for k, v in data["network"].items():
                if hasattr(cfg.network, k):
                    setattr(cfg.network, k, v)
        cfg.save()
        # 注意：config 路径变更需要重建 scheduler（这里仅内存生效）


def build_handler(app: AppContext):
    """返回一个绑定了 app 的 Handler 类。"""
    class _Handler(VidownHTTPHandler):
        pass
    _Handler.app = app
    return _Handler


# ----------------------------------------------------------------------
# 启动入口
# ----------------------------------------------------------------------

class VidownHTTPServer(ThreadingHTTPServer):
    """带 AppContext 的 HTTP Server。"""

    def __init__(self, host: str, port: int, app: AppContext):
        self.app = app
        handler = build_handler(app)
        super().__init__((host, port), handler)
        self.daemon_threads = True


def _find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_server(host: str = "127.0.0.1", port: int = 8765,
               open_browser: bool = True) -> None:
    config = load_config()
    app = AppContext(config)
    # 启动剪贴板
    app.start_clipboard()
    # 选择端口
    if port == 0:
        port = _find_free_port()
    server = VidownHTTPServer(host, port, app)
    url = f"http://{host}:{port}/"
    print(f"\n  Vidown Web GUI\n  ➜ {url}\n")
    logger.info(f"Vidown GUI 监听: {url}")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        app.stop_clipboard()
        server.shutdown()


if __name__ == "__main__":
    run_server()
