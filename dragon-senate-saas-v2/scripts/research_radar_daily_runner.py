from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from feishu_channel import feishu_channel
from research_radar_fetchers import fetch_github_hot
from research_radar_fetchers import fetch_github_latest
from research_radar_fetchers import fetch_huggingface_hot
from research_radar_fetchers import fetch_openalex_hot
from research_radar_fetchers import fetch_openalex_latest
from research_radar_fetchers import fetch_qbitai_latest
from research_radar_ranker import actionability_score as research_actionability_score
from research_radar_ranker import combined_score as research_combined_score
from research_radar_ranker import extract_tags as research_extract_tags
from research_radar_ranker import normalize_hot_score as research_normalize_hot_score
from research_radar_store import begin_fetch_run as research_begin_fetch_run
from research_radar_store import ensure_schema as ensure_research_schema
from research_radar_store import finish_fetch_run as research_finish_fetch_run
from research_radar_store import list_signals as research_list_signals
from research_radar_store import record_source_health as research_record_source_health
from research_radar_store import run_health_summary as research_run_health_summary
from research_radar_store import upsert_signal as research_upsert_signal


def _safe_slug(raw: str, fallback: str = "tenant_demo") -> str:
    value = "".join(ch if (ch.isalnum() or ch in {"_", "-"}) else "_" for ch in (raw or "").strip().lower())
    value = value.strip("_")
    return value[:128] or fallback


def _fetch_by_source(source: str) -> list[dict[str, Any]]:
    if source == "openalex_latest":
        return fetch_openalex_latest(limit=100)
    if source == "openalex_hot":
        return fetch_openalex_hot(limit=100)
    if source == "github_latest":
        return fetch_github_latest(limit=100)
    if source == "github_hot":
        return fetch_github_hot(limit=100)
    if source == "huggingface_hot":
        return fetch_huggingface_hot(limit=100)
    if source == "qbitai_latest":
        return fetch_qbitai_latest(limit=100)
    return []


def _retry_limit() -> int:
    raw = str(os.getenv("RESEARCH_RADAR_FETCH_RETRIES", "2")).strip()
    try:
        return max(1, min(int(raw), 5))
    except ValueError:
        return 2


def _fetch_with_retry(source: str) -> dict[str, Any]:
    retry_limit = _retry_limit()
    total_duration_ms = 0
    last_error = ""
    for attempt in range(1, retry_limit + 1):
        started = time.perf_counter()
        try:
            rows = _fetch_by_source(source)
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            return {"ok": True, "rows": rows, "duration_ms": total_duration_ms, "attempts": attempt, "error": ""}
        except Exception as exc:  # noqa: BLE001
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            last_error = str(exc)[:400]
            if attempt >= retry_limit:
                break
            time.sleep(min(1.5 * attempt, 3.0))
    return {"ok": False, "rows": [], "duration_ms": total_duration_ms, "attempts": retry_limit, "error": last_error or "fetch_failed"}


def _upsert_auto_row(*, tenant_id: str, item: dict[str, Any]) -> dict[str, Any]:
    title = str(item.get("title") or "").strip()[:300]
    url = str(item.get("url") or "").strip()[:1000]
    summary = str(item.get("summary") or "").strip()[:4000]
    tags = research_extract_tags(title, summary)
    actionability = research_actionability_score(title=title, summary=summary, tags=tags)
    hot_score = research_normalize_hot_score(item.get("hot_score_raw", 0))
    score, credibility = research_combined_score(
        source=str(item.get("source") or "manual"),
        hot_score=hot_score,
        actionability=actionability,
        freshness=float(item.get("freshness") or 0.5),
    )
    return research_upsert_signal(
        tenant_id=tenant_id,
        source=str(item.get("source") or "manual"),
        bucket=str(item.get("bucket") or "A_auto"),
        rank_type=str(item.get("rank_type") or "latest"),
        title=title or "Untitled Signal",
        url=url or "about:blank",
        summary=summary,
        tags=tags,
        score=score,
        credibility=credibility,
        actionability=actionability,
        raw=item.get("raw") if isinstance(item.get("raw"), dict) else item,
        published_at=str(item.get("published_at") or "")[:64] or None,
    )


