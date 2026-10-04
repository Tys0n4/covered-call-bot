# cache.py
"""
Tiny in-memory cache with a time limit per entry, so repeated scans and price
checks within a minute or so reuse what Yahoo / Alpha Vantage already sent.
Only successful results (anything but None) are cached. A failure can be
remembered briefly (retry_after) so a rate-limited source isn't asked again
on every request.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, TypeVar

T = TypeVar("T")

_store: dict[tuple, tuple[float, object]] = {}
_lock = threading.Lock()

# How long each kind of data stays fresh (seconds)
PRICE_TTL = 30
CHAIN_TTL = 60
EXPIRIES_TTL = 600
EVENTS_TTL = 6 * 3600
CLOSE_TTL = 12 * 3600
HISTORY_TTL = 3600
RETRY_AFTER = 300   # after Yahoo fails, wait this long before asking again

_FAILED = object()


def cached(key: tuple, ttl: float, fetch: Callable[[], T], retry_after: float = 0) -> T | None:
    """fetch()'s result, reused for ttl seconds. None (a failure) is reused for retry_after seconds."""
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            return None if hit[1] is _FAILED else hit[1]  # type: ignore[return-value]
    value = fetch()
    if value is not None or retry_after:
        with _lock:
            _store[key] = (now + (ttl if value is not None else retry_after), _FAILED if value is None else value)
    return value


def clear() -> None:
    with _lock:
        _store.clear()
