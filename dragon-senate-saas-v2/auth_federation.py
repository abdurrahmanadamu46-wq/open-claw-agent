from __future__ import annotations

import json
import os
import secrets
import sqlite3
import hashlib
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi_users.db import SQLAlchemyUserDatabase
from jose import jwt
from sqlalchemy import or_, select

from user_auth import AsyncSessionMaker
from user_auth import User
from user_auth import UserCreate
from user_auth import UserManager
from user_auth import _normalize_roles
from user_auth import _utcnow_naive


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("AUTH_FEDERATION_DB_PATH", "data/auth_federation.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _normalize_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item or "").strip() for item in raw]
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            values = []
        else:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = [part.strip() for part in text.split(",")]
            if isinstance(parsed, list):
                values = [str(item or "").strip() for item in parsed]
            else:
                values = [str(parsed).strip()]
    else:
        values = []
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _normalize_bool(raw: Any, *, default: bool = False) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _normalize_json_blob(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (dict, list)):
        return json.dumps(raw, ensure_ascii=False)
    return str(raw).strip()


def _base64url_bytes(raw: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


@dataclass(slots=True)
class FederationProvider:
    provider_id: str
    name: str
    tenant_id: str
    issuer: str
    audience: str = ""
    client_id: str = ""
    client_secret: str = ""
    discovery_url: str = ""
    authorization_endpoint: str = ""
    token_endpoint: str = ""
    jwks_uri: str = ""
    jwks_json: str = ""
    public_key_pem: str = ""
    algorithms: list[str] = field(default_factory=lambda: ["RS256"])
    scopes: list[str] = field(default_factory=lambda: ["openid", "profile", "email"])
    use_pkce: bool = True
    username_claim: str = "preferred_username"
    email_claim: str = "email"
    roles_claim: str = "roles"
    subject_claim: str = "sub"
    default_roles: list[str] = field(default_factory=lambda: ["member"])
    allowed_domains: list[str] = field(default_factory=list)
    discovery_domains: list[str] = field(default_factory=list)
    sync_roles: bool = True
    auto_create_user: bool = True
    enabled: bool = True
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["has_jwks"] = bool(self.jwks_json or self.jwks_uri or self.public_key_pem)
        payload["has_client_secret"] = bool(self.client_secret)
        payload["jwks_json"] = self.jwks_json if self.jwks_json else ""
        payload["public_key_pem"] = self.public_key_pem if self.public_key_pem else ""
        payload["client_secret"] = ""
        return payload


@dataclass(slots=True)
class FederationBinding:
    provider_id: str
    tenant_id: str
    external_subject: str
    user_id: str
    external_email: str = ""
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)


@dataclass(slots=True)
class FederationAuthRequest:
    state: str
    provider_id: str
    tenant_id: str
    redirect_after_login: str
    redirect_uri: str
    nonce: str = ""
    code_verifier: str = ""
    created_at: str = field(default_factory=_utc_now)
    expires_at: str = field(default_factory=_utc_now)
    consumed_at: str = ""


@dataclass(slots=True)
class FederatedIdentity:
    subject: str
    username: str
    email: str
    roles: list[str]
    claims: dict[str, Any]


class FederationProviderStore:
    def __init__(self) -> None:
        self._path = _db_path()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS auth_federation_providers (
                    provider_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    issuer TEXT NOT NULL,
                    audience TEXT NOT NULL DEFAULT '',
                    client_id TEXT NOT NULL DEFAULT '',
                    client_secret TEXT NOT NULL DEFAULT '',
                    discovery_url TEXT NOT NULL DEFAULT '',
                    authorization_endpoint TEXT NOT NULL DEFAULT '',
                    token_endpoint TEXT NOT NULL DEFAULT '',
                    jwks_uri TEXT NOT NULL DEFAULT '',
                    jwks_json TEXT NOT NULL DEFAULT '',
                    public_key_pem TEXT NOT NULL DEFAULT '',
                    algorithms_json TEXT NOT NULL DEFAULT '["RS256"]',
                    scopes_json TEXT NOT NULL DEFAULT '["openid","profile","email"]',
                    use_pkce INTEGER NOT NULL DEFAULT 1,
                    username_claim TEXT NOT NULL DEFAULT 'preferred_username',
                    email_claim TEXT NOT NULL DEFAULT 'email',
                    roles_claim TEXT NOT NULL DEFAULT 'roles',
                    subject_claim TEXT NOT NULL DEFAULT 'sub',
                    default_roles_json TEXT NOT NULL DEFAULT '["member"]',
                    allowed_domains_json TEXT NOT NULL DEFAULT '[]',
                    discovery_domains_json TEXT NOT NULL DEFAULT '[]',
                    sync_roles INTEGER NOT NULL DEFAULT 1,
                    auto_create_user INTEGER NOT NULL DEFAULT 1,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS auth_federation_bindings (
                    provider_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    external_subject TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    external_email TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (provider_id, external_subject)
                );

                CREATE INDEX IF NOT EXISTS idx_auth_federation_provider_tenant
                    ON auth_federation_providers(tenant_id, enabled);
                CREATE INDEX IF NOT EXISTS idx_auth_federation_binding_user
                    ON auth_federation_bindings(tenant_id, user_id);

                CREATE TABLE IF NOT EXISTS auth_federation_requests (
                    state TEXT PRIMARY KEY,
                    provider_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    redirect_after_login TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    nonce TEXT NOT NULL DEFAULT '',
                    code_verifier TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_auth_federation_requests_provider
                    ON auth_federation_requests(provider_id, tenant_id, expires_at);
                """
            )
            provider_columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(auth_federation_providers)").fetchall()}
            if "client_secret" not in provider_columns:
                conn.execute("ALTER TABLE auth_federation_providers ADD COLUMN client_secret TEXT NOT NULL DEFAULT ''")
            if "authorization_endpoint" not in provider_columns:
                conn.execute("ALTER TABLE auth_federation_providers ADD COLUMN authorization_endpoint TEXT NOT NULL DEFAULT ''")
            if "token_endpoint" not in provider_columns:
                conn.execute("ALTER TABLE auth_federation_providers ADD COLUMN token_endpoint TEXT NOT NULL DEFAULT ''")
            if "scopes_json" not in provider_columns:
                conn.execute("""ALTER TABLE auth_federation_providers ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '["openid","profile","email"]'""")
            if "use_pkce" not in provider_columns:
                conn.execute("ALTER TABLE auth_federation_providers ADD COLUMN use_pkce INTEGER NOT NULL DEFAULT 1")
            if "discovery_domains_json" not in provider_columns:
                conn.execute("""ALTER TABLE auth_federation_providers ADD COLUMN discovery_domains_json TEXT NOT NULL DEFAULT '[]'""")
            conn.commit()

    def _row_to_provider(self, row: sqlite3.Row) -> FederationProvider:
        return FederationProvider(
            provider_id=str(row["provider_id"]),
            name=str(row["name"]),
            tenant_id=str(row["tenant_id"]),
            issuer=str(row["issuer"]),
            audience=str(row["audience"] or ""),
            client_id=str(row["client_id"] or ""),
            client_secret=str(row["client_secret"] or ""),
            discovery_url=str(row["discovery_url"] or ""),
            authorization_endpoint=str(row["authorization_endpoint"] or ""),
            token_endpoint=str(row["token_endpoint"] or ""),
            jwks_uri=str(row["jwks_uri"] or ""),
            jwks_json=str(row["jwks_json"] or ""),
            public_key_pem=str(row["public_key_pem"] or ""),
            algorithms=_normalize_list(row["algorithms_json"]) or ["RS256"],
            scopes=_normalize_list(row["scopes_json"]) or ["openid", "profile", "email"],
            use_pkce=bool(int(row["use_pkce"] or 0)),
            username_claim=str(row["username_claim"] or "preferred_username"),
            email_claim=str(row["email_claim"] or "email"),
            roles_claim=str(row["roles_claim"] or "roles"),
            subject_claim=str(row["subject_claim"] or "sub"),
            default_roles=_normalize_roles(row["default_roles_json"]),
            allowed_domains=[item.lower() for item in _normalize_list(row["allowed_domains_json"])],
            discovery_domains=[item.lower() for item in _normalize_list(row["discovery_domains_json"])],
            sync_roles=bool(int(row["sync_roles"] or 0)),
            auto_create_user=bool(int(row["auto_create_user"] or 0)),
            enabled=bool(int(row["enabled"] or 0)),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def list_providers(self, tenant_id: str | None = None) -> list[FederationProvider]:
        with self._connect() as conn:
            if tenant_id:
                rows = conn.execute(
                    "SELECT * FROM auth_federation_providers WHERE tenant_id = ? ORDER BY name ASC",
                    (tenant_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM auth_federation_providers ORDER BY tenant_id ASC, name ASC"
                ).fetchall()
        return [self._row_to_provider(row) for row in rows]

    def get_provider(self, provider_id: str) -> FederationProvider | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM auth_federation_providers WHERE provider_id = ?",
                (str(provider_id),),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_provider(row)

    def upsert_provider(self, payload: dict[str, Any], *, provider_id: str | None = None) -> FederationProvider:
        provider_key = str(provider_id or payload.get("provider_id") or f"idp_{uuid.uuid4().hex[:10]}").strip()
        now = _utc_now()
        existing = self.get_provider(provider_key)
        provider = FederationProvider(
            provider_id=provider_key,
            name=str(payload.get("name") or (existing.name if existing else provider_key)).strip()[:128] or provider_key,
            tenant_id=str(payload.get("tenant_id") or (existing.tenant_id if existing else "tenant_main")).strip()[:128] or "tenant_main",
            issuer=str(payload.get("issuer") or (existing.issuer if existing else "")).strip().rstrip("/"),
            audience=str(payload.get("audience") or (existing.audience if existing else "")).strip(),
            client_id=str(payload.get("client_id") or (existing.client_id if existing else "")).strip(),
            client_secret=str(payload.get("client_secret") or (existing.client_secret if existing else "")).strip(),
            discovery_url=str(payload.get("discovery_url") or (existing.discovery_url if existing else "")).strip(),
            authorization_endpoint=str(payload.get("authorization_endpoint") or (existing.authorization_endpoint if existing else "")).strip(),
            token_endpoint=str(payload.get("token_endpoint") or (existing.token_endpoint if existing else "")).strip(),
            jwks_uri=str(payload.get("jwks_uri") or (existing.jwks_uri if existing else "")).strip(),
            jwks_json=_normalize_json_blob(payload.get("jwks_json") if "jwks_json" in payload else (existing.jwks_json if existing else "")),
            public_key_pem=_normalize_json_blob(payload.get("public_key_pem") if "public_key_pem" in payload else (existing.public_key_pem if existing else "")),
            algorithms=_normalize_list(payload.get("algorithms")) or (existing.algorithms if existing else ["RS256"]),
            scopes=_normalize_list(payload.get("scopes")) or (existing.scopes if existing else ["openid", "profile", "email"]),
            use_pkce=_normalize_bool(payload.get("use_pkce"), default=existing.use_pkce if existing else True),
            username_claim=str(payload.get("username_claim") or (existing.username_claim if existing else "preferred_username")).strip() or "preferred_username",
            email_claim=str(payload.get("email_claim") or (existing.email_claim if existing else "email")).strip() or "email",
            roles_claim=str(payload.get("roles_claim") or (existing.roles_claim if existing else "roles")).strip() or "roles",
            subject_claim=str(payload.get("subject_claim") or (existing.subject_claim if existing else "sub")).strip() or "sub",
            default_roles=_normalize_roles(payload.get("default_roles") if "default_roles" in payload else (existing.default_roles if existing else ["member"])),
            allowed_domains=[item.lower() for item in _normalize_list(payload.get("allowed_domains") if "allowed_domains" in payload else (existing.allowed_domains if existing else []))],
            discovery_domains=[item.lower() for item in _normalize_list(payload.get("discovery_domains") if "discovery_domains" in payload else (existing.discovery_domains if existing else []))],
            sync_roles=_normalize_bool(payload.get("sync_roles"), default=existing.sync_roles if existing else True),
            auto_create_user=_normalize_bool(payload.get("auto_create_user"), default=existing.auto_create_user if existing else True),
            enabled=_normalize_bool(payload.get("enabled"), default=existing.enabled if existing else True),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO auth_federation_providers(
                    provider_id, name, tenant_id, issuer, audience, client_id, client_secret, discovery_url,
                    authorization_endpoint, token_endpoint, jwks_uri, jwks_json,
                    public_key_pem, algorithms_json, scopes_json, use_pkce, username_claim, email_claim, roles_claim, subject_claim,
                    default_roles_json, allowed_domains_json, discovery_domains_json, sync_roles, auto_create_user, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_id) DO UPDATE SET
                    name = excluded.name,
                    tenant_id = excluded.tenant_id,
                    issuer = excluded.issuer,
                    audience = excluded.audience,
                    client_id = excluded.client_id,
                    client_secret = excluded.client_secret,
                    discovery_url = excluded.discovery_url,
                    authorization_endpoint = excluded.authorization_endpoint,
                    token_endpoint = excluded.token_endpoint,
                    jwks_uri = excluded.jwks_uri,
                    jwks_json = excluded.jwks_json,
                    public_key_pem = excluded.public_key_pem,
                    algorithms_json = excluded.algorithms_json,
                    scopes_json = excluded.scopes_json,
                    use_pkce = excluded.use_pkce,
                    username_claim = excluded.username_claim,
                    email_claim = excluded.email_claim,
                    roles_claim = excluded.roles_claim,
                    subject_claim = excluded.subject_claim,
                    default_roles_json = excluded.default_roles_json,
                    allowed_domains_json = excluded.allowed_domains_json,
                    discovery_domains_json = excluded.discovery_domains_json,
                    sync_roles = excluded.sync_roles,
                    auto_create_user = excluded.auto_create_user,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (
                    provider.provider_id,
                    provider.name,
                    provider.tenant_id,
                    provider.issuer,
                    provider.audience,
                    provider.client_id,
                    provider.client_secret,
                    provider.discovery_url,
                    provider.authorization_endpoint,
                    provider.token_endpoint,
                    provider.jwks_uri,
                    provider.jwks_json,
                    provider.public_key_pem,
                    json.dumps(provider.algorithms, ensure_ascii=False),
                    json.dumps(provider.scopes, ensure_ascii=False),
                    1 if provider.use_pkce else 0,
                    provider.username_claim,
                    provider.email_claim,
                    provider.roles_claim,
                    provider.subject_claim,
                    json.dumps(provider.default_roles, ensure_ascii=False),
                    json.dumps(provider.allowed_domains, ensure_ascii=False),
                    json.dumps(provider.discovery_domains, ensure_ascii=False),
                    1 if provider.sync_roles else 0,
                    1 if provider.auto_create_user else 0,
                    1 if provider.enabled else 0,
                    provider.created_at,
                    provider.updated_at,
                ),
            )
            conn.commit()
        return provider

    def delete_provider(self, provider_id: str) -> bool:
        with self._connect() as conn:
            deleted = conn.execute(
                "DELETE FROM auth_federation_providers WHERE provider_id = ?",
                (str(provider_id),),
            ).rowcount
            conn.execute(
                "DELETE FROM auth_federation_bindings WHERE provider_id = ?",
                (str(provider_id),),
            )
            conn.execute(
                "DELETE FROM auth_federation_requests WHERE provider_id = ?",
                (str(provider_id),),
            )
            conn.commit()
        return bool(deleted)

    def get_binding(self, provider_id: str, external_subject: str) -> FederationBinding | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT provider_id, tenant_id, external_subject, user_id, external_email, created_at, updated_at
                FROM auth_federation_bindings
                WHERE provider_id = ? AND external_subject = ?
                """,
                (str(provider_id), str(external_subject)),
            ).fetchone()
        if row is None:
            return None
        return FederationBinding(
            provider_id=str(row["provider_id"]),
            tenant_id=str(row["tenant_id"]),
            external_subject=str(row["external_subject"]),
            user_id=str(row["user_id"]),
            external_email=str(row["external_email"] or ""),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def upsert_binding(self, binding: FederationBinding) -> FederationBinding:
        now = _utc_now()
        existing = self.get_binding(binding.provider_id, binding.external_subject)
        created_at = existing.created_at if existing else now
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO auth_federation_bindings(
                    provider_id, tenant_id, external_subject, user_id, external_email, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_id, external_subject) DO UPDATE SET
                    tenant_id = excluded.tenant_id,
                    user_id = excluded.user_id,
                    external_email = excluded.external_email,
                    updated_at = excluded.updated_at
                """,
                (
                    binding.provider_id,
                    binding.tenant_id,
                    binding.external_subject,
                    binding.user_id,
                    binding.external_email,
                    created_at,
                    now,
                ),
            )
            conn.commit()
        return FederationBinding(
            provider_id=binding.provider_id,
            tenant_id=binding.tenant_id,
            external_subject=binding.external_subject,
            user_id=binding.user_id,
            external_email=binding.external_email,
            created_at=created_at,
            updated_at=now,
        )

    def create_auth_request(
        self,
        *,
        provider_id: str,
        tenant_id: str,
        redirect_after_login: str,
        redirect_uri: str,
        nonce: str = "",
        code_verifier: str = "",
        ttl_sec: int = 600,
    ) -> FederationAuthRequest:
        record = FederationAuthRequest(
            state=secrets.token_urlsafe(24),
            provider_id=str(provider_id),
            tenant_id=str(tenant_id),
            redirect_after_login=str(redirect_after_login),
            redirect_uri=str(redirect_uri),
            nonce=str(nonce),
            code_verifier=str(code_verifier),
            created_at=_utc_now(),
            expires_at=_expires_after(ttl_sec),
            consumed_at="",
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO auth_federation_requests(
                    state, provider_id, tenant_id, redirect_after_login, redirect_uri, nonce, code_verifier,
                    created_at, expires_at, consumed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
                """,
                (
                    record.state,
                    record.provider_id,
                    record.tenant_id,
                    record.redirect_after_login,
                    record.redirect_uri,
                    record.nonce,
                    record.code_verifier,
                    record.created_at,
                    record.expires_at,
                ),
            )
            conn.commit()
        return record

    def consume_auth_request(self, state: str) -> FederationAuthRequest | None:
        target_state = str(state or "").strip()
        if not target_state:
            return None
        now = datetime.now(timezone.utc)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT state, provider_id, tenant_id, redirect_after_login, redirect_uri, nonce, code_verifier,
                       created_at, expires_at, consumed_at
                FROM auth_federation_requests
                WHERE state = ?
                """,
                (target_state,),
            ).fetchone()
            if row is None:
                return None
            expires_at = str(row["expires_at"] or "")
            consumed_at = str(row["consumed_at"] or "")
            try:
                expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                expires_dt = now - timedelta(seconds=1)
            if consumed_at or expires_dt <= now:
                conn.execute("DELETE FROM auth_federation_requests WHERE state = ?", (target_state,))
                conn.commit()
                return None
            consumed = _utc_now()
            conn.execute(
                "UPDATE auth_federation_requests SET consumed_at = ? WHERE state = ?",
                (consumed, target_state),
            )
            conn.commit()
        return FederationAuthRequest(
            state=str(row["state"]),
            provider_id=str(row["provider_id"]),
            tenant_id=str(row["tenant_id"]),
            redirect_after_login=str(row["redirect_after_login"]),
            redirect_uri=str(row["redirect_uri"]),
            nonce=str(row["nonce"] or ""),
            code_verifier=str(row["code_verifier"] or ""),
            created_at=str(row["created_at"]),
            expires_at=str(row["expires_at"]),
            consumed_at=consumed,
        )


_store: FederationProviderStore | None = None


def get_federation_store() -> FederationProviderStore:
    global _store
    if _store is None:
        _store = FederationProviderStore()
    return _store


def _email_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[-1].strip().lower()


def discover_provider_for_email(tenant_id: str, email: str) -> FederationProvider | None:
    domain = _email_domain(email)
    if not domain:
        return None
    exact_matches: list[FederationProvider] = []
    fallback_matches: list[FederationProvider] = []
    for provider in get_federation_store().list_providers(tenant_id):
        if not provider.enabled:
            continue
        discovery_pool = [item.lower() for item in (provider.discovery_domains or [])]
        allowed_pool = [item.lower() for item in (provider.allowed_domains or [])]
        if domain in discovery_pool:
            exact_matches.append(provider)
        elif domain in allowed_pool:
            fallback_matches.append(provider)
    if exact_matches:
        return sorted(exact_matches, key=lambda item: item.name.lower())[0]
    if fallback_matches:
        return sorted(fallback_matches, key=lambda item: item.name.lower())[0]
    return None


async def test_provider_configuration(provider: FederationProvider) -> dict[str, Any]:
    result: dict[str, Any] = {
        "provider_id": provider.provider_id,
        "issuer": provider.issuer,
        "enabled": provider.enabled,
        "checks": [],
        "ok": True,
    }

    def add_check(name: str, ok: bool, detail: str = "") -> None:
        result["checks"].append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            result["ok"] = False

    add_check("issuer", bool(provider.issuer), provider.issuer or "missing")
    add_check("client_id", bool(provider.client_id), provider.client_id or "missing")
    add_check(
        "authorize_mode",
        bool(provider.authorization_endpoint or provider.discovery_url),
        provider.authorization_endpoint or provider.discovery_url or "missing",
    )
    add_check(
        "token_or_direct_exchange",
        bool(provider.token_endpoint or provider.jwks_json or provider.public_key_pem),
        provider.token_endpoint or ("inline_jwks" if provider.jwks_json else "inline_public_key" if provider.public_key_pem else "missing"),
    )

    hydrated: dict[str, Any] | None = None
    if provider.discovery_url:
        try:
            hydrated = await hydrate_provider_metadata(provider.to_public_dict())
            add_check("discovery_fetch", True, str(hydrated.get("discovery_url") or provider.discovery_url))
        except Exception as exc:
            add_check("discovery_fetch", False, str(exc))
    if provider.jwks_uri:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(provider.jwks_uri)
                response.raise_for_status()
                payload = response.json()
            key_count = len(payload.get("keys", [])) if isinstance(payload, dict) else 0
            add_check("jwks_fetch", key_count > 0, f"keys={key_count}")
        except Exception as exc:
            add_check("jwks_fetch", False, str(exc))
    else:
        has_inline_keys = bool(provider.jwks_json or provider.public_key_pem or (hydrated or {}).get("jwks_json"))
        add_check("jwks_material", has_inline_keys, "inline" if has_inline_keys else "missing")

    if provider.authorization_endpoint:
        add_check("authorization_endpoint", True, provider.authorization_endpoint)
    elif hydrated and hydrated.get("authorization_endpoint"):
        add_check("authorization_endpoint", True, str(hydrated.get("authorization_endpoint")))
    else:
        add_check("authorization_endpoint", False, "missing")

    return result


def _expires_after(seconds: int = 600) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=max(60, int(seconds)))).replace(microsecond=0).isoformat()


async def hydrate_provider_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    hydrated = dict(payload)
    discovery_url = str(hydrated.get("discovery_url") or "").strip()
    issuer = str(hydrated.get("issuer") or "").strip().rstrip("/")
    has_manual_keys = bool(hydrated.get("jwks_json") or hydrated.get("public_key_pem") or hydrated.get("jwks_uri"))
    if not discovery_url and issuer and not has_manual_keys:
        discovery_url = f"{issuer}/.well-known/openid-configuration"
        hydrated["discovery_url"] = discovery_url

    if discovery_url and (not hydrated.get("jwks_json") or not hydrated.get("jwks_uri") or not hydrated.get("issuer")):
        async with httpx.AsyncClient(timeout=10.0) as client:
            discovery_resp = await client.get(discovery_url)
            discovery_resp.raise_for_status()
            discovery = discovery_resp.json()
            if isinstance(discovery, dict):
                hydrated["issuer"] = str(hydrated.get("issuer") or discovery.get("issuer") or "").strip().rstrip("/")
                hydrated["authorization_endpoint"] = str(
                    hydrated.get("authorization_endpoint") or discovery.get("authorization_endpoint") or ""
                ).strip()
                hydrated["token_endpoint"] = str(
                    hydrated.get("token_endpoint") or discovery.get("token_endpoint") or ""
                ).strip()
                hydrated["jwks_uri"] = str(hydrated.get("jwks_uri") or discovery.get("jwks_uri") or "").strip()
                if not hydrated.get("audience"):
                    hydrated["audience"] = str(hydrated.get("client_id") or discovery.get("client_id") or "").strip()
    jwks_uri = str(hydrated.get("jwks_uri") or "").strip()
    if jwks_uri and not hydrated.get("jwks_json") and not hydrated.get("public_key_pem"):
        async with httpx.AsyncClient(timeout=10.0) as client:
            jwks_resp = await client.get(jwks_uri)
            jwks_resp.raise_for_status()
            jwks_payload = jwks_resp.json()
        hydrated["jwks_json"] = json.dumps(jwks_payload, ensure_ascii=False)
    return hydrated


def build_pkce_pair() -> tuple[str, str]:
    verifier = _base64url_bytes(secrets.token_bytes(32))
    challenge = _base64url_bytes(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def build_authorization_url(
    provider: FederationProvider,
    *,
    state: str,
    redirect_uri: str,
    nonce: str = "",
    code_challenge: str = "",
) -> str:
    from urllib.parse import urlencode

    if not provider.authorization_endpoint:
        raise ValueError("provider_authorization_endpoint_missing")
    params: dict[str, Any] = {
        "response_type": "code",
        "client_id": provider.client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(provider.scopes or ["openid", "profile", "email"]),
        "state": state,
    }
    if nonce:
        params["nonce"] = nonce
    if provider.use_pkce and code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    return f"{provider.authorization_endpoint}?{urlencode(params)}"


async def exchange_authorization_code_for_tokens(
    provider: FederationProvider,
    *,
    code: str,
    redirect_uri: str,
    code_verifier: str = "",
) -> dict[str, Any]:
    if not provider.token_endpoint:
        raise ValueError("provider_token_endpoint_missing")
    data: dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": str(code),
        "redirect_uri": redirect_uri,
        "client_id": provider.client_id,
    }
    if provider.client_secret:
        data["client_secret"] = provider.client_secret
    if provider.use_pkce and code_verifier:
        data["code_verifier"] = code_verifier
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(provider.token_endpoint, data=data)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("provider_token_response_invalid")
    return payload


def verify_federated_token(provider: FederationProvider, token: str) -> dict[str, Any]:
    return verify_federated_token_with_audience(provider, token, audience_override=None)


def verify_federated_token_response(
    provider: FederationProvider,
    token_payload: dict[str, Any],
    *,
    expected_nonce: str = "",
) -> dict[str, Any]:
    id_token = str(token_payload.get("id_token") or "").strip()
    access_token = str(token_payload.get("access_token") or "").strip()
    if id_token:
        audience = provider.client_id or provider.audience or None
        claims = verify_federated_token_with_audience(provider, id_token, audience_override=audience)
        if expected_nonce:
            token_nonce = str(claims.get("nonce") or "").strip()
            if token_nonce and token_nonce != expected_nonce:
                raise ValueError("federated_nonce_mismatch")
        return claims
    if access_token:
        return verify_federated_token(provider, access_token)
    raise ValueError("provider_token_missing")


def verify_federated_token_with_audience(
    provider: FederationProvider,
    token: str,
    *,
    audience_override: str | None = None,
) -> dict[str, Any]:
    key: Any
    if provider.public_key_pem:
        key = provider.public_key_pem
    elif provider.jwks_json:
        try:
            key = json.loads(provider.jwks_json)
        except json.JSONDecodeError:
            key = provider.jwks_json
    else:
        raise ValueError("provider_key_material_missing")
    audience = audience_override if audience_override is not None else provider.audience
    kwargs: dict[str, Any] = {}
    if audience:
        kwargs["audience"] = audience
    options = {"verify_aud": bool(audience)}
    return jwt.decode(
        token,
        key,
        algorithms=provider.algorithms or ["RS256"],
        issuer=provider.issuer or None,
        options=options,
        **kwargs,
    )


def extract_federated_identity(provider: FederationProvider, claims: dict[str, Any]) -> FederatedIdentity:
    subject = str(claims.get(provider.subject_claim) or claims.get("sub") or "").strip()
    if not subject:
        raise ValueError("federated_subject_missing")
    email = str(claims.get(provider.email_claim) or claims.get("email") or "").strip().lower()
    username = str(
        claims.get(provider.username_claim)
        or claims.get("preferred_username")
        or claims.get("name")
        or email.split("@", 1)[0]
        or subject
    ).strip()
    external_roles = claims.get(provider.roles_claim)
    roles = provider.default_roles[:]
    if provider.sync_roles:
        roles = _normalize_roles(roles + _normalize_roles(external_roles))
    else:
        roles = _normalize_roles(roles)
    return FederatedIdentity(
        subject=subject,
        username=username[:64] or subject[:64],
        email=email,
        roles=roles or ["member"],
        claims=dict(claims),
    )


async def resolve_or_provision_federated_user(
    provider: FederationProvider,
    identity: FederatedIdentity,
) -> User:
    if provider.allowed_domains and identity.email:
        if _email_domain(identity.email) not in {domain.lower() for domain in provider.allowed_domains}:
            raise ValueError("federated_email_domain_not_allowed")

    store = get_federation_store()
    binding = store.get_binding(provider.provider_id, identity.subject)

    async with AsyncSessionMaker() as session:
        user: User | None = None
        if binding is not None:
            user = await session.get(User, uuid.UUID(binding.user_id))
            if user is None or str(user.tenant_id or "") != provider.tenant_id:
                user = None
        if user is None and identity.email:
            user = (
                await session.execute(
                    select(User).where(User.tenant_id == provider.tenant_id).where(
                        or_(User.email == identity.email, User.username == identity.username)
                    )
                )
            ).scalar_one_or_none()
        if user is None and not provider.auto_create_user:
            raise ValueError("federated_user_not_found")

        if user is None:
            user_db = SQLAlchemyUserDatabase(session, User)
            manager = UserManager(user_db)
            password = f"{secrets.token_urlsafe(16)}Aa1!"
            payload = UserCreate(
                email=identity.email or f"{identity.username}@example.com",
                password=password,
                is_superuser="admin" in identity.roles,
                is_active=True,
                is_verified=True,
                username=identity.username,
                tenant_id=provider.tenant_id,
                roles=identity.roles,
            )
            user = await manager.create(payload, safe=False, request=None)
            user.roles = identity.roles
            user.updated_at = _utcnow_naive()
            await session.commit()
            await session.refresh(user)
        else:
            changed = False
            if identity.email and str(user.email or "").strip().lower() != identity.email:
                user.email = identity.email
                changed = True
            if identity.username and str(user.username or "").strip() != identity.username:
                user.username = identity.username
                changed = True
            if provider.sync_roles and _normalize_roles(user.roles_json) != identity.roles:
                user.roles = identity.roles
                changed = True
            if not user.is_active:
                user.is_active = True
                changed = True
            if not user.is_verified:
                user.is_verified = True
                changed = True
            if changed:
                user.updated_at = _utcnow_naive()
                await session.commit()
                await session.refresh(user)

    store.upsert_binding(
        FederationBinding(
            provider_id=provider.provider_id,
            tenant_id=provider.tenant_id,
            external_subject=identity.subject,
            user_id=str(user.id),
            external_email=identity.email,
        )
    )
    return user
