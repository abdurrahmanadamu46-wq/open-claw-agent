#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from industry_kb_sdk import IndustryKbApiClient
from industry_kb_sdk import validate_profile_schema

DEFAULT_PROMPT_PATH = str(
    (Path(__file__).resolve().parents[1] / "prompts" / "industry_kb_consumer_prompt.txt")
)


def _safe_print(text: str = "") -> None:
    data = (text + "\n").encode("utf-8", errors="replace")
    try:
        sys.stdout.buffer.write(data)
    except Exception:
        print(text)


def _load_json(path: str) -> dict[str, Any]:
    target = Path(path).expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"base profile file not found: {target}")
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = target.read_text(encoding="gbk", errors="ignore")
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("base profile json must be object")
    return payload


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_resume_state(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    done = payload.get("done_tags") if isinstance(payload, dict) else None
    if not isinstance(done, list):
        return set()
    return {str(x).strip() for x in done if str(x).strip()}


def _write_resume_state(path: Path, done_tags: set[str]) -> None:
    _save_json(path, {"done_tags": sorted(done_tags)})


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Batch industry profile generator: serial local API calls + schema validation + retry + resume."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--tenant-id", default=None)
    parser.add_argument("--base-profile-json", required=True, help="Path to mother profile JSON")
    parser.add_argument(
        "--system-prompt-path",
        default=DEFAULT_PROMPT_PATH,
        help="Prompt template file path (defaults to consumer-focused strict prompt).",
    )
    parser.add_argument("--output-dir", default="./tmp/industry_kb_generated")
    parser.add_argument("--include-tag", action="append", dest="include_tags", default=[])
    parser.add_argument("--limit", type=int, default=0, help="0 means all selected")
    parser.add_argument("--max-retries", type=int, default=3, help="Server-side generation retry budget")
    parser.add_argument("--request-retries", type=int, default=3, help="Client-side request/schema retry")
    parser.add_argument("--retry-delay-sec", type=float, default=1.0)
    parser.add_argument("--sleep-sec", type=float, default=0.2)
    parser.add_argument("--no-seed", action="store_true", help="Generate JSON only, do not ingest into KB")
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--resume", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    base_url = args.base_url.rstrip("/")
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    state_file = output_dir / "_state.json"

    try:
        base_profile = _load_json(args.base_profile_json)
        client = IndustryKbApiClient(base_url=base_url, timeout_sec=240)
        client.login(args.username, args.password)
        rows = [
            {"tag": row.tag, "name": row.name, "category_name": row.category_name}
            for row in client.taxonomy_rows()
        ]
    except Exception as exc:
        print(f"ERROR: bootstrap failed: {exc}", file=sys.stderr)
        return 1

    include = {str(x).strip() for x in (args.include_tags or []) if str(x).strip()}
    if include:
        rows = [row for row in rows if str(row.get("tag", "")) in include]
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]
    if not rows:
        print("ERROR: no subindustries selected", file=sys.stderr)
        return 2

    done_tags = _load_resume_state(state_file) if args.resume else set()

    ok_count = 0
    skipped_count = 0
    failed: list[dict[str, Any]] = []
    started = time.time()
    seed_to_kb = not args.no_seed

    for idx, row in enumerate(rows, start=1):
        tag = str(row.get("tag", "")).strip()
        # Use stable ASCII tag as generation name to avoid mojibake/encoding drift
        # from taxonomy labels causing "industry_name invalid" rejects.
        name = tag
        category = str(row.get("category_name", "")).strip()

        if args.resume and tag in done_tags:
            skipped_count += 1
            _safe_print(f"[{idx}/{len(rows)}] skip (resume) -> {tag} ({name})")
            continue

        _safe_print(f"[{idx}/{len(rows)}] generate -> {tag} ({name})")
        success = False
        last_error = ""

        for attempt in range(1, max(1, int(args.request_retries)) + 1):
            try:
                generated = client.generate_profile(
                    tenant_id=args.tenant_id,
                    industry_tag=tag,
                    industry_name=name,
                    base_profile=base_profile,
                    system_prompt_path=args.system_prompt_path,
                    seed_to_kb=seed_to_kb,
                    max_retries=args.max_retries,
                )

                profile = dict(generated.get("generated_profile") or {})
                schema_errors = validate_profile_schema(profile)
                if schema_errors:
                    raise RuntimeError("schema_validation_failed: " + "; ".join(schema_errors))

                out_file = output_dir / f"{tag}.json"
                _save_json(
                    out_file,
                    {
                        "industry_tag": tag,
                        "industry_name": name,
                        "category_name": category,
                        "tenant_id": generated.get("tenant_id"),
                        "attempt": generated.get("attempt"),
                        "trace_id": generated.get("trace_id"),
                        "fallback_used": bool(generated.get("fallback_used", False)),
                        "profile": profile,
                        "ingest_result": generated.get("ingest_result"),
                    },
                )

                ok_count += 1
                done_tags.add(tag)
                if args.resume:
                    _write_resume_state(state_file, done_tags)
                success = True
                break
            except Exception as exc:
                last_error = str(exc)
                _safe_print(f"  -> retry {attempt}/{args.request_retries} failed: {last_error}")
                if attempt < args.request_retries and args.retry_delay_sec > 0:
                    time.sleep(float(args.retry_delay_sec))

        if not success:
            failed.append({"industry_tag": tag, "industry_name": name, "error": last_error})
            if args.fail_fast:
                break

        if args.sleep_sec > 0:
            time.sleep(float(args.sleep_sec))

    elapsed = round(time.time() - started, 2)
    summary = {
        "ok": len(failed) == 0,
        "total": len(rows),
        "success": ok_count,
        "skipped": skipped_count,
        "failed": len(failed),
        "seed_to_kb": seed_to_kb,
        "elapsed_sec": elapsed,
        "output_dir": str(output_dir),
        "failed_items": failed,
    }

    _save_json(output_dir / "_summary.json", summary)
    if args.resume:
        _write_resume_state(state_file, done_tags)

    _safe_print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if len(failed) == 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())
