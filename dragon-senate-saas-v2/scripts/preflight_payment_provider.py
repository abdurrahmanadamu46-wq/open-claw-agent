#!/usr/bin/env python
from __future__ import annotations

import argparse
import sys
from pathlib import Path


SUPPORTED_PROVIDERS = {"stripe", "alipay", "wechatpay"}


def _parse_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _check_required(env_map: dict[str, str], keys: list[str]) -> list[str]:
    return [key for key in keys if not env_map.get(key, "").strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Preflight checker for payment provider cutover. "
            "Validates merchant env, webhook secret, return URL, and sandbox posture before live launch."
        )
    )
    parser.add_argument("--env-file", default=".env", help="Path to the env file used by ai-subservice")
    parser.add_argument(
        "--require-live",
        action="store_true",
        help="Fail if PAYMENT_ALLOW_SANDBOX_CHECKOUT is still enabled or provider credentials are incomplete",
    )
    args = parser.parse_args()

    env_map = _parse_env_file(Path(args.env_file))
    provider = (env_map.get("PAYMENT_PROVIDER", "stripe").strip().lower() or "stripe")

    print("== Payment Provider Preflight ==")
    print(f"env_file: {args.env_file}")
    print(f"provider: {provider}")
    print("")

    ok_all = True

    if provider not in SUPPORTED_PROVIDERS:
        print(f"[ERR] Unsupported PAYMENT_PROVIDER: {provider}")
        return 2

    provider_requirements = {
      "stripe": ["STRIPE_SECRET_KEY"],
      "alipay": ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY"],
      "wechatpay": ["WECHATPAY_MCH_ID", "WECHATPAY_PRIVATE_KEY", "WECHATPAY_SERIAL_NO"],
    }
    missing_provider_keys = _check_required(env_map, provider_requirements[provider])
    if missing_provider_keys:
        ok_all = False
        print(f"[ERR] Missing provider credentials: {', '.join(missing_provider_keys)}")
    else:
        print(f"[OK] Provider credentials present for {provider}")

    if env_map.get("PAYMENT_WEBHOOK_HMAC_SECRET", "").strip():
        print("[OK] PAYMENT_WEBHOOK_HMAC_SECRET is configured")
    else:
        ok_all = False
        print("[ERR] PAYMENT_WEBHOOK_HMAC_SECRET is missing")

    return_url = env_map.get("PAYMENT_RETURN_URL", "").strip()
    if return_url:
        print(f"[OK] PAYMENT_RETURN_URL={return_url}")
    else:
        ok_all = False
        print("[ERR] PAYMENT_RETURN_URL is missing")

    public_base_url = env_map.get("PUBLIC_BASE_URL", "").strip()
    if public_base_url:
        print(f"[OK] PUBLIC_BASE_URL={public_base_url}")
    else:
        ok_all = False
        print("[ERR] PUBLIC_BASE_URL is missing")

    sandbox_allowed = _is_truthy(env_map.get("PAYMENT_ALLOW_SANDBOX_CHECKOUT"))
    if sandbox_allowed:
        message = "[WARN] PAYMENT_ALLOW_SANDBOX_CHECKOUT is still enabled"
        if args.require_live:
            ok_all = False
            message = "[ERR] PAYMENT_ALLOW_SANDBOX_CHECKOUT must be disabled for live cutover"
        print(message)
    else:
        print("[OK] Sandbox checkout is disabled")

    print("")
    if ok_all:
        print("[OK] Payment provider preflight PASS.")
        print("Recommended next step: run a canary checkout, webhook callback, and reconciliation drill.")
        return 0

    print("[ERR] Payment provider preflight FAIL.")
    print("Suggested fix order:")
    print("1) Fill merchant credentials for the selected provider.")
    print("2) Set PAYMENT_WEBHOOK_HMAC_SECRET and PAYMENT_RETURN_URL.")
    print("3) Set PUBLIC_BASE_URL to the production API/console domain.")
    print("4) Disable PAYMENT_ALLOW_SANDBOX_CHECKOUT before live launch.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
