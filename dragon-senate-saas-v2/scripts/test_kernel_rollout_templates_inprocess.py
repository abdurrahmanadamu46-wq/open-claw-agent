#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_kernel_templates.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_kernel_templates.sqlite")
    os.environ.setdefault("RESEARCH_RADAR_DB_PATH", "./data/_test_research_kernel_templates.sqlite")
    os.environ.setdefault("CLAWWORK_DB_PATH", "./data/_test_clawwork_kernel_templates.sqlite")
    os.environ.setdefault("LOSSLESS_MEMORY_DB_PATH", "./data/_test_lossless_kernel_templates.sqlite")
    os.environ.setdefault("CLAWTEAM_DB_PATH", "./data/_test_clawteam_kernel_templates.sqlite")
    os.environ.setdefault("POLICY_BANDIT_DB_PATH", "./data/_test_bandit_kernel_templates.sqlite")
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_kernel_templates.sqlite")
    os.environ.setdefault("SENATE_KERNEL_ENABLED", "true")
    os.environ.setdefault("SENATE_KERNEL_GREY_RATIO", "100")
    os.environ.setdefault("SENATE_KERNEL_BLOCK_MODE", "hitl")
    os.environ.setdefault("HITL_ENABLED", "false")
    os.environ.setdefault("LLM_MOCK_FORCE", "true")
    os.environ.setdefault("LLM_FORCE_LOCAL", "true")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("ktpl")
    email = f"{username}@example.com"
    password = "KernelTplPassw0rd!2026"
    source_tenant = _rand("tenant_demo")
    target_tenant = _rand("tenant_migrate")
    template_key = _rand("ops_peak_safe")
    template_key_v2 = f"{template_key}_v2"

    with TestClient(app) as client:
        reg = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "is_active": True,
                "is_verified": True,
                "is_superuser": True,
                "username": username,
                "tenant_id": source_tenant,
                "roles": ["admin"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = login.json().get("access_token")
        _must(isinstance(token, str) and len(token) > 20, "token missing")
        headers = {"Authorization": f"Bearer {token}"}

        save = client.post(
            "/kernel/rollout/templates",
            headers=headers,
            json={
                "tenant_id": source_tenant,
                "template_name": "运营高峰保守模板",
                "template_key": template_key,
                "risk_rollout": {
                    "P0": {"rollout_ratio": 0, "strategy_version": "strict_v2", "block_mode": "deny"},
                    "P1": {"rollout_ratio": 10, "strategy_version": "guarded_v2", "block_mode": "hitl"},
                    "P2": {"rollout_ratio": 40, "strategy_version": "balanced_v2", "block_mode": "hitl"},
                    "P3": {"rollout_ratio": 80, "strategy_version": "explore_v2", "block_mode": "hitl"},
                },
                "note": "template-test",
            },
        )
        _must(save.status_code == 200, f"save template failed: {save.status_code} {save.text}")
        payload = save.json()
        _must(payload.get("template", {}).get("template_key") == template_key, "template key mismatch")

        listed = client.get(
            "/kernel/rollout/templates",
            headers=headers,
            params={"tenant_id": source_tenant, "limit": 20},
        )
        _must(listed.status_code == 200, f"list templates failed: {listed.status_code} {listed.text}")
        data = listed.json()
        templates = data.get("templates", [])
        _must(isinstance(templates, list) and len(templates) > 0, "templates empty")
        _must(any(t.get("template_key") == template_key for t in templates), "saved template not found")

        renamed = client.patch(
            f"/kernel/rollout/templates/{template_key}",
            headers=headers,
            json={
                "tenant_id": source_tenant,
                "new_template_key": template_key_v2,
                "template_name": "运营高峰保守模板-V2",
                "note": "template-test-v2",
            },
        )
        _must(renamed.status_code == 200, f"rename template failed: {renamed.status_code} {renamed.text}")
        renamed_payload = renamed.json()
        _must(
            renamed_payload.get("template", {}).get("template_key") == template_key_v2,
            "rename key mismatch",
        )
        exported = client.get(
            "/kernel/rollout/templates/export",
            headers=headers,
            params={"tenant_id": source_tenant, "limit": 20},
        )
        _must(exported.status_code == 200, f"export templates failed: {exported.status_code} {exported.text}")
        exported_payload = exported.json()
        exported_templates = exported_payload.get("templates", [])
        _must(isinstance(exported_templates, list) and len(exported_templates) > 0, "export templates empty")

        imported = client.post(
            "/kernel/rollout/templates/import",
            headers=headers,
            json={
                "tenant_id": target_tenant,
                "source_tenant_id": source_tenant,
                "mode": "upsert",
                "templates": exported_templates,
            },
        )
        _must(imported.status_code == 200, f"import templates failed: {imported.status_code} {imported.text}")
        imported_payload = imported.json()
        _must(int(imported_payload.get("inserted", 0)) >= 1, "import inserted should >= 1")

        listed_imported = client.get(
            "/kernel/rollout/templates",
            headers=headers,
            params={"tenant_id": target_tenant, "limit": 20},
        )
        _must(
            listed_imported.status_code == 200,
            f"list templates for migrated tenant failed: {listed_imported.status_code} {listed_imported.text}",
        )
        templates_imported = listed_imported.json().get("templates", [])
        _must(
            any(t.get("template_key") == template_key_v2 for t in templates_imported),
            "migrated template not found",
        )

        listed_after_rename = client.get(
            "/kernel/rollout/templates",
            headers=headers,
            params={"tenant_id": source_tenant, "limit": 20},
        )
        _must(
            listed_after_rename.status_code == 200,
            f"list templates after rename failed: {listed_after_rename.status_code} {listed_after_rename.text}",
        )
        templates_after_rename = listed_after_rename.json().get("templates", [])
        _must(
            any(t.get("template_key") == template_key_v2 for t in templates_after_rename),
            "renamed template not found",
        )

        deleted = client.delete(
            f"/kernel/rollout/templates/{template_key_v2}",
            headers=headers,
            params={"tenant_id": source_tenant},
        )
        _must(deleted.status_code == 200, f"delete template failed: {deleted.status_code} {deleted.text}")

        listed_after_delete = client.get(
            "/kernel/rollout/templates",
            headers=headers,
            params={"tenant_id": source_tenant, "limit": 20},
        )
        _must(
            listed_after_delete.status_code == 200,
            f"list templates after delete failed: {listed_after_delete.status_code} {listed_after_delete.text}",
        )
        templates = listed_after_delete.json().get("templates", [])
        _must(
            all(t.get("template_key") != template_key_v2 for t in templates),
            "template should be deleted",
        )

    print(
        json.dumps(
            {
                "ok": True,
                "count": len(templates),
                "first": templates[0] if templates else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_KERNEL_TEMPLATES_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
