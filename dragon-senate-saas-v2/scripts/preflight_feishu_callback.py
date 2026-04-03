#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _parse_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    return data


def _http_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 10,
    insecure: bool = False,
) -> tuple[bool, int, str]:
    body = None
    headers = {"User-Agent": "dragon-feishu-preflight/1.0"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, data=body, headers=headers, method=method)
    context = ssl._create_unverified_context() if insecure else None
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return True, int(resp.status), text
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        return False, int(exc.code), text
    except Exception as exc:  # noqa: BLE001
        return False, -1, str(exc)


def _check_dns(host: str) -> tuple[bool, list[str], str]:
    try:
        _name, _aliases, addrs = socket.gethostbyname_ex(host)
    except Exception as exc:  # noqa: BLE001
        return False, [], str(exc)
    uniq = sorted({a for a in addrs if a})
    if not uniq:
        return False, [], "dns resolves empty address list"
    return True, uniq, ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Preflight checker for Feishu callback URL. "
            "Checks DNS -> local challenge -> public health/challenge -> env consistency."
        )
    )
    parser.add_argument(
        "--public-url",
        help="Public callback URL, e.g. https://api.example.com/webhook/chat_gateway. If omitted, derive from PUBLIC_BASE_URL in env-file.",
    )
    parser.add_argument(
        "--local-base-url",
        default="http://127.0.0.1:18000",
        help="Local backend base URL used for local challenge self-test",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to .env to verify FEISHU_* variables",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Skip TLS cert verification for testing only",
    )
    args = parser.parse_args()

    env_path = Path(args.env_file)
    env_map = _parse_env_file(env_path)

    public = (args.public_url or "").strip().rstrip("/")
    if not public:
        public_base_url = env_map.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
        if public_base_url:
            public = f"{public_base_url}/webhook/chat_gateway"

    if not public:
        print("[ERR] public-url missing and PUBLIC_BASE_URL is not set in env-file")
        return 2

    parsed = urllib.parse.urlparse(public)
    if not parsed.scheme or not parsed.netloc:
        print("[ERR] public-url invalid: must be full URL")
        return 2
    if not parsed.path.endswith("/webhook/chat_gateway"):
        print("[WARN] callback path should end with /webhook/chat_gateway")

    host = parsed.hostname or ""
    print(f"== Feishu Callback Preflight ==")
    print(f"public_url: {public}")
    print(f"local_base: {args.local_base_url}")
    print("")

    ok_all = True

    # 1) DNS
    dns_ok, dns_addrs, dns_err = _check_dns(host)
    if dns_ok:
        print(f"[OK] DNS: {host} -> {', '.join(dns_addrs)}")
    else:
        ok_all = False
        print(f"[ERR] DNS: {host} resolve failed: {dns_err}")

    # 2) local challenge
    local_url = args.local_base_url.rstrip("/") + "/webhook/chat_gateway"
    local_ok, local_code, local_text = _http_json(
        local_url,
        method="POST",
        payload={"type": "url_verification", "challenge": "dragon-local-ok"},
        timeout=8,
    )
    if local_ok and local_code == 200 and "dragon-local-ok" in local_text:
        print(f"[OK] Local challenge: {local_url} ({local_code})")
    else:
        ok_all = False
        print(f"[ERR] Local challenge failed: code={local_code}, body={local_text[:220]}")

    # 3) public healthz
    health_url = f"{parsed.scheme}://{parsed.netloc}/healthz"
    pub_h_ok, pub_h_code, pub_h_text = _http_json(health_url, timeout=12, insecure=args.insecure)
    if pub_h_ok and pub_h_code == 200:
        print(f"[OK] Public healthz: {health_url} ({pub_h_code})")
    else:
        ok_all = False
        print(f"[ERR] Public healthz failed: code={pub_h_code}, detail={pub_h_text[:220]}")

    # 4) public challenge
    pub_c_ok, pub_c_code, pub_c_text = _http_json(
        public,
        method="POST",
        payload={"type": "url_verification", "challenge": "dragon-public-ok"},
        timeout=12,
        insecure=args.insecure,
    )
    if pub_c_ok and pub_c_code == 200 and "dragon-public-ok" in pub_c_text:
        print(f"[OK] Public challenge: {public} ({pub_c_code})")
    else:
        ok_all = False
        print(f"[ERR] Public challenge failed: code={pub_c_code}, body={pub_c_text[:300]}")

    # 5) env consistency
    feishu_enabled = env_map.get("FEISHU_ENABLED", "").strip().lower()
    reply_mode = env_map.get("FEISHU_REPLY_MODE", "").strip().lower()
    app_id = bool(env_map.get("FEISHU_APP_ID"))
    app_secret = bool(env_map.get("FEISHU_APP_SECRET"))
    verify_sig = env_map.get("FEISHU_VERIFY_SIGNATURE", "").strip().lower() in {"1", "true", "yes", "on"}
    token = bool(env_map.get("FEISHU_VERIFICATION_TOKEN"))
    sign_secret = bool(env_map.get("FEISHU_SIGNING_SECRET"))

    print("")
    print("== FEISHU env consistency ==")
    print(f"FEISHU_ENABLED={feishu_enabled or '(missing)'}")
    print(f"FEISHU_REPLY_MODE={reply_mode or '(missing)'}")
    print(f"FEISHU_APP_ID set={app_id}, FEISHU_APP_SECRET set={app_secret}")
    print(f"FEISHU_VERIFY_SIGNATURE={verify_sig}, token set={token}, signing_secret set={sign_secret}")

    if feishu_enabled not in {"true", "1", "yes", "on"}:
        print("[WARN] FEISHU_ENABLED is not true")
    if reply_mode not in {"webhook", "openapi"}:
        print("[WARN] FEISHU_REPLY_MODE should be webhook or openapi")
    if reply_mode == "openapi" and (not app_id or not app_secret):
        ok_all = False
        print("[ERR] openapi mode requires FEISHU_APP_ID + FEISHU_APP_SECRET")
    if verify_sig and (not token and not sign_secret):
        ok_all = False
        print("[ERR] signature verify enabled but FEISHU_VERIFICATION_TOKEN/FEISHU_SIGNING_SECRET missing")

    print("")
    if ok_all:
        print("[OK] Preflight PASS: callback URL should pass Feishu subscription validation.")
        return 0

    print("[ERR] Preflight FAIL: fix the failed checks above, then re-run.")
    print("Suggested first fixes:")
    print("1) Ensure domain DNS A record exists for callback host.")
    print("2) Ensure 443 is reachable and reverse-proxy points to backend /webhook/chat_gateway.")
    print("3) Ensure FEISHU_* env values match Feishu console settings.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
