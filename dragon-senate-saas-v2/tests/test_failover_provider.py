"""Tests for failover_provider."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from failover_provider import FailoverProvider  # noqa: E402
from failover_provider import classify_error  # noqa: E402


class ClassifyErrorTestCase(unittest.TestCase):
    def test_classifies_401_as_non_retryable(self) -> None:
        self.assertEqual(classify_error(Exception("401 Unauthorized invalid_api_key")), "non_retryable")

    def test_classifies_429_as_retryable(self) -> None:
        self.assertEqual(classify_error(Exception("429 Too Many Requests rate limit exceeded")), "retryable")


class FailoverProviderTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_first_provider_success(self) -> None:
        provider = MagicMock()
        provider.provider_name = "good"
        provider.ainvoke = AsyncMock(return_value="ok")
        wrapper = FailoverProvider([provider], max_retries_per_provider=0)
        result = await wrapper.ainvoke([{"role": "user", "content": "hi"}])
        self.assertEqual(result, "ok")

    async def test_fails_over_to_second_provider(self) -> None:
        bad = MagicMock()
        bad.provider_name = "bad"
        bad.ainvoke = AsyncMock(side_effect=Exception("401 Unauthorized"))

        good = MagicMock()
        good.provider_name = "good"
        good.ainvoke = AsyncMock(return_value="ok-from-good")

        wrapper = FailoverProvider([bad, good], max_retries_per_provider=0)
        result = await wrapper.ainvoke([{"role": "user", "content": "hi"}])
        self.assertEqual(result, "ok-from-good")
        report = {item["provider_name"]: item for item in wrapper.health_report()}
        self.assertEqual(report["good"]["success_count"], 1)
        self.assertEqual(report["bad"]["failure_count"], 1)

    async def test_all_fail_raises_runtime_error(self) -> None:
        bad = MagicMock()
        bad.provider_name = "bad"
        bad.ainvoke = AsyncMock(side_effect=Exception("503 Service Unavailable"))
        wrapper = FailoverProvider([bad], max_retries_per_provider=0)
        with self.assertRaises(RuntimeError):
            await wrapper.ainvoke([{"role": "user", "content": "hi"}])


if __name__ == "__main__":
    unittest.main()
