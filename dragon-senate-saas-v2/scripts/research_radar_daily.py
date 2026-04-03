#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from research_radar_fetchers import fetch_github_hot
from research_radar_fetchers import fetch_github_latest
from research_radar_fetchers import fetch_huggingface_hot
from research_radar_fetchers import fetch_openalex_hot
from research_radar_fetchers import fetch_openalex_latest
from research_radar_fetchers import fetch_qbitai_latest
from research_radar_ranker import actionability_score
from research_radar_ranker import combined_score
from research_radar_ranker import extract_tags
from research_radar_ranker import normalize_hot_score
from research_radar_store import begin_fetch_run
from research_radar_store import finish_fetch_run
from research_radar_store import record_source_health
from research_radar_store import run_health_summary
from research_radar_store import upsert_signal


def _collect_sources(source_names: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in source_names:
        if source == "openalex":
            rows.extend(fetch_openalex_hot(100))
            rows.extend(fetch_openalex_latest(100))
        elif source == "github_projects":
            rows.extend(fetch_github_hot(100))
            rows.extend(fetch_github_latest(100))
        elif source == "huggingface_papers":
            rows.extend(fetch_huggingface_hot(50))
        elif source == "qbitai":
            rows.extend(fetch_qbitai_latest(100))
    return rows


def _retry_limit() -> int:
    raw = str(os.getenv("RESEARCH_RADAR_FETCH_RETRIES", "2")).strip()
    try:
        return max(1, min(int(raw), 5))
    except ValueError:
        return 2


def _collect_source_with_retry(source: str) -> dict[str, Any]:
    retry_limit = _retry_limit()
    total_duration_ms = 0
    last_error = ""
    for attempt in range(1, retry_limit + 1):
        started = time.perf_counter()
        try:
            rows = _collect_sources([source])
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            return {"ok": True, "rows": rows, "duration_ms": total_duration_ms, "attempts": attempt, "error": ""}
        except Exception as exc:  # noqa: BLE001
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            last_error = str(exc)[:400]
            if attempt >= retry_limit:
                break
            time.sleep(min(1.5 * attempt, 3.0))
    return {"ok": False, "rows": [], "duration_ms": total_duration_ms, "attempts": retry_limit, "error": last_error or "fetch_failed"}


def run_daily(*, tenant_id: str, sources: list[str]) -> dict[str, Any]:
    run = begin_fetch_run(tenant_id=tenant_id, trigger_type="scheduled", requested_sources=sources)
    success_count = 0
    fail_count = 0
    errors: list[str] = []

    try:
        for source in sources:
            fetch_result = _collect_source_with_retry(source)
            if fetch_result["ok"]:
                raw_rows = fetch_result["rows"]
                for item in raw_rows:
                    try:
                        title = str(item.get("title") or "").strip()
                        url = str(item.get("url") or "").strip()
                        summary = str(item.get("summary") or "").strip()
                        if not title or not url:
                            continue
                        tags = extract_tags(title, summary)
                        actionability = actionability_score(title=title, summary=summary, tags=tags)
                        hot_score = normalize_hot_score(item.get("hot_score_raw", 0))
                        final_score, credibility = combined_score(
                            source=str(item.get("source") or ""),
                            hot_score=hot_score,
                            actionability=actionability,
                            freshness=float(item.get("freshness") or 0.5),
                        )
                        upsert_signal(
                            tenant_id=tenant_id,
                            source=str(item.get("source") or "unknown"),
                            bucket=str(item.get("bucket") or "A_auto"),
                            rank_type=str(item.get("rank_type") or "latest"),
                            title=title,
                            url=url,
                            summary=summary,
                            tags=tags,
                            score=final_score,
                            credibility=credibility,
                            actionability=actionability,
                            raw=item.get("raw") if isinstance(item.get("raw"), dict) else item,
                            published_at=str(item.get("published_at") or ""),
                        )
                        success_count += 1
                    except Exception as exc:  # noqa: BLE001
                        fail_count += 1
                        errors.append(str(exc))
                record_source_health(
                    tenant_id=tenant_id,
                    source=source,
                    run_id=str(run.get("run_id")),
                    status="success",
                    item_count=len(raw_rows),
                    duration_ms=int(fetch_result["duration_ms"]),
                )
            else:
                fail_count += 1
                errors.append(str(fetch_result["error"]))
                record_source_health(
                    tenant_id=tenant_id,
                    source=source,
                    run_id=str(run.get("run_id")),
                    status="failed",
                    item_count=0,
                    duration_ms=int(fetch_result["duration_ms"]),
                    error_message=str(fetch_result["error"]),
                )
    except Exception as exc:  # noqa: BLE001
        fail_count += 1
        errors.append(str(exc))

    finish_fetch_run(
        run_id=str(run.get("run_id")),
        success_count=success_count,
        fail_count=fail_count,
        error_summary="; ".join(errors[:10]),
    )
    return {
        "run_id": run.get("run_id"),
        "tenant_id": tenant_id,
        "sources": sources,
        "success_count": success_count,
        "fail_count": fail_count,
        "errors": errors[:10],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily Research Radar collector")
    parser.add_argument("--tenant_id", default="tenant_demo")
    parser.add_argument(
        "--sources",
        default="openalex,github_projects,huggingface_papers,qbitai",
        help="comma separated sources",
    )
    args = parser.parse_args()
    sources = [x.strip() for x in str(args.sources).split(",") if x.strip()]
    result = run_daily(tenant_id=str(args.tenant_id), sources=sources)
    result["slo"] = run_health_summary(tenant_id=str(args.tenant_id), window_hours=24)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if int(result.get("fail_count") or 0) == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[RESEARCH_RADAR_DAILY_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
