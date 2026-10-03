# cache.py
"""
Tiny in-memory cache with a time limit per entry, so repeated scans and price
checks within a minute or so reuse what Yahoo / Alpha Vantage already sent.
Only successful results (anything but None) are cached.
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


def cached(key: tuple, ttl: float, fetch: Callable[[], T]) -> T:
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            return hit[1]  # type: ignore[return-value]
    value = fetch()
    if value is not None:
        with _lock:
            _store[key] = (now + ttl, value)
    return value


def clear() -> None:
    with _lock:
        _store.clear()
