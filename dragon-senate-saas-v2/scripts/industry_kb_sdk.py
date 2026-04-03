#!/usr/bin/env python3
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import requests

REQUIRED_PROFILE_KEYS = {
    "industry_name",
    "pain_points",
    "jargon_terms",
    "solutions",
    "objections",
    "banned_absolute",
    "banned_industry",
    "risk_behaviors",
}

STRICT_COUNTS = {
    "pain_points": 30,
    "jargon_terms": 120,
    "solutions": 30,
    "objections": 20,
    "banned_absolute": 40,
    "banned_industry": 40,
    "risk_behaviors": 25,
}

OWNER_VIEW_HINTS = [
    "获客成本",
    "投流",
    "核销",
    "翻台率",
    "坪效",
    "人效",
    "营收",
    "净利",
    "毛利",
    "老板",
    "加盟商",
    "招商",
]


@dataclass
class IndustryRow:
    tag: str
    name: str
    category_name: str


def validate_profile_schema(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(profile, dict):
        return ["profile is not object"]

    def _bad_text(value: Any) -> bool:
        text = str(value or "").strip()
        if not text:
            return True
        if text in {"???", "unknown", "n/a", "待补充", "未设置"}:
            return True
        if text.count("?") >= max(2, len(text) // 3):
            return True
        return False

    keys = set(profile.keys())
    missing = REQUIRED_PROFILE_KEYS - keys
    if missing:
        errors.append(f"missing keys: {sorted(missing)}")

    if _bad_text(profile.get("industry_name")):
        errors.append("industry_name invalid")

    for key in (
        "pain_points",
        "jargon_terms",
        "solutions",
        "objections",
        "banned_absolute",
        "banned_industry",
        "risk_behaviors",
    ):
        if not isinstance(profile.get(key), list):
            errors.append(f"{key} is not list")

    for key, required in STRICT_COUNTS.items():
        values = profile.get(key)
        if isinstance(values, list) and len(values) != required:
            errors.append(f"{key} count invalid ({len(values)} != {required})")

    # structure checks
    for item in profile.get("objections") or []:
        if not isinstance(item, dict) or _bad_text(item.get("objection")) or _bad_text(item.get("response_logic")):
            errors.append("objections item invalid")
            break

    for key in ("banned_absolute", "banned_industry"):
        for item in profile.get(key) or []:
            if (
                not isinstance(item, dict)
                or _bad_text(item.get("term"))
                or _bad_text(item.get("reason"))
                or _bad_text(item.get("safer_alternative"))
            ):
                errors.append(f"{key} item invalid")
                break

    for item in profile.get("risk_behaviors") or []:
        if (
            not isinstance(item, dict)
            or _bad_text(item.get("behavior"))
            or _bad_text(item.get("risk_type"))
            or _bad_text(item.get("platform_hint"))
            or _bad_text(item.get("safer_alternative"))
        ):
            errors.append("risk_behaviors item invalid")
            break

    # dedupe checks
    for key in ("pain_points", "jargon_terms", "solutions"):
        values = [str(v).strip() for v in (profile.get(key) or []) if str(v).strip()]
        norm = {re.sub(r"\s+", " ", v).strip().lower() for v in values}
        if len(norm) != len(values):
            errors.append(f"{key} has duplicates")

    # owner-view leakage checks
    combined = [str(x) for x in (profile.get("pain_points") or [])] + [str(x) for x in (profile.get("solutions") or [])]
    if combined:
        owner_hits = 0
        for text in combined:
            text_norm = str(text).lower()
            if any(hint.lower() in text_norm for hint in OWNER_VIEW_HINTS):
                owner_hits += 1
        if owner_hits > max(3, int(len(combined) * 0.1)):
            errors.append("consumer_perspective_invalid: too many owner-view terms")

    return errors


class IndustryKbApiClient:
    def __init__(self, base_url: str, timeout_sec: int = 240) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = max(10, int(timeout_sec))
        self._token = ""

    @property
    def token(self) -> str:
        return self._token

    def login(self, username: str, password: str) -> str:
        resp = requests.post(
            f"{self.base_url}/auth/login",
            json={"username": username, "password": password},
            timeout=30,
        )
        resp.raise_for_status()
        token = (resp.json() or {}).get("access_token")
        if not token:
            raise RuntimeError("login succeeded but access_token missing")
        self._token = str(token)
        return self._token

    def _auth_headers(self) -> dict[str, str]:
        if not self._token:
            raise RuntimeError("not logged in; call login() first")
        return {"Authorization": f"Bearer {self._token}"}

    def taxonomy_rows(self) -> list[IndustryRow]:
        resp = requests.get(
            f"{self.base_url}/industry-kb/taxonomy",
            headers=self._auth_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json() or {}
        taxonomy = data.get("taxonomy")
        if not isinstance(taxonomy, list):
            return []

        rows: list[IndustryRow] = []
        for category in taxonomy:
            category_name = str(category.get("category_name", "")).strip()
            for item in category.get("sub_industries", []) or []:
                tag = str(item.get("tag", "")).strip()
                name = str(item.get("name", "")).strip()
                if not tag:
                    continue
                rows.append(IndustryRow(tag=tag, name=name or tag, category_name=category_name))
        return rows

    def generate_profile(
        self,
        *,
        tenant_id: str | None,
        industry_tag: str,
        industry_name: str,
        base_profile: dict[str, Any],
        system_prompt_path: str | None,
        seed_to_kb: bool,
        max_retries: int,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "industry_tag": industry_tag,
            "industry_name": industry_name,
            "base_profile": base_profile,
            "seed_to_kb": bool(seed_to_kb),
            "max_retries": int(max_retries),
        }
        if tenant_id:
            payload["tenant_id"] = tenant_id
        if system_prompt_path:
            payload["system_prompt_path"] = system_prompt_path

        resp = requests.post(
            f"{self.base_url}/industry-kb/generate-profile",
            headers=self._auth_headers(),
            json=payload,
            timeout=self.timeout_sec,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"{resp.status_code}: {resp.text}")
        data = resp.json() or {}
        if not isinstance(data, dict):
            raise RuntimeError("response is not json object")
        return data
