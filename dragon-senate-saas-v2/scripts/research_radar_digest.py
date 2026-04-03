#!/usr/bin/env python
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from typing import Any


def _render_digest(tenant_id: str, rows: list[dict[str, Any]]) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"Lobster Research Brief | tenant={tenant_id}",
        f"Time: {now}",
        "",
    ]
    if not rows:
        lines.append("No executable research signals today.")
        return "\n".join(lines)
    for idx, row in enumerate(rows[:20], start=1):
        title = str(row.get("title") or "(untitled)").strip()[:120]
        source = str(row.get("source") or "unknown").strip()
        score = float(row.get("score") or 0.0)
        tags = row.get("tags") or []
        if not isinstance(tags, list):
            tags = []
        tags_text = ",".join(str(x) for x in tags[:4]) if tags else "-"
        url = str(row.get("url") or "").strip()
        lines.append(f"{idx}. [{source}] {title}")
        lines.append(f"   score={score:.3f} tags={tags_text}")
        if url:
            lines.append(f"   {url}")
    return "\n".join(lines)


async def _send_feishu(chat_id: str, text: str) -> dict[str, Any]:
    from feishu_channel import feishu_channel  # pylint: disable=import-outside-toplevel

    feishu_channel.reload_from_env()
    if not feishu_channel.enabled:
        return {"ok": False, "reason": "feishu_disabled"}
    return await feishu_channel.reply(chat_id=chat_id, text=text)


def _load_rows(tenant_id: str, limit: int, only_executable: bool) -> list[dict[str, Any]]:
    from research_radar_store import list_signals  # pylint: disable=import-outside-toplevel

    return list_signals(
        tenant_id=tenant_id,
        source=None,
        rank_type=None,
        limit=max(1, min(limit, 200)),
        only_executable=only_executable,
    )


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    parser = argparse.ArgumentParser(description="Send Research Radar digest to Feishu")
    parser.add_argument("--tenant_id", required=True, help="tenant id")
    parser.add_argument("--chat_id", default="", help="Feishu chat_id")
    parser.add_argument("--limit", type=int, default=20, help="max items")
    parser.add_argument("--all", action="store_true", help="include non-executable items")
    parser.add_argument("--dry-run", action="store_true", help="print digest only")
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    rows = _load_rows(args.tenant_id, args.limit, only_executable=not bool(args.all))
    digest = _render_digest(args.tenant_id, rows)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "tenant_id": args.tenant_id,
                    "count": len(rows),
                    "message_preview": digest[:260],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        print("\n-----\n")
        print(digest)
        return 0

    chat_id = args.chat_id.strip() or os.getenv("FEISHU_DIGEST_CHAT_ID", "").strip()
    if not chat_id:
        print("[RESEARCH_DIGEST_FAIL] missing chat_id and FEISHU_DIGEST_CHAT_ID", file=sys.stderr)
        return 1

    result = asyncio.run(_send_feishu(chat_id, digest))
    print(
        json.dumps(
            {
                "ok": bool(result.get("ok")),
                "tenant_id": args.tenant_id,
                "count": len(rows),
                "chat_id": chat_id,
                "result": result,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if bool(result.get("ok")) else 2


if __name__ == "__main__":
    raise SystemExit(main())
