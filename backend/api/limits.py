# api/limits.py
"""
How often one account can ask for something expensive, in a sliding window.
Scans download option chains from Cboe through the server's one address; a
script scanning in a loop could get that address blocked for everyone. Kept in
memory: the server only sleeps after a quiet spell, and then nobody is scanning.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque

from fastapi import HTTPException


class Limit:
    def __init__(self, count: int, seconds: int, message: str):
        self.count, self.seconds, self.message = count, seconds, message
        self._hits: dict[object, deque[float]] = {}
        self._lock = threading.Lock()

    def take(self, key: object, now: float | None = None) -> None:
        """Count one use for key, or raise 429 when it has used up the window."""
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.seconds:
                hits.popleft()
            if len(hits) >= self.count:
                wait = math.ceil(self.seconds - (now - hits[0]))
                minutes = max(1, math.ceil(wait / 60))
                raise HTTPException(
                    status_code=429,
                    detail=self.message.format(minutes=f"{minutes} minute{'' if minutes == 1 else 's'}"),
                    headers={"Retry-After": str(wait)},
                )
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


SCANS = Limit(40, 10 * 60, "That's a lot of scans in a few minutes. Try again in {minutes}.")
SCAN_ALLS = Limit(6, 10 * 60, "Every stock was just scanned several times. Try again in {minutes}.")


def reset_all() -> None:
    SCANS.reset()
    SCAN_ALLS.reset()
