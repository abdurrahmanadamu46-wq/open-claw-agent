"""
Backfill historical battle logs into skills_v3 entries.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

KB_BASE = Path(__file__).resolve().parent.parent / "docs" / "lobster-kb"
QUALITY_THRESHOLD = 3.5
MIN_SAMPLES_PER_SKILL = 2
ALL_LOBSTERS = [
    "commander",
    "strategist",
    "inkwriter",
    "visualizer",
    "radar",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def filter_eligible(entries: list[dict[str, Any]], min_quality: float = QUALITY_THRESHOLD) -> list[dict[str, Any]]:
    result = []
    for entry in entries:
        outcome = str(entry.get("outcome") or entry.get("status") or "").lower()
        quality = float(entry.get("quality_score", 0) or 0)
        already = str(entry.get("skill_v3_ref") or "").strip()
        if outcome != "success" or quality < min_quality or already:
            continue
        result.append(entry)
    return result


def cluster_entries(entries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        task_type = str(entry.get("task_type") or entry.get("type") or "通用").strip() or "通用"
        buckets[task_type].append(entry)
    return {key: value for key, value in buckets.items() if len(value) >= MIN_SAMPLES_PER_SKILL}


async def extract_skill_from_cluster(lobster_id: str, task_type: str, entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not entries:
        return None
    prefix = lobster_id[:3]
    slug = "".join(ch if ch.isalnum() else "_" for ch in task_type)[:18].strip("_") or "general"
    sample_count = len(entries)
    lessons = [str(item.get("lessons_learned") or item.get("cognitive_breakthrough") or item.get("root_cause") or "").strip() for item in entries]
    lessons = [item for item in lessons if item]
    actions = [str(item.get("action_taken") or item.get("deliverable_summary") or "").strip() for item in entries]
    actions = [item for item in actions if item]
    return {
        "entry_id": f"{prefix}_{slug}_v3_backfill_{sample_count:02d}",
        "title": f"{task_type} 回填技能",
        "skill_type": "formula",
        "category": task_type,
        "source": "backfill",
        "backfill_from": [str(item.get("entry_id") or item.get("log_id") or "") for item in entries],
        "fixed_assets": {
            "framework": f"从 {sample_count} 条成功记录提炼出的共性方法",
            "proven_patterns": lessons[:3],
        },
        "smart_slots": {
            "task_type": task_type,
            "sample_count": sample_count,
        },
        "execution_sop": actions[:4] or [
            "1. 读取历史高质量 battle log",
            "2. 提炼共同策略与步骤",
            "3. 写入 skills_v3 供后续龙虾复用",
        ],
        "replication_checklist": [
            "是否有至少 2 条成功样本支撑",
            "是否总结出稳定可复用的方法",
        ],
        "known_anti_patterns": [
            "不要把单次偶然成功当成稳定技能",
        ],
        "training_ref": f"backfill_{datetime.now().strftime('%Y%m%d')}",
        "quality_floor": max(float(item.get("quality_score", 0) or 0) for item in entries),
        "sample_count": sample_count,
        "status": "已验证",
        "created_at": datetime.now().strftime("%Y-%m-%d"),
        "last_verified": datetime.now().strftime("%Y-%m-%d"),
        "tags": ["backfill", task_type, lobster_id],
        "superseded_by": None,
    }


def write_skill_to_kb(lobster_id: str, skill: dict[str, Any]) -> bool:
    path = KB_BASE / lobster_id / "skills.json"
    data = _load_json(path)
    skills_v3 = list(data.get("skills_v3") or [])
    existing_ids = {str(item.get("entry_id") or "") for item in skills_v3}
    if str(skill.get("entry_id") or "") in existing_ids:
        return False
    skills_v3.append(skill)
    data["skills_v3"] = skills_v3
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def update_battle_log_refs(lobster_id: str, entry_ids: list[str], skill_v3_ref: str) -> None:
    path = KB_BASE / lobster_id / "battle_log.json"
    data = _load_json(path)
    for entry in list(data.get("entries") or []):
        current_id = str(entry.get("entry_id") or entry.get("log_id") or "")
        if current_id in entry_ids:
            entry["skill_v3_ref"] = skill_v3_ref
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


async def backfill_lobster(lobster_id: str, dry_run: bool = True, min_quality: float = QUALITY_THRESHOLD) -> dict[str, Any]:
    battle_path = KB_BASE / lobster_id / "battle_log.json"
    skills_path = KB_BASE / lobster_id / "skills.json"
    if not battle_path.exists() or not skills_path.exists():
        return {"lobster_id": lobster_id, "missing": True, "dry_run": dry_run}

    battle_data = _load_json(battle_path)
    entries = list(battle_data.get("entries") or [])
    eligible = filter_eligible(entries, min_quality=min_quality)
    clusters = cluster_entries(eligible)
    skills_generated = 0
    skills_skipped = 0

    for task_type, items in clusters.items():
        skill = await extract_skill_from_cluster(lobster_id, task_type, items)
        if skill is None:
            skills_skipped += 1
            continue
        if not dry_run:
            inserted = write_skill_to_kb(lobster_id, skill)
            if inserted:
                update_battle_log_refs(
                    lobster_id,
                    [str(item.get("entry_id") or item.get("log_id") or "") for item in items],
                    str(skill["entry_id"]),
                )
                skills_generated += 1
            else:
                skills_skipped += 1
        else:
            skills_generated += 1

    return {
        "lobster_id": lobster_id,
        "total_entries": len(entries),
        "eligible_entries": len(eligible),
        "clusters": {key: len(value) for key, value in clusters.items()},
        "skills_generated": skills_generated,
        "skills_skipped": skills_skipped,
        "dry_run": dry_run,
    }


def stats() -> list[dict[str, Any]]:
    rows = []
    for lobster_id in ALL_LOBSTERS:
        battle_path = KB_BASE / lobster_id / "battle_log.json"
        skills_path = KB_BASE / lobster_id / "skills.json"
        if not battle_path.exists() or not skills_path.exists():
            continue
        battle = _load_json(battle_path)
        skills = _load_json(skills_path)
        entries = list(battle.get("entries") or [])
        extracted = [item for item in entries if str(item.get("skill_v3_ref") or "").strip()]
        eligible = filter_eligible(entries)
        rows.append(
            {
                "lobster_id": lobster_id,
                "battle_entries": len(entries),
                "already_backfilled": len(extracted),
                "pending_backfill": max(0, len(eligible) - len(extracted)),
                "skills_v3_count": len(list(skills.get("skills_v3") or [])),
            }
        )
    return rows


async def main_async(args: argparse.Namespace) -> int:
    if args.stats:
        for row in stats():
            print(row)
        return 0

    targets = ALL_LOBSTERS if args.all else [args.lobster]
    for lobster_id in targets:
        result = await backfill_lobster(lobster_id, dry_run=not args.apply, min_quality=args.min_quality)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill battle logs into skills_v3")
    parser.add_argument("--lobster", default="inkwriter")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--min-quality", type=float, default=QUALITY_THRESHOLD)
    parser.add_argument("--stats", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.dry_run:
        args.apply = False
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
