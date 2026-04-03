#!/usr/bin/env python
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


async def _run() -> None:
    load_dotenv(ROOT_DIR / ".env")
    temp_dir = Path(tempfile.mkdtemp(prefix="mock_tz_"))
    billing_db = temp_dir / "billing.sqlite"
    os.environ["BILLING_DATABASE_URL"] = f"sqlite+aiosqlite:///{billing_db.as_posix()}"
    os.environ["AUTH_DATABASE_URL"] = f"sqlite+aiosqlite:///{(temp_dir / 'auth.sqlite').as_posix()}"
    os.environ["DATABASE_URL"] = ""

    # Import after env setup so module-level DB URL picks temp sqlite correctly.
    from sqlalchemy import select

    from billing import BillingSessionMaker
    from billing import BillingSubscription
    from billing import ensure_subscription
    from billing import init_billing_schema
    from billing import usage_summary
    from time_utils import mock_timezone

    await init_billing_schema()

    user_id = "tz_user"
    tenant_id = "tenant_tz"
    await ensure_subscription(user_id, tenant_id)

    # Force a naive datetime into billing row to simulate sqlite timezone loss.
    async with BillingSessionMaker() as session:
        row = (
            await session.execute(
                select(BillingSubscription)
                .where(BillingSubscription.user_id == user_id)
                .where(BillingSubscription.tenant_id == tenant_id)
                .limit(1)
            )
        ).scalar_one()
        row.current_period_end = datetime.now() - timedelta(days=1)  # naive on purpose
        await session.commit()

    # Should not raise "can't compare offset-naive and offset-aware datetimes".
    await ensure_subscription(user_id, tenant_id)

    with mock_timezone("Asia/Shanghai"):
        summary = await usage_summary(
            user_id=user_id,
            tenant_id=tenant_id,
            from_ts=datetime.now() - timedelta(days=2),  # naive on purpose
            to_ts=datetime.now(),  # naive on purpose
        )
        _must(summary.get("user_id") == user_id, "usage_summary returned unexpected user_id")

    print("[MOCK_TIMEZONE_OK] naive/aware datetime comparison guard is stable")


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except Exception as exc:  # noqa: BLE001
        print(f"[MOCK_TIMEZONE_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
