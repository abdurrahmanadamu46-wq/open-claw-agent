#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def main() -> int:
    db_path = ROOT / "_test_industry_starter_kit.sqlite"
    if db_path.exists():
        db_path.unlink()
    os.environ["INDUSTRY_KB_DB_PATH"] = str(db_path)

    from industry_starter_kit import generate_starter_tasks  # pylint: disable=import-outside-toplevel
    from industry_starter_kit import list_starter_tasks  # pylint: disable=import-outside-toplevel

    generated = generate_starter_tasks(
        tenant_id="tenant_demo",
        industry_tag="food_chinese_restaurant",
        actor_user_id="user_demo",
        force=True,
        max_tasks=12,
    )
    _must(generated.get("accepted_count", 0) >= 2, f"accepted starter tasks too low: {generated}")
    _must("explorer_summary" in generated, f"explorer summary missing: {generated}")

    accepted = list_starter_tasks(
        tenant_id="tenant_demo",
        industry_tag="food_chinese_restaurant",
        status="accepted",
        limit=20,
    )
    _must(len(accepted) >= 2, f"starter task list empty: {accepted}")
    _must(all("task" in row and "verifier" in row for row in accepted), f"starter task payload invalid: {accepted}")

    print(json.dumps({"ok": True, "generated": generated, "accepted_preview": accepted[:3]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_INDUSTRY_STARTER_KIT_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
