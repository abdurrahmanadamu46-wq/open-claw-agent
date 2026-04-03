from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_output_validator import get_lobster_output_validator  # noqa: E402


class LobsterOutputValidatorTestCase(unittest.TestCase):
    def test_restaurant_price_claim_is_blocked(self) -> None:
        result = asyncio.run(
            get_lobster_output_validator().validate(
                lobster_id="inkwriter",
                output="本店全网最低价，今天下单立刻锁定最低价格，保证全城最低。",
                industry_tag="\u9910\u996e\u670d\u52a1_\u4e2d\u9910\u9986",
            )
        )
        self.assertFalse(result.passed)
        self.assertTrue(any("价格承诺" in item for item in result.violations))


if __name__ == "__main__":
    unittest.main()
