"""通用重试工具。

提供装饰器与函数式重试封装，常用于网络请求、外部命令调用等易抖动操作。
"""

from __future__ import annotations

import functools
import time
from typing import Any, Callable, Optional, Type, Tuple

from .logger import get_logger

logger = get_logger("retry")


def retry_with_backoff(
    max_retries: int = 3,
    backoff: float = 1.5,
    exceptions: Tuple[Type[BaseException], ...] = (Exception,),
    predicate: Optional[Callable[[BaseException], bool]] = None,
    on_retry: Optional[Callable[[BaseException, int], None]] = None,
) -> Callable:
    """装饰器：按指数退避重试目标函数。

    Args:
        max_retries: 最大重试次数（不含首次调用）。
        backoff: 退避基数，第 n 次等待时间为 backoff * (2 ** (n - 1))。
        exceptions: 触发重试的异常类型元组。
        predicate: 可选的额外判断函数，接收异常，返回 True 才重试。
        on_retry: 每次重试前的回调，接收 (异常, 重试次数)。
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exc: Optional[BaseException] = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exc = e
                    if predicate and not predicate(e):
                        raise
                    if attempt >= max_retries:
                        raise
                    wait = backoff * (2**attempt)
                    if on_retry:
                        try:
                            on_retry(e, attempt + 1)
                        except Exception:
                            pass
                    logger.debug(
                        f"{func.__name__} 第 {attempt + 1} 次失败，{wait:.1f}s 后重试: {e}"
                    )
                    time.sleep(wait)
            # 理论上不会到达这里
            if last_exc:
                raise last_exc
            return None

        return wrapper

    return decorator


def retry_call(
    func: Callable,
    *args: Any,
    max_retries: int = 3,
    backoff: float = 1.5,
    exceptions: Tuple[Type[BaseException], ...] = (Exception,),
    **kwargs: Any,
) -> Any:
    """函数式重试封装。"""
    decorated = retry_with_backoff(
        max_retries=max_retries,
        backoff=backoff,
        exceptions=exceptions,
    )(func)
    return decorated(*args, **kwargs)


def is_transient_network_error(exc: BaseException) -> bool:
    """判断异常是否为值得重试的瞬时网络错误。"""
    from .exceptions import NetworkError

    if not isinstance(exc, NetworkError):
        return False
    name = type(exc).__name__
    # HTTP 5xx、连接/读取超时、DNS 失败通常可重试
    return name in {
        "ConnectionTimeoutError",
        "ReadTimeoutError",
        "DNSResolveError",
        "HTTPStatusError",
    }
