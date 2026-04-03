from __future__ import annotations

import base64
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from jose import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _base64url_uint(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _state_path() -> Path:
    raw = os.getenv("AUTH_OIDC_STATE_PATH", "data/auth_oidc_keys.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / raw).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class OidcKeyMaterial:
    kid: str
    private_pem: str
    public_pem: str


class OidcKeyStore:
    def __init__(self) -> None:
        self._path = _state_path()

    def load_or_create(self) -> OidcKeyMaterial:
        if self._path.exists():
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            return OidcKeyMaterial(
                kid=str(payload["kid"]),
                private_pem=str(payload["private_pem"]),
                public_pem=str(payload["public_pem"]),
            )

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")
        kid = hashlib.sha256(public_pem.encode("utf-8")).hexdigest()[:16]
        payload = {
            "kid": kid,
            "private_pem": private_pem,
            "public_pem": public_pem,
            "created_at": _utc_now().isoformat(),
        }
        self._path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return OidcKeyMaterial(kid=kid, private_pem=private_pem, public_pem=public_pem)


class OidcProvider:
    def __init__(self) -> None:
        self._keys = OidcKeyStore().load_or_create()

    @property
    def kid(self) -> str:
        return self._keys.kid

    @property
    def private_key(self) -> str:
        return self._keys.private_pem

    @property
    def public_key(self) -> str:
        return self._keys.public_pem

    def build_jwks(self) -> dict[str, Any]:
        public_key = serialization.load_pem_public_key(self.public_key.encode("utf-8"))
        if not isinstance(public_key, rsa.RSAPublicKey):
            raise RuntimeError("public key is not RSA")
        numbers = public_key.public_numbers()
        return {
            "keys": [
                {
                    "kty": "RSA",
                    "kid": self.kid,
                    "use": "sig",
                    "alg": "RS256",
                    "n": _base64url_uint(numbers.n),
                    "e": _base64url_uint(numbers.e),
                }
            ]
        }

    def issue_tokens(
        self,
        *,
        issuer: str,
        subject: str,
        tenant_id: str,
        roles: list[str],
        audience: str,
        preferred_username: str,
        scope: str = "openid profile tenant roles",
        lifetime_sec: int = 3600,
    ) -> dict[str, Any]:
        now = _utc_now()
        exp = now + timedelta(seconds=max(300, int(lifetime_sec)))
        common = {
            "iss": issuer,
            "sub": subject,
            "aud": audience,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
            "tenant_id": tenant_id,
            "roles": roles,
            "preferred_username": preferred_username,
            "scope": scope,
        }
        access_payload = {
            **common,
            "token_use": "access",
        }
        id_payload = {
            **common,
            "token_use": "id",
            "auth_time": int(now.timestamp()),
        }
        headers = {"kid": self.kid}
        access_token = jwt.encode(access_payload, self.private_key, algorithm="RS256", headers=headers)
        id_token = jwt.encode(id_payload, self.private_key, algorithm="RS256", headers=headers)
        return {
            "access_token": access_token,
            "id_token": id_token,
            "token_type": "Bearer",
            "expires_in": max(300, int(lifetime_sec)),
            "scope": scope,
        }

    def verify_token(self, token: str, *, audience: str | None = None) -> dict[str, Any]:
        options = {"verify_aud": bool(audience)}
        kwargs = {"audience": audience} if audience else {}
        return jwt.decode(
            token,
            self.public_key,
            algorithms=["RS256"],
            options=options,
            **kwargs,
        )

    def discovery_document(self, issuer: str) -> dict[str, Any]:
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/oauth2/authorize",
            "token_endpoint": f"{issuer}/oauth2/token",
            "userinfo_endpoint": f"{issuer}/oauth2/userinfo",
            "jwks_uri": f"{issuer}/oauth2/jwks",
            "introspection_endpoint": f"{issuer}/oauth2/introspect",
            "response_types_supported": ["token", "id_token"],
            "grant_types_supported": ["password"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["openid", "profile", "tenant", "roles"],
            "claims_supported": [
                "sub",
                "tenant_id",
                "roles",
                "preferred_username",
                "scope",
            ],
        }


_provider: OidcProvider | None = None


def get_oidc_provider() -> OidcProvider:
    global _provider
    if _provider is None:
        _provider = OidcProvider()
    return _provider
