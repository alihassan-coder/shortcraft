"""In-memory token bucket per key (one API process). Swap for Redis when running several."""

import math
import time
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(slots=True)
class _Bucket:
    tokens: float
    updated: float


class TokenBucket:
    def __init__(
        self,
        *,
        burst: int,
        per_minute: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        self.burst = burst
        self.rate = per_minute / 60.0  # tokens per second
        self.clock = clock
        self.max_keys = max_keys
        self._buckets: dict[str, _Bucket] = {}

    def take(self, key: str) -> float:
        """Spend one token. Returns 0 when allowed, else seconds until one is available."""
        now = self.clock()
        bucket = self._buckets.get(key)
        if bucket is None:
            if len(self._buckets) >= self.max_keys:
                self._buckets.clear()  # crude, bounded memory
            bucket = self._buckets[key] = _Bucket(float(self.burst), now)
        bucket.tokens = min(self.burst, bucket.tokens + (now - bucket.updated) * self.rate)
        bucket.updated = now
        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return 0.0
        return (1 - bucket.tokens) / self.rate

    def retry_after(self, wait: float) -> int:
        return max(1, math.ceil(wait))
