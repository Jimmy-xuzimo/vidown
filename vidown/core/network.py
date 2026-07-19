"""统一的网络请求工具。

封装 requests Session、代理配置、User-Agent 以及常见的 GET/HEAD 请求模式，
并将 requests 异常转换为项目内部异常体系。
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests  # type: ignore

from .config import Config
from .exceptions import HTTPStatusError, classify_request_exception


def get_proxies(config: Config) -> Optional[Dict[str, str]]:
    """根据配置返回代理字典。"""
    if config.network.proxy:
        return {"http": config.network.proxy, "https": config.network.proxy}
    return None


def make_session(config: Config) -> requests.Session:
    """创建已配置 UA、代理的 requests Session。"""
    sess = requests.Session()
    sess.headers.update({"User-Agent": config.network.user_agent})
    return sess


def http_get(
    url: str,
    config: Config,
    *,
    stream: bool = False,
    timeout: Optional[tuple] = None,
    headers: Optional[Dict[str, str]] = None,
    **kwargs: Any,
) -> requests.Response:
    """统一 GET 请求，自动处理代理、UA 与异常转换。"""
    proxies = get_proxies(config)
    merged_headers = {"User-Agent": config.network.user_agent}
    if headers:
        merged_headers.update(headers)
    if timeout is None:
        timeout = (config.network.connect_timeout, config.network.read_timeout)

    try:
        resp = requests.get(
            url,
            stream=stream,
            timeout=timeout,
            headers=merged_headers,
            proxies=proxies,
            **kwargs,
        )
    except requests.exceptions.RequestException as e:
        raise classify_request_exception(e, url) from e

    if resp.status_code >= 400:
        raise HTTPStatusError(
            f"HTTP {resp.status_code}: {url}",
            status_code=resp.status_code,
            url=url,
        )
    return resp


def http_head(
    url: str,
    config: Config,
    *,
    allow_redirects: bool = True,
    timeout: Optional[int] = None,
    headers: Optional[Dict[str, str]] = None,
    **kwargs: Any,
) -> requests.Response:
    """统一 HEAD 请求，自动处理代理、UA 与异常转换。"""
    proxies = get_proxies(config)
    merged_headers = {"User-Agent": config.network.user_agent}
    if headers:
        merged_headers.update(headers)
    if timeout is None:
        timeout = config.network.connect_timeout

    try:
        resp = requests.head(
            url,
            allow_redirects=allow_redirects,
            timeout=timeout,
            headers=merged_headers,
            proxies=proxies,
            **kwargs,
        )
    except requests.exceptions.RequestException as e:
        raise classify_request_exception(e, url) from e

    if resp.status_code >= 400:
        raise HTTPStatusError(
            f"HTTP {resp.status_code}: {url}",
            status_code=resp.status_code,
            url=url,
        )
    return resp


def http_get_text(
    url: str,
    config: Config,
    *,
    timeout: Optional[tuple] = None,
    headers: Optional[Dict[str, str]] = None,
    **kwargs: Any,
) -> str:
    """GET 并返回文本内容。"""
    resp = http_get(url, config, timeout=timeout, headers=headers, **kwargs)
    return resp.text
