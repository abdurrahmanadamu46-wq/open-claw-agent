from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


USER_AGENT = "Mozilla/5.0 (ResearchRadar/1.0)"


def _get_json(url: str, timeout: int = 25) -> dict[str, Any]:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "ignore"))


def _get_text(url: str, timeout: int = 25) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def _iso_day(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip()[:10]


def _freshness_from_date(day: str) -> float:
    try:
        dt = datetime.fromisoformat(day)
    except Exception:  # noqa: BLE001
        return 0.45
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    delta_days = max(0, int((now - dt).total_seconds() // 86400))
    if delta_days <= 2:
        return 1.0
    if delta_days <= 7:
        return 0.85
    if delta_days <= 30:
        return 0.65
    if delta_days <= 180:
        return 0.45
    return 0.3


def fetch_openalex_latest(limit: int = 100) -> list[dict[str, Any]]:
    url = (
        "https://api.openalex.org/works?"
        + urlencode(
            {
                "filter": "from_publication_date:2025-01-01,title.search:agent llm",
                "sort": "publication_date:desc",
                "per-page": str(max(1, min(limit, 100))),
            }
        )
    )
    data = _get_json(url)
    out: list[dict[str, Any]] = []
    for item in data.get("results", [])[:limit]:
        day = _iso_day(item.get("publication_date"))
        primary_location = item.get("primary_location")
        if not isinstance(primary_location, dict):
            primary_location = {}
        source_obj = primary_location.get("source")
        if not isinstance(source_obj, dict):
            source_obj = {}
        out.append(
            {
                "source": "openalex",
                "bucket": "A_auto",
                "rank_type": "latest",
                "title": str(item.get("display_name") or "").strip(),
                "url": str(item.get("id") or "").strip(),
                "summary": str(source_obj.get("display_name") or "").strip(),
                "hot_score_raw": float(item.get("cited_by_count") or 0),
                "published_at": day,
                "freshness": _freshness_from_date(day),
                "raw": item,
            }
        )
    return out


def fetch_openalex_hot(limit: int = 100) -> list[dict[str, Any]]:
    url = (
        "https://api.openalex.org/works?"
        + urlencode(
            {
                "filter": "from_publication_date:2020-01-01,title.search:agent llm",
                "sort": "cited_by_count:desc",
                "per-page": str(max(1, min(limit, 100))),
            }
        )
    )
    data = _get_json(url)
    out: list[dict[str, Any]] = []
    for item in data.get("results", [])[:limit]:
        day = _iso_day(item.get("publication_date"))
        primary_location = item.get("primary_location")
        if not isinstance(primary_location, dict):
            primary_location = {}
        source_obj = primary_location.get("source")
        if not isinstance(source_obj, dict):
            source_obj = {}
        out.append(
            {
                "source": "openalex",
                "bucket": "A_auto",
                "rank_type": "hot",
                "title": str(item.get("display_name") or "").strip(),
                "url": str(item.get("id") or "").strip(),
                "summary": str(source_obj.get("display_name") or "").strip(),
                "hot_score_raw": float(item.get("cited_by_count") or 0),
                "published_at": day,
                "freshness": _freshness_from_date(day),
                "raw": item,
            }
        )
    return out


def fetch_github_hot(limit: int = 100) -> list[dict[str, Any]]:
    q = "(llm OR agentic) language:Python"
    url = "https://api.github.com/search/repositories?" + urlencode(
        {"q": q, "sort": "stars", "order": "desc", "per_page": str(max(1, min(limit, 100))), "page": "1"}
    )
    data = _get_json(url)
    out: list[dict[str, Any]] = []
    for item in data.get("items", [])[:limit]:
        day = _iso_day(item.get("updated_at"))
        out.append(
            {
                "source": "github_projects",
                "bucket": "A_auto",
                "rank_type": "hot",
                "title": str(item.get("full_name") or "").strip(),
                "url": str(item.get("html_url") or "").strip(),
                "summary": str(item.get("description") or "").strip(),
                "hot_score_raw": float(item.get("stargazers_count") or 0),
                "published_at": day,
                "freshness": _freshness_from_date(day),
                "raw": item,
            }
        )
    return out


def fetch_github_latest(limit: int = 100) -> list[dict[str, Any]]:
    q = "(agentic OR multi-agent OR langgraph) stars:>50"
    url = "https://api.github.com/search/repositories?" + urlencode(
        {"q": q, "sort": "updated", "order": "desc", "per_page": str(max(1, min(limit, 100))), "page": "1"}
    )
    data = _get_json(url)
    out: list[dict[str, Any]] = []
    for item in data.get("items", [])[:limit]:
        day = _iso_day(item.get("updated_at"))
        out.append(
            {
                "source": "github_projects",
                "bucket": "A_auto",
                "rank_type": "latest",
                "title": str(item.get("full_name") or "").strip(),
                "url": str(item.get("html_url") or "").strip(),
                "summary": str(item.get("description") or "").strip(),
                "hot_score_raw": float(item.get("stargazers_count") or 0),
                "published_at": day,
                "freshness": _freshness_from_date(day),
                "raw": item,
            }
        )
    return out


def fetch_huggingface_hot(limit: int = 50) -> list[dict[str, Any]]:
    html = _get_text("https://huggingface.co/papers/trending")
    links = []
    for link in re.findall(r'href="(/papers/[0-9]{4}\.[0-9]{5})"', html):
        if link not in links:
            links.append(link)
    titles = [
        re.sub(r"\s+", " ", re.sub("<.*?>", "", token)).strip()
        for token in re.findall(r"<h3[^>]*>(.*?)</h3>", html, re.S)
    ]
    dedup_titles: list[str] = []
    for title in titles:
        if not title:
            continue
        if dedup_titles and dedup_titles[-1] == title:
            continue
        dedup_titles.append(title)
    out: list[dict[str, Any]] = []
    for idx, link in enumerate(links[: limit or 50], start=1):
        title = dedup_titles[idx - 1] if idx - 1 < len(dedup_titles) else link.split("/")[-1]
        out.append(
            {
                "source": "huggingface_papers",
                "bucket": "B_semi",
                "rank_type": "hot",
                "title": title,
                "url": f"https://huggingface.co{link}",
                "summary": "Hugging Face Papers Trending",
                "hot_score_raw": max(1.0, (100 - idx)),
                "published_at": "",
                "freshness": 0.9,
                "raw": {"rank": idx, "paper_path": link},
            }
        )
    return out


def fetch_qbitai_latest(limit: int = 100) -> list[dict[str, Any]]:
    all_links: list[str] = []
    seen: set[str] = set()
    for page in range(1, 8):
        url = "https://www.qbitai.com/date/2026/03/" if page == 1 else f"https://www.qbitai.com/date/2026/03/page/{page}/"
        html = _get_text(url)
        links = re.findall(r'href="(https://www\.qbitai\.com/2026/03/\d+\.html)"', html)
        if not links and page > 1:
            break
        for link in links:
            if link in seen:
                continue
            seen.add(link)
            all_links.append(link)
        if len(all_links) >= limit:
            break

    out: list[dict[str, Any]] = []
    for idx, link in enumerate(all_links[:limit], start=1):
        title = ""
        try:
            detail = _get_text(link)
            m = re.search(r"<title>(.*?)</title>", detail, re.S)
            if m:
                title = re.sub(r"\s+", " ", m.group(1)).strip()
        except Exception:  # noqa: BLE001
            pass
        out.append(
            {
                "source": "qbitai",
                "bucket": "B_semi",
                "rank_type": "latest",
                "title": title or f"QbitAI Article {idx}",
                "url": link,
                "summary": "QbitAI latest feed",
                "hot_score_raw": max(1.0, (100 - idx)),
                "published_at": "2026-03",
                "freshness": 0.85,
                "raw": {"rank": idx, "source": "qbitai_march_archive"},
            }
        )
    return out