def _render_digest_markdown(items: list[dict[str, Any]], tenant_id: str) -> str:
    lines = [f"# 龙虾情报晨报 ({tenant_id})", "", f"共 {len(items)} 条（仅前 20 条可执行项）", ""]
    for idx, item in enumerate(items[:20], start=1):
        title = str(item.get("title") or "Untitled").strip()
        url = str(item.get("url") or "").strip()
        score = float(item.get("score") or 0.0)
        credibility = float(item.get("credibility") or 0.0)
        actionability = float(item.get("actionability") or 0.0)
        tags = ", ".join([str(x) for x in (item.get("tags") or [])[:8]])
        lines.append(f"{idx}. [{title}]({url})")
        lines.append(
            f"   - score={score:.3f} | credibility={credibility:.3f} | actionability={actionability:.3f}"
        )
        if tags:
            lines.append(f"   - tags: {tags}")
    return "\n".join(lines).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Research Radar daily runner")
    parser.add_argument("--tenant-id", default=os.getenv("RESEARCH_RADAR_TENANT_ID", "tenant_demo"))
    parser.add_argument(
        "--sources",
        default=os.getenv(
            "RESEARCH_RADAR_SOURCES",
            "openalex_latest,openalex_hot,github_latest,github_hot,huggingface_hot,qbitai_latest",
        ),
    )
    parser.add_argument("--push-feishu", action="store_true")
    parser.add_argument("--chat-id", default=os.getenv("RESEARCH_RADAR_FEISHU_CHAT_ID", "research_digest"))
    args = parser.parse_args()

    tenant_id = _safe_slug(args.tenant_id, fallback="tenant_demo")
    sources = [s.strip() for s in str(args.sources).split(",") if s.strip()]
    if not sources:
        sources = ["openalex_latest", "github_latest", "huggingface_hot"]

    ensure_research_schema()
    run = research_begin_fetch_run(tenant_id=tenant_id, trigger_type="scheduled", requested_sources=sources)
    success_count = 0
    fail_count = 0
    errors: list[str] = []

    for source in sources:
        fetch_result = _fetch_with_retry(source)
        if fetch_result["ok"]:
            rows = fetch_result["rows"]
            for item in rows:
                _upsert_auto_row(tenant_id=tenant_id, item=item)
                success_count += 1
            research_record_source_health(
                tenant_id=tenant_id,
                source=source,
                run_id=str(run.get("run_id")),
                status="success",
                item_count=len(rows),
                duration_ms=int(fetch_result["duration_ms"]),
            )
        else:
            fail_count += 1
            errors.append(f"{source}:{str(fetch_result['error'])[:240]}")
            research_record_source_health(
                tenant_id=tenant_id,
                source=source,
                run_id=str(run.get("run_id")),
                status="failed",
                item_count=0,
                duration_ms=int(fetch_result["duration_ms"]),
                error_message=str(fetch_result["error"]),
            )

    research_finish_fetch_run(
        run_id=str(run.get("run_id")),
        success_count=success_count,
        fail_count=fail_count,
        error_summary="; ".join(errors)[:2000],
    )

    items = research_list_signals(tenant_id=tenant_id, limit=20, only_executable=True)
    digest = _render_digest_markdown(items, tenant_id=tenant_id)
    print(digest)

    if args.push_feishu:
        sent = feishu_channel.send_markdown(
            content=digest,
            chat_id=str(args.chat_id or "research_digest"),
            title="龙虾情报晨报",
        )
        print(f"\n[feishu] sent={sent}")

    print(
        f"\n[result] tenant_id={tenant_id} run_id={run.get('run_id')} success_count={success_count} fail_count={fail_count}"
    )
    print(f"[slo] {research_run_health_summary(tenant_id=tenant_id, window_hours=24)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
