# parallel.py
"""
Fetch market data for several stocks side by side. Each lookup mostly waits on
the network (Cboe, Yahoo), so threads let the wait be about as long as the
slowest stock instead of the sum of all of them. The cache (core/cache.py)
makes sure two threads never fetch the same thing.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Iterable, TypeVar

T = TypeVar("T")
R = TypeVar("R")

MAX_WORKERS = 8


def parallel_map(fn: Callable[[T], R], items: Iterable[T], max_workers: int = MAX_WORKERS) -> list[R]:
    """[fn(item) for item in items], run side by side, in the same order. Re-raises the first error."""
    items = list(items)
    if len(items) <= 1:
        return [fn(item) for item in items]
    with ThreadPoolExecutor(max_workers=min(max_workers, len(items))) as pool:
        return list(pool.map(fn, items))
