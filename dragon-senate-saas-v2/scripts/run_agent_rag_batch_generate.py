#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from agent_rag_sdk import AgentRagApiClient
from agent_rag_sdk import validate_pack_schema


def _safe_print(text: str = "") -> None:
    data = (text + "\n").encode("utf-8", errors="replace")
    try:
        sys.stdout.buffer.write(data)
    except Exception:
        print(text)


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_state(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    done = payload.get("done") if isinstance(payload, dict) else None
    if not isinstance(done, list):
        return set()
    return {str(x).strip() for x in done if str(x).strip()}


def _write_state(path: Path, done: set[str]) -> None:
    _save_json(path, {"done": sorted(done)})


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="9x10 Agent RAG pack batch generator (API one-by-one, with retry/schema validation/resume)."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--tenant-id", default=None)
    parser.add_argument("--profile", default="feedback")
    parser.add_argument("--model-name", default=None)
    parser.add_argument("--system-prompt-path", default=None)
    parser.add_argument("--include-agent", action="append", default=[])
    parser.add_argument("--include-pack", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output-dir", default="./tmp/agent_rag_generated")
    parser.add_argument("--request-retries", type=int, default=3)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--retry-delay-sec", type=float, default=1.0)
    parser.add_argument("--sleep-sec", type=float, default=0.15)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--fail-fast", action="store_true")
    return parser


def _target_key(profile: str, agent_id: str, pack_id: str) -> str:
    return f"{profile}:{agent_id}:{pack_id}"


def main() -> int:
    args = _parser().parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve() / str(args.profile).strip()
    output_dir.mkdir(parents=True, exist_ok=True)
    state_file = output_dir / "_state.json"

    try:
        client = AgentRagApiClient(base_url=args.base_url, timeout_sec=360)
        client.login(args.username, args.password)
        targets = client.catalog_targets(profile=args.profile)
    except Exception as exc:
        print(f"ERROR: bootstrap failed: {exc}", file=sys.stderr)
        return 1

    include_agents = {str(x).strip().lower() for x in args.include_agent if str(x).strip()}
    include_packs = {str(x).strip().lower() for x in args.include_pack if str(x).strip()}
    if include_agents:
        targets = [x for x in targets if x.agent_id.lower() in include_agents]
    if include_packs:
        targets = [x for x in targets if x.knowledge_pack_id.lower() in include_packs]
    if args.limit and args.limit > 0:
        targets = targets[: args.limit]
    if not targets:
        print("ERROR: no targets selected", file=sys.stderr)
        return 2

    done = _load_state(state_file) if args.resume else set()
    ok_count = 0
    skip_count = 0
    failed: list[dict[str, Any]] = []
    started = time.time()

    for idx, target in enumerate(targets, start=1):
        key = _target_key(target.profile, target.agent_id, target.knowledge_pack_id)
        out_path = output_dir / target.agent_id / f"{target.knowledge_pack_id}.json"

        if args.resume and key in done and out_path.exists():
            skip_count += 1
            _safe_print(f"[{idx}/{len(targets)}] skip (resume) -> {key}")
            continue

        _safe_print(f"[{idx}/{len(targets)}] generate -> {key}")
        success = False
        last_error = ""

        for attempt in range(1, max(1, int(args.request_retries)) + 1):
            try:
                row = client.generate_pack(
                    tenant_id=args.tenant_id,
                    profile=target.profile,
                    agent_id=target.agent_id,
                    knowledge_pack_id=target.knowledge_pack_id,
                    model_name=args.model_name,
                    max_retries=args.max_retries,
                    system_prompt_path=args.system_prompt_path,
                    persist=True,
                )
                pack = dict(row.get("generated_pack") or {})
                schema_errors = validate_pack_schema(pack)
                if schema_errors:
                    raise RuntimeError("schema_validation_failed: " + "; ".join(schema_errors))

                payload = {
                    "profile": target.profile,
                    "agent_id": target.agent_id,
                    "knowledge_pack_id": target.knowledge_pack_id,
                    "knowledge_pack_name": target.knowledge_pack_name,
                    "trace_id": row.get("trace_id"),
                    "attempt": row.get("attempt"),
                    "fallback_used": bool(row.get("fallback_used", False)),
                    "error": row.get("error"),
                    "pack": pack,
                    "saved": row.get("saved"),
                }
                _save_json(out_path, payload)
                ok_count += 1
                done.add(key)
                if args.resume:
                    _write_state(state_file, done)
                success = True
                break
            except Exception as exc:
                last_error = str(exc)
                _safe_print(f"  -> retry {attempt}/{args.request_retries} failed: {last_error}")
                if attempt < args.request_retries and args.retry_delay_sec > 0:
                    time.sleep(float(args.retry_delay_sec))

        if not success:
            failed.append({"target": key, "error": last_error})
            if args.fail_fast:
                break
        if args.sleep_sec > 0:
            time.sleep(float(args.sleep_sec))

    elapsed = round(time.time() - started, 2)
    summary = {
        "ok": len(failed) == 0,
        "profile": args.profile,
        "total": len(targets),
        "success": ok_count,
        "skipped": skip_count,
        "failed": len(failed),
        "elapsed_sec": elapsed,
        "output_dir": str(output_dir),
        "failed_items": failed,
    }
    _save_json(output_dir / "_summary.json", summary)
    if args.resume:
        _write_state(state_file, done)
    _safe_print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failed else 3


if __name__ == "__main__":
    raise SystemExit(main())
