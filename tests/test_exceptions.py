"""测试：异常体系与 requests 异常分类。"""

from __future__ import annotations

import requests  # type: ignore

from vidown.core.exceptions import (
    ConnectionTimeoutError,
    DNSResolveError,
    HTTPStatusError,
    NetworkError,
    ProxyError,
    ReadTimeoutError,
    classify_request_exception,
)


class TestClassifyRequestException:
    def test_connect_timeout(self):
        exc = classify_request_exception(
            requests.exceptions.ConnectTimeout("timeout"), "https://example.com"
        )
        assert isinstance(exc, ConnectionTimeoutError)

    def test_read_timeout(self):
        exc = classify_request_exception(
            requests.exceptions.ReadTimeout("timeout"), "https://example.com"
        )
        assert isinstance(exc, ReadTimeoutError)

    def test_proxy_error(self):
        exc = classify_request_exception(
            requests.exceptions.ProxyError("proxy failed"), "https://example.com"
        )
        assert isinstance(exc, ProxyError)

    def test_dns_resolve_error(self):
        exc = classify_request_exception(
            requests.exceptions.ConnectionError(
                "HTTPSConnectionPool(host='x', port=443): "
                "Max retries exceeded with url: / "
                "(Caused by NewConnectionError('<urllib.connection...>: "
                "[Errno -2] Name or service not known'))"
            ),
            "https://example.com",
        )
        assert isinstance(exc, DNSResolveError)

    def test_http_error(self):
        resp = requests.Response()
        resp.status_code = 500
        err = requests.exceptions.HTTPError("500 Server Error", response=resp)
        exc = classify_request_exception(err, "https://example.com")
        assert isinstance(exc, HTTPStatusError)
        assert exc.status_code == 500

    def test_generic_connection_error(self):
        exc = classify_request_exception(
            requests.exceptions.ConnectionError("refused"), "https://example.com"
        )
        assert isinstance(exc, NetworkError)
        assert not isinstance(exc, DNSResolveError)
