import argparse
import json
import sys
from typing import Any

import requests


def _print_json(title: str, payload: Any) -> None:
    print(f"\n=== {title} ===")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _request(
    session: requests.Session,
    method: str,
    url: str,
    token: str | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = session.request(method, url, headers=headers, json=json_body, timeout=30)
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {url} failed: {response.status_code} {response.text}")
    if not response.text:
        return {"ok": True}
    return response.json()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run clientless delivery acceptance flow for Dragon Senate SaaS v2."
    )
    parser.add_argument("--base_url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="change_me")
    parser.add_argument("--user_id", default="admin")
    parser.add_argument("--edge_count", type=int, default=3)
    parser.add_argument(
        "--task_description",
        default="调研母婴赛道热点，拆解对标账号并产出短视频内容包，分发到边缘节点执行",
    )
    parser.add_argument(
        "--competitor",
        action="append",
        default=[],
        help="Competitor handle/url, can pass multiple times",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    competitors = args.competitor or ["bench_a", "bench_b"]

    with requests.Session() as session:
        login = _request(
            session,
            "POST",
            f"{base_url}/auth/login",
            json_body={"username": args.username, "password": args.password},
        )
        token = str(login.get("access_token", "")).strip()
        if not token:
            raise RuntimeError("Login response missing access_token")
        _print_json("Login", {"token_type": login.get("token_type"), "expires_in": login.get("expires_in")})

        readiness_before = _request(
            session,
            "GET",
            f"{base_url}/delivery/readiness?user_id={args.user_id}",
            token=token,
        )
        _print_json("Readiness (Before)", readiness_before)

        bootstrap = _request(
            session,
            "POST",
            f"{base_url}/demo/bootstrap",
            token=token,
            json_body={
                "user_id": args.user_id,
                "edge_count": args.edge_count,
                "edge_prefix": "edge-demo",
            },
        )
        _print_json("Demo Bootstrap", bootstrap)

        full_cycle = _request(
            session,
            "POST",
            f"{base_url}/demo/full-cycle",
            token=token,
            json_body={
                "user_id": args.user_id,
                "task_description": args.task_description,
                "competitor_handles": competitors,
                "edge_count": args.edge_count,
                "dm_text": "你好，怎么买？现在有没有优惠？",
            },
        )
        _print_json("Demo Full Cycle", full_cycle)

        readiness_after = _request(
            session,
            "GET",
            f"{base_url}/delivery/readiness?user_id={args.user_id}",
            token=token,
        )
        _print_json("Readiness (After)", readiness_after)

    print("\nDelivery acceptance flow completed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[demo-delivery-cli] failed: {exc}")
        raise SystemExit(1)
