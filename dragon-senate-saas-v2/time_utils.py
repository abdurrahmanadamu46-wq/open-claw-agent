from __future__ import annotations

import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@contextmanager
def mock_timezone(tz_name: str) -> Iterator[None]:
    """
    Temporarily override process timezone for tests.

    - Works on Linux/macOS via time.tzset().
    - On Windows, os.environ['TZ'] is still set/restored; tzset may be unavailable.
    - This context manager does not mutate datetime objects already created.
    """
    previous_tz = os.environ.get("TZ")
    os.environ["TZ"] = tz_name
    if hasattr(time, "tzset"):
        time.tzset()
    try:
        yield
    finally:
        if previous_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous_tz
        if hasattr(time, "tzset"):
            time.tzset()

