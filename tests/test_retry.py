"""测试：通用重试工具。"""

from __future__ import annotations

import pytest

from vidown.core.exceptions import ConnectionTimeoutError, NetworkError
from vidown.core.retry import is_transient_network_error, retry_call, retry_with_backoff


class TestRetryWithBackoff:
    def test_succeeds_first_time(self):
        counter = {"n": 0}

        @retry_with_backoff(max_retries=2)
        def fn():
            counter["n"] += 1
            return "ok"

        assert fn() == "ok"
        assert counter["n"] == 1

    def test_retries_then_succeeds(self):
        counter = {"n": 0}

        @retry_with_backoff(max_retries=2, backoff=0.01)
        def fn():
            counter["n"] += 1
            if counter["n"] < 2:
                raise RuntimeError("fail")
            return "ok"

        assert fn() == "ok"
        assert counter["n"] == 2

    def test_exhausts_retries(self):
        counter = {"n": 0}

        @retry_with_backoff(max_retries=2, backoff=0.01, exceptions=(ValueError,))
        def fn():
            counter["n"] += 1
            raise ValueError("fail")

        with pytest.raises(ValueError):
            fn()
        assert counter["n"] == 3

    def test_predicate_blocks_retry(self):
        counter = {"n": 0}

        @retry_with_backoff(
            max_retries=2,
            backoff=0.01,
            exceptions=(RuntimeError,),
            predicate=lambda e: str(e) == "retry",
        )
        def fn():
            counter["n"] += 1
            raise RuntimeError("fatal")

        with pytest.raises(RuntimeError):
            fn()
        assert counter["n"] == 1


class TestRetryCall:
    def test_functional_retry(self):
        counter = {"n": 0}

        def fn():
            counter["n"] += 1
            if counter["n"] < 2:
                raise RuntimeError("fail")
            return "done"

        assert retry_call(fn, max_retries=2, backoff=0.01) == "done"


class TestIsTransientNetworkError:
    def test_transient(self):
        assert is_transient_network_error(ConnectionTimeoutError("timeout"))

    def test_non_transient(self):
        assert not is_transient_network_error(ValueError("boom"))
        assert not is_transient_network_error(NetworkError("generic"))
