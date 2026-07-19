"""测试：统一网络请求工具。"""

from __future__ import annotations

import pytest
import requests  # type: ignore
import responses

from vidown.core.config import Config
from vidown.core.exceptions import HTTPStatusError, NetworkError
from vidown.core.network import get_proxies, http_get, http_get_text, http_head, make_session


class TestGetProxies:
    def test_returns_none_when_empty(self):
        cfg = Config()
        cfg.network.proxy = None
        assert get_proxies(cfg) is None

    def test_returns_both_protocols(self):
        cfg = Config()
        cfg.network.proxy = "http://127.0.0.1:7890"
        assert get_proxies(cfg) == {
            "http": "http://127.0.0.1:7890",
            "https": "http://127.0.0.1:7890",
        }


class TestMakeSession:
    def test_has_user_agent(self):
        cfg = Config()
        sess = make_session(cfg)
        assert cfg.network.user_agent in sess.headers.get("User-Agent", "")


class TestHttpGet:
    @responses.activate
    def test_success_returns_response(self):
        responses.add(responses.GET, "https://example.com/file", body="ok", status=200)
        resp = http_get("https://example.com/file", Config())
        assert resp.text == "ok"

    @responses.activate
    def test_4xx_raises_http_status_error(self):
        responses.add(responses.GET, "https://example.com/file", body="not found", status=404)
        with pytest.raises(HTTPStatusError) as exc_info:
            http_get("https://example.com/file", Config())
        assert exc_info.value.status_code == 404

    @responses.activate
    def test_connection_error_raises_network_error(self):
        responses.add(
            responses.GET,
            "https://example.com/file",
            body=requests.exceptions.ConnectionError("refused"),
        )
        with pytest.raises(NetworkError):
            http_get("https://example.com/file", Config())


class TestHttpHead:
    @responses.activate
    def test_success_reads_headers(self):
        responses.add(
            responses.HEAD,
            "https://example.com/file",
            headers={"Content-Length": "1234"},
            status=200,
        )
        resp = http_head("https://example.com/file", Config())
        assert resp.headers["Content-Length"] == "1234"


class TestHttpGetText:
    @responses.activate
    def test_returns_text(self):
        responses.add(responses.GET, "https://example.com/m3u8", body="#EXTM3U\n", status=200)
        text = http_get_text("https://example.com/m3u8", Config())
        assert text == "#EXTM3U\n"
