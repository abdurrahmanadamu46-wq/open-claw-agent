#!/usr/bin/env python
from __future__ import annotations

import argparse
from pathlib import Path


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Preflight checker for notification channel cutover. "
            "Validates SMTP/SMS configuration and warns when file or mock delivery is still enabled."
        )
    )
    parser.add_argument("--env-file", default=".env", help="Path to the env file used by ai-subservice")
    parser.add_argument(
        "--require-live",
        action="store_true",
        help="Fail if notification mode is still file/sms-mock instead of a live provider",
    )
    args = parser.parse_args()

    env_map = _parse_env_file(Path(args.env_file))
    mode = (env_map.get("AUTH_NOTIFICATION_MODE", "file").strip().lower() or "file")

    print("== Notification Channel Preflight ==")
    print(f"env_file: {args.env_file}")
    print(f"mode: {mode}")
    print("")

    ok_all = True

    if mode == "smtp":
        required = ["SMTP_HOST", "SMTP_FROM_EMAIL"]
        missing = [key for key in required if not env_map.get(key, "").strip()]
        if missing:
            ok_all = False
            print(f"[ERR] Missing SMTP settings: {', '.join(missing)}")
        else:
            print("[OK] SMTP host and sender are configured")

        if env_map.get("SMTP_USERNAME", "").strip():
            print("[OK] SMTP_USERNAME is configured")
        else:
            print("[WARN] SMTP_USERNAME is empty; only continue if your provider supports anonymous auth")

        if env_map.get("SMTP_PASSWORD", "").strip():
            print("[OK] SMTP_PASSWORD is configured")
        else:
            print("[WARN] SMTP_PASSWORD is empty")
    elif mode in {"file", "sms-mock"}:
        message = f"[WARN] AUTH_NOTIFICATION_MODE is still {mode}"
        if args.require_live:
            ok_all = False
            message = f"[ERR] AUTH_NOTIFICATION_MODE={mode} is not acceptable for live launch"
        print(message)
    else:
        ok_all = False
        print(f"[ERR] Unsupported AUTH_NOTIFICATION_MODE={mode}")

    sms_mock_enabled = _is_truthy(env_map.get("SMS_MOCK_ENABLED", "true"))
    sms_webhook_configured = bool(env_map.get("SMS_PROVIDER_WEBHOOK", "").strip())
    print(f"SMS_MOCK_ENABLED={sms_mock_enabled}")
    print(f"SMS_PROVIDER_WEBHOOK configured={sms_webhook_configured}")
    if args.require_live and sms_mock_enabled:
        ok_all = False
        print("[ERR] SMS_MOCK_ENABLED must be false for live launch")

    reset_base_url = env_map.get("AUTH_RESET_BASE_URL", "").strip()
    if reset_base_url:
        print(f"[OK] AUTH_RESET_BASE_URL={reset_base_url}")
    else:
        ok_all = False
        print("[ERR] AUTH_RESET_BASE_URL is missing")

    print("")
    if ok_all:
        print("[OK] Notification channel preflight PASS.")
        print("Recommended next step: send a test notification and confirm outbox plus inbox delivery.")
        return 0

    print("[ERR] Notification channel preflight FAIL.")
    print("Suggested fix order:")
    print("1) Switch AUTH_NOTIFICATION_MODE to smtp for live launch.")
    print("2) Fill SMTP_HOST / SMTP_FROM_EMAIL / credentials or wire a real SMS webhook.")
    print("3) Set AUTH_RESET_BASE_URL to the public reset-password entrypoint.")
    print("4) Disable SMS_MOCK_ENABLED before production cutover.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
