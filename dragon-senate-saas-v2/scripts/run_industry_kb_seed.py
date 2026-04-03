#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests


def _safe_print(text: str = "") -> None:
    """
    Windows PowerShell can run in GBK codepage and crash on emoji/Unicode.
    Write with replacement to avoid hard failure after successful API run.
    """
    data = (text + "\n").encode("utf-8", errors="replace")
    try:
        sys.stdout.buffer.write(data)
    except Exception:  # noqa: BLE001
        # Final fallback to default print
        print(text)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Manual operator script: industry tag -> account dissect -> formula/playbook/template "
            "extract -> ingest to industry KB -> optional Feishu report push."
        )
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="FastAPI base URL")
    parser.add_argument("--username", required=True, help="Login username")
    parser.add_argument("--password", required=True, help="Login password")
    parser.add_argument("--industry-tag", required=True, help="Industry tag, e.g. beauty/hotel/tcm")
    parser.add_argument(
        "--competitor",
        action="append",
        dest="competitors",
        required=True,
        help="Competitor account URL/handle; repeat this argument for multiple accounts",
    )
    parser.add_argument(
        "--feishu-chat-id",
        default=None,
        help="Optional Feishu chat id; when set, report_to_feishu defaults to true",
    )
    parser.add_argument(
        "--no-feishu",
        action="store_true",
        help="Disable Feishu push even if chat id is provided",
    )
    parser.add_argument(
        "--tenant-id",
        default=None,
        help="Optional tenant override (admin only)",
    )
    parser.add_argument(
        "--user-id",
        default=None,
        help="Optional user override (admin only)",
    )
    parser.add_argument(
        "--save-report",
        default="",
        help="Optional markdown output path for report, e.g. ./industry_report.md",
    )
    return parser


def _login(base_url: str, username: str, password: str) -> str:
    resp = requests.post(
        f"{base_url.rstrip('/')}/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("login succeeded but access_token is missing")
    return str(token)


def _run_seed(
    base_url: str,
    token: str,
    *,
    industry_tag: str,
    competitors: list[str],
    report_to_feishu: bool,
    feishu_chat_id: str | None,
    tenant_id: str | None,
    user_id: str | None,
) -> dict:
    req = {
        "industry_tag": industry_tag,
        "competitor_accounts": competitors,
        "report_to_feishu": report_to_feishu,
    }
    if feishu_chat_id:
        req["feishu_chat_id"] = feishu_chat_id
    if tenant_id:
        req["tenant_id"] = tenant_id
    if user_id:
        req["user_id"] = user_id

    resp = requests.post(
        f"{base_url.rstrip('/')}/industry-kb/dissect-and-ingest",
        headers={"Authorization": f"Bearer {token}"},
        json=req,
        timeout=180,
    )
    resp.raise_for_status()
    return dict(resp.json() or {})


def main() -> int:
    args = _build_parser().parse_args()
    base_url = args.base_url.rstrip("/")
    report_to_feishu = bool(not args.no_feishu)
    if not args.feishu_chat_id:
        # No target chat means disable push by default.
        report_to_feishu = False

    try:
        token = _login(base_url, args.username, args.password)
        row = _run_seed(
            base_url,
            token,
            industry_tag=args.industry_tag.strip(),
            competitors=[str(x).strip() for x in args.competitors if str(x).strip()],
            report_to_feishu=report_to_feishu,
            feishu_chat_id=args.feishu_chat_id,
            tenant_id=args.tenant_id,
            user_id=args.user_id,
        )
    except requests.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.text
        except Exception:  # noqa: BLE001
            detail = ""
        print("ERROR: request failed", file=sys.stderr)
        if detail:
            print(detail, file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    summary = {
        "ok": row.get("ok"),
        "trace_id": row.get("trace_id"),
        "industry_tag": row.get("industry_tag"),
        "formulas_count": row.get("formulas_count"),
        "startup_playbooks_count": row.get("startup_playbooks_count"),
        "copy_templates_count": row.get("copy_templates_count"),
        "kb_ingested_count": row.get("kb_ingested_count"),
        "kb_rejected_count": row.get("kb_rejected_count"),
        "kb_duplicate_count": row.get("kb_duplicate_count"),
        "feishu_push_status": row.get("feishu_push_status"),
    }
    _safe_print(json.dumps(summary, ensure_ascii=False, indent=2))

    report = str(row.get("report_markdown") or "").strip()
    if args.save_report:
        target = Path(args.save_report).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(report + "\n", encoding="utf-8")
        _safe_print(f"\nSaved report: {target}")
    elif report:
        _safe_print("\n--- report_markdown ---")
        _safe_print(report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
