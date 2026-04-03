from __future__ import annotations

import os
import re
import time
from typing import Any

import httpx


def _default_base_url() -> str:
    return os.getenv("ANYTHINGLLM_BASE_URL", "http://127.0.0.1:3002").rstrip("/")


def _embed_script_url() -> str:
    return os.getenv(
        "ANYTHINGLLM_EMBED_SCRIPT_URL",
        "https://cdn.jsdelivr.net/npm/@mintplex-labs/anythingllm-embed/dist/embed.js",
    )


def _embed_api_base() -> str:
    return os.getenv("ANYTHINGLLM_EMBED_API_BASE", _default_base_url()).rstrip("/")


def _api_headers() -> dict[str, str]:
    api_key = os.getenv("ANYTHINGLLM_API_KEY", "").strip()
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def _workspace_slug(tenant_id: str, user_external_id: str) -> str:
    raw = f"{tenant_id}__{user_external_id}".strip().lower()
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", raw).strip("-")
    return cleaned[:120] or "tenant-default"


def build_embed_snippet(
    *,
    embed_id: str,
    user_external_id: str | None = None,
    tenant_id: str | None = None,
    workspace_slug: str | None = None,
    width: str = "100%",
    height: str = "680px",
) -> str:
    safe_embed_id = (embed_id or "").strip()
    if not safe_embed_id:
        raise ValueError("embed_id is required")

    attrs = [
        f'data-embed-id="{safe_embed_id}"',
        f'data-api-base="{_embed_api_base()}"',
        f'style="display:block;width:{width};height:{height};border:0;"',
    ]
    if user_external_id:
        attrs.append(f'data-user-id="{user_external_id}"')
    if tenant_id:
        attrs.append(f'data-tenant-id="{tenant_id}"')
    if workspace_slug:
        attrs.append(f'data-workspace-slug="{workspace_slug}"')

    script_src = _embed_script_url()
    widget = (
        f'<script src="{script_src}" defer></script>\n'
        f"<anything-llm {' '.join(attrs)}></anything-llm>"
    )
    return widget


async def _probe_endpoint(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    started = time.perf_counter()
    response = await client.get(url, headers=headers, timeout=8.0)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "status_code": response.status_code,
        "latency_ms": latency_ms,
        "content_type": response.headers.get("content-type", ""),
        "body_preview": response.text[:200],
    }


async def fetch_anythingllm_health(client: httpx.AsyncClient) -> dict[str, Any]:
    base_url = _default_base_url()
    headers = _api_headers()

    checks = [
        "/api/system/health",
        "/api/v1/system/health",
        "/api/workspaces",
        "/api/ping",
        "/",
    ]

    attempts: list[dict[str, Any]] = []
    last_error = ""
    first_reachable: dict[str, Any] | None = None

    for path in checks:
        target = f"{base_url}{path}"
        try:
            row = await _probe_endpoint(client, url=target, headers=headers)
            attempts.append({"path": path, **row})
            code = int(row["status_code"])
            if code < 500 and first_reachable is None:
                first_reachable = {"path": path, **row}
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            attempts.append({"path": path, "error": last_error})

    if first_reachable is None:
        return {
            "ok": False,
            "base_url": base_url,
            "reachable": False,
            "auth_required": False,
            "error": last_error or "unreachable",
            "attempts": attempts,
        }

    status_code = int(first_reachable["status_code"])
    auth_required = status_code in {401, 403}
    healthy = status_code in {200, 204}
    reachable = True

    return {
        "ok": healthy or auth_required,
        "healthy": healthy,
        "reachable": reachable,
        "auth_required": auth_required,
        "base_url": base_url,
        "path": first_reachable["path"],
        "status_code": status_code,
        "latency_ms": first_reachable.get("latency_ms"),
        "attempts": attempts,
    }


def _extract_workspace_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("workspaces", "data", "results", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
    return []


def _workspace_match(row: dict[str, Any], expected_slug: str) -> bool:
    candidates = [
        str(row.get("slug") or "").strip().lower(),
        str(row.get("name") or "").strip().lower(),
        str(row.get("workspaceSlug") or "").strip().lower(),
        str(row.get("workspace") or "").strip().lower(),
    ]
    return expected_slug in {value for value in candidates if value}


async def ensure_anythingllm_workspace(
    *,
    client: httpx.AsyncClient,
    tenant_id: str,
    user_external_id: str,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    base_url = _default_base_url()
    headers = _api_headers()
    if not headers:
        return {
            "ok": False,
            "created": False,
            "error": "missing_api_key",
            "workspace_slug": _workspace_slug(tenant_id, user_external_id),
        }

    slug = _workspace_slug(tenant_id, user_external_id)
    desired_name = (workspace_name or f"{tenant_id}-{user_external_id}").strip()[:120] or slug

    list_paths = ["/api/workspaces", "/api/v1/workspaces"]
    rows: list[dict[str, Any]] = []
    list_error = ""
    for path in list_paths:
        try:
            response = await client.get(f"{base_url}{path}", headers=headers, timeout=12.0)
            if response.status_code >= 400:
                list_error = f"{path}:{response.status_code}"
                continue
            rows = _extract_workspace_rows(response.json())
            if rows:
                break
        except Exception as exc:  # noqa: BLE001
            list_error = str(exc)

    for row in rows:
        if _workspace_match(row, slug):
            return {
                "ok": True,
                "created": False,
                "workspace_slug": slug,
                "workspace": row,
            }

    create_payload = {
        "name": desired_name,
        "slug": slug,
        "metadata": {
            "tenant_id": tenant_id,
            "user_external_id": user_external_id,
            "managed_by": "dragon-senate-saas-v3",
        },
    }
    create_paths = ["/api/workspace/new", "/api/v1/workspace/new", "/api/workspaces"]
    create_error = ""
    for path in create_paths:
        try:
            response = await client.post(
                f"{base_url}{path}",
                headers=headers,
                json=create_payload,
                timeout=12.0,
            )
            if response.status_code >= 400:
                create_error = f"{path}:{response.status_code}:{response.text[:160]}"
                continue
            body = response.json()
            return {
                "ok": True,
                "created": True,
                "workspace_slug": slug,
                "workspace": body,
            }
        except Exception as exc:  # noqa: BLE001
            create_error = str(exc)

    return {
        "ok": False,
        "created": False,
        "workspace_slug": slug,
        "error": create_error or list_error or "workspace_ensure_failed",
    }

