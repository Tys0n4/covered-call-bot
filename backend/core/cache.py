# cache.py
"""
Tiny in-memory cache with a time limit per entry, so repeated scans and price
checks within a minute or so reuse what Yahoo / Alpha Vantage already sent.
Only successful results (anything but None) are cached. A failure can be
remembered briefly (retry_after) so a rate-limited source isn't asked again
on every request.

One fetch per key at a time: when two requests want the same thing at once
(Home asks for prices and "Coming up" together), the second waits for the
first one's answer instead of asking Yahoo again. Expired entries are dropped
now and then, so the cache doesn't keep growing.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, TypeVar

T = TypeVar("T")

_store: dict[tuple, tuple[float, object]] = {}
_fetching: dict[tuple, threading.Lock] = {}   # one lock per key being fetched right now
_lock = threading.Lock()

# How long each kind of data stays fresh (seconds)
PRICE_TTL = 30
CHAIN_TTL = 60
EXPIRIES_TTL = 600
EVENTS_TTL = 6 * 3600
CLOSE_TTL = 12 * 3600
HISTORY_TTL = 3600
RETRY_AFTER = 300   # after Yahoo fails, wait this long before asking again
SWEEP_EVERY = 300   # drop expired entries at most this often

_FAILED = object()
_MISS = object()
_last_sweep = 0.0


def _lookup(key: tuple, now: float) -> object:
    """The cached value (None for a remembered failure), or _MISS. Call with _lock held."""
    hit = _store.get(key)
    if hit and hit[0] > now:
        return None if hit[1] is _FAILED else hit[1]
    return _MISS


def _sweep(now: float) -> None:
    """Drop expired entries. Call with _lock held."""
    global _last_sweep
    if now - _last_sweep < SWEEP_EVERY:
        return
    _last_sweep = now
    for key in [k for k, (expires, _) in _store.items() if expires <= now]:
        del _store[key]


def cached(key: tuple, ttl: float, fetch: Callable[[], T], retry_after: float = 0) -> T | None:
    """fetch()'s result, reused for ttl seconds. None (a failure) is reused for retry_after seconds."""
    with _lock:
        hit = _lookup(key, time.monotonic())
        if hit is not _MISS:
            return hit  # type: ignore[return-value]
        key_lock = _fetching.setdefault(key, threading.Lock())

    with key_lock:
        # Someone else may have fetched it while this request waited
        with _lock:
            hit = _lookup(key, time.monotonic())
        if hit is not _MISS:
            return hit  # type: ignore[return-value]
        try:
            value = fetch()
            if value is not None or retry_after:
                now = time.monotonic()
                with _lock:
                    _store[key] = (now + (ttl if value is not None else retry_after), _FAILED if value is None else value)
                    _sweep(now)
        finally:
            with _lock:
                _fetching.pop(key, None)
        return value


def clear() -> None:
    global _last_sweep
    with _lock:
        _store.clear()
        _last_sweep = 0.0
