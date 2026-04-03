#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


REQUIRED_PACK_KEYS = {
    "agent_id",
    "agent_name",
    "default_task_type",
    "knowledge_pack_id",
    "knowledge_pack_name",
    "knowledge_pack_goal",
    "why_now",
    "downstream_use_cases",
    "source_map",
    "document_blueprints",
    "metadata_schema",
    "retrieval_queries",
    "ranking_rules",
    "freshness_rules",
    "dedup_rules",
    "risk_guardrails",
    "evaluation_metrics",
    "continuous_improvement_loops",
}


@dataclass
class RagTarget:
    profile: str
    agent_id: str
    knowledge_pack_id: str
    knowledge_pack_name: str


def validate_pack_schema(pack: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(pack, dict):
        return ["pack is not object"]
    keys = set(pack.keys())
    missing = REQUIRED_PACK_KEYS - keys
    if missing:
        errors.append(f"missing keys: {sorted(missing)}")

    def _as_unique_str_list(value: Any, n: int, name: str) -> None:
        if not isinstance(value, list):
            errors.append(f"{name} is not list")
            return
        if len(value) != n:
            errors.append(f"{name} size != {n}")
            return
        clean = [str(x).strip() for x in value if str(x).strip()]
        if len(clean) != n:
            errors.append(f"{name} contains empty values")
            return
        if len(set(clean)) != n:
            errors.append(f"{name} contains duplicates")

    _as_unique_str_list(pack.get("downstream_use_cases"), 6, "downstream_use_cases")
    _as_unique_str_list(pack.get("retrieval_queries"), 12, "retrieval_queries")
    _as_unique_str_list(pack.get("ranking_rules"), 8, "ranking_rules")
    _as_unique_str_list(pack.get("freshness_rules"), 8, "freshness_rules")
    _as_unique_str_list(pack.get("dedup_rules"), 8, "dedup_rules")
    _as_unique_str_list(pack.get("risk_guardrails"), 8, "risk_guardrails")
    _as_unique_str_list(pack.get("continuous_improvement_loops"), 10, "continuous_improvement_loops")

    for key, n in [("source_map", 6), ("document_blueprints", 6), ("metadata_schema", 12), ("evaluation_metrics", 8)]:
        value = pack.get(key)
        if not isinstance(value, list):
            errors.append(f"{key} is not list")
            continue
        if len(value) != n:
            errors.append(f"{key} size != {n}")
            continue
        if not all(isinstance(x, dict) for x in value):
            errors.append(f"{key} contains non-object")
    return errors


class AgentRagApiClient:
    def __init__(self, base_url: str, timeout_sec: int = 240) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = max(15, int(timeout_sec))
        self._token = ""

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

    def profiles(self) -> list[str]:
        resp = requests.get(
            f"{self.base_url}/agent-rag/profiles",
            headers=self._auth_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        return [str(x).strip() for x in (resp.json() or {}).get("profiles") or [] if str(x).strip()]

    def catalog_targets(self, profile: str) -> list[RagTarget]:
        resp = requests.get(
            f"{self.base_url}/agent-rag/catalog",
            headers=self._auth_headers(),
            params={"profile": profile},
            timeout=60,
        )
        resp.raise_for_status()
        catalog = ((resp.json() or {}).get("catalog") or {})
        rows = []
        for item in list(catalog.get("targets") or []):
            rows.append(
                RagTarget(
                    profile=str(item.get("profile", profile)),
                    agent_id=str(item.get("agent_id", "")).strip(),
                    knowledge_pack_id=str(item.get("knowledge_pack_id", "")).strip(),
                    knowledge_pack_name=str(item.get("knowledge_pack_name", "")).strip(),
                )
            )
        return [x for x in rows if x.agent_id and x.knowledge_pack_id]

    def generate_pack(
        self,
        *,
        tenant_id: str | None,
        profile: str,
        agent_id: str,
        knowledge_pack_id: str,
        model_name: str | None,
        max_retries: int,
        system_prompt_path: str | None,
        persist: bool = True,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "profile": profile,
            "agent_id": agent_id,
            "knowledge_pack_id": knowledge_pack_id,
            "max_retries": int(max_retries),
            "persist": bool(persist),
        }
        if tenant_id:
            payload["tenant_id"] = tenant_id
        if model_name:
            payload["model_name"] = model_name
        if system_prompt_path:
            payload["system_prompt_path"] = system_prompt_path
        resp = requests.post(
            f"{self.base_url}/agent-rag/generate-pack",
            headers=self._auth_headers(),
            json=payload,
            timeout=self.timeout_sec,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"{resp.status_code}: {resp.text}")
        row = resp.json() or {}
        if not isinstance(row, dict):
            raise RuntimeError("response is not json object")
        return row
