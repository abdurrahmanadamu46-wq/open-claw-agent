#!/usr/bin/env python
from __future__ import annotations

import json
import os
import secrets
import string
import sys
import time

from fastapi.testclient import TestClient


def _rand(prefix: str, n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(n))}"


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def _bootstrap_env() -> None:
    os.environ.setdefault("ALLOW_INMEMORY_CHECKPOINTER", "true")
    os.environ.setdefault("AUTH_DATABASE_URL", "sqlite+aiosqlite:///./_test_auth_rewards_otp.sqlite")
    os.environ.setdefault("BILLING_DATABASE_URL", "sqlite+aiosqlite:///./_test_billing_rewards_otp.sqlite")
    os.environ.setdefault("EDGE_REWARDS_DB_PATH", "./data/_test_edge_rewards.sqlite")
    os.environ.setdefault("OTP_RELAY_DB_PATH", "./data/_test_otp_relay.sqlite")
    os.environ.setdefault("EDGE_SHARED_SECRET", "edge-demo-secret")

    # Make reward gain/claim fast for deterministic in-process test.
    os.environ.setdefault("EDGE_REWARD_POINTS_PER_HOUR", "3600")
    os.environ.setdefault("EDGE_REWARD_FREE_PACK_POINTS_COST", "1")
    os.environ.setdefault("EDGE_REWARD_FREE_PACK_RUN_CREDIT", "3")
    os.environ.setdefault("EDGE_REWARD_FREE_PACK_TOKEN_CREDIT", "5000")


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from app import app  # pylint: disable=import-outside-toplevel

    username = _rand("edgeuser")
    email = f"{username}@example.com"
    password = "EdgePass!2026"
    edge_id = f"edge_{_rand('demo', 4)}"
    account_id = f"acc_{_rand('demo', 4)}"

    with TestClient(app) as client:
        reg = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "is_active": True,
                "is_verified": True,
                "is_superuser": False,
                "username": username,
                "tenant_id": "tenant_demo",
                "roles": ["member"],
            },
        )
        _must(reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}")

        login = client.post("/auth/login", json={"username": username, "password": password})
        _must(login.status_code == 200, f"login failed: {login.status_code} {login.text}")
        token = str(login.json().get("access_token") or "")
        _must(len(token) > 20, "invalid access token")
        auth_header = {"Authorization": f"Bearer {token}"}
        edge_header = {"x-edge-secret": os.getenv("EDGE_SHARED_SECRET", "edge-demo-secret")}

        reg_edge = client.post(
            "/edge/register",
            headers=auth_header,
            json={
                "edge_id": edge_id,
                "user_id": username,
                "account_id": account_id,
                "skills": ["publish_video"],
            },
        )
        _must(reg_edge.status_code == 200, f"edge register failed: {reg_edge.status_code} {reg_edge.text}")

        hb1 = client.post(
            "/edge/heartbeat",
            headers=edge_header,
            json={"edge_id": edge_id, "user_id": username, "account_id": account_id, "status": "online"},
        )
        _must(hb1.status_code == 200, f"heartbeat #1 failed: {hb1.status_code} {hb1.text}")
        time.sleep(2)
        hb2 = client.post(
            "/edge/heartbeat",
            headers=edge_header,
            json={"edge_id": edge_id, "user_id": username, "account_id": account_id, "status": "online"},
        )
        _must(hb2.status_code == 200, f"heartbeat #2 failed: {hb2.status_code} {hb2.text}")

        wallet = client.get("/rewards/wallet", headers=auth_header)
        _must(wallet.status_code == 200, f"wallet failed: {wallet.status_code} {wallet.text}")
        wallet_json = wallet.json()
        _must(wallet_json.get("ok") is True, "wallet ok=false")

        claim = client.post(
            "/rewards/claim/free-pack",
            headers=auth_header,
            json={"claim_type": "free_pack", "note": "test"},
        )
        _must(claim.status_code == 200, f"claim failed: {claim.status_code} {claim.text}")
        claim_json = claim.json()
        _must(bool((claim_json.get("result") or {}).get("ok")), "claim result ok=false")

        otp_create = client.post(
            "/otp/request",
            headers=edge_header,
            json={
                "edge_id": edge_id,
                "user_id": username,
                "account_id": account_id,
                "platform": "xiaohongshu",
                "purpose": "login",
                "masked_target": "138****2026",
                "message": "请提交验证码",
            },
        )
        _must(otp_create.status_code == 200, f"otp create failed: {otp_create.status_code} {otp_create.text}")
        request_id = str((otp_create.json().get("request") or {}).get("request_id") or "")
        _must(request_id.startswith("otp_"), f"invalid request id: {request_id}")

        otp_pending = client.get("/otp/pending", headers=auth_header)
        _must(otp_pending.status_code == 200, f"otp pending failed: {otp_pending.status_code} {otp_pending.text}")
        pending_items = otp_pending.json().get("items") or []
        _must(any(str(x.get("request_id")) == request_id for x in pending_items), "otp request not in pending list")

        otp_submit = client.post(
            "/otp/submit",
            headers=auth_header,
            json={"request_id": request_id, "code": "123456"},
        )
        _must(otp_submit.status_code == 200, f"otp submit failed: {otp_submit.status_code} {otp_submit.text}")

        edge_pull = client.get(f"/edge/pull/{edge_id}", headers=edge_header)
        _must(edge_pull.status_code == 200, f"edge pull failed: {edge_pull.status_code} {edge_pull.text}")
        packages = edge_pull.json().get("packages") or []
        otp_pkg = [x for x in packages if x.get("type") == "otp_code" and x.get("request_id") == request_id]
        _must(len(otp_pkg) == 1, f"otp package missing in edge pull: {packages}")

        otp_consume = client.post(
            "/otp/consume",
            headers=edge_header,
            json={"request_id": request_id, "edge_id": edge_id, "status": "consumed"},
        )
        _must(otp_consume.status_code == 200, f"otp consume failed: {otp_consume.status_code} {otp_consume.text}")

        claims = client.get("/rewards/claims", headers=auth_header)
        _must(claims.status_code == 200, f"claims failed: {claims.status_code} {claims.text}")

        print(
            json.dumps(
                {
                    "ok": True,
                    "user": username,
                    "edge_id": edge_id,
                    "wallet": wallet_json.get("wallet"),
                    "claim": claim_json.get("result"),
                    "otp_request_id": request_id,
                    "otp_package": otp_pkg[0],
                    "claims_count": claims.json().get("count"),
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
        print(f"[TEST_EDGE_REWARDS_OTP_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

