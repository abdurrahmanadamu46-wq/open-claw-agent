#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen


def _read_bytes_from_url(url: str) -> bytes:
    with urlopen(url, timeout=90) as resp:  # nosec B310
        return resp.read()


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_payload(manifest: dict) -> bytes:
    payload = copy.deepcopy(manifest)
    payload.pop("signature", None)
    payload.pop("signature_alg", None)
    payload.pop("keyId", None)
    payload.pop("key_id", None)
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _default_version(runtime_dir: Path) -> str:
    version_file = runtime_dir / "VERSION"
    if version_file.exists():
        raw = version_file.read_text(encoding="utf-8", errors="ignore").strip()
        if raw:
            return raw
    return "0.0.0"


def _resolve_artifact_bytes(artifact_url: str, artifact_file: str | None) -> bytes:
    if artifact_file:
        return Path(artifact_file).read_bytes()
    if artifact_url.startswith("http://") or artifact_url.startswith("https://"):
        return _read_bytes_from_url(artifact_url)
    return Path(artifact_url).read_bytes()


def _normalize_artifact_url(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return "./runtime.zip"
    return value


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate signed desktop runtime manifest (HMAC-SHA256 + keyId rotation)."
    )
    parser.add_argument("--out", default="runtime/updates/stable.json", help="Output manifest path.")
    parser.add_argument("--channel", default=os.getenv("DESKTOP_UPDATE_CHANNEL", "stable"), help="Release channel.")
    parser.add_argument("--version", default="", help="Runtime version. Empty means read from runtime/VERSION.")
    parser.add_argument(
        "--artifact-url",
        default=os.getenv("DESKTOP_UPDATE_ARTIFACT_URL", "./runtime.zip"),
        help="Artifact URL (remote or local relative path).",
    )
    parser.add_argument(
        "--artifact-file",
        default=os.getenv("DESKTOP_UPDATE_ARTIFACT_FILE", ""),
        help="Local artifact file used for SHA256 (optional).",
    )
    parser.add_argument("--notes", default=os.getenv("DESKTOP_UPDATE_NOTES", ""), help="Release notes.")
    parser.add_argument(
        "--key-id",
        default=(
            os.getenv("DESKTOP_UPDATE_DEFAULT_KEY_ID")
            or os.getenv("DRAGON_UPDATE_DEFAULT_KEY_ID")
            or "dev-hmac"
        ),
        help="Signing keyId (used for key rotation).",
    )
    parser.add_argument(
        "--hmac-secret",
        default=os.getenv("DESKTOP_UPDATE_SIGNING_SECRET") or os.getenv("DRAGON_UPDATE_SIGNING_SECRET") or "",
        help="HMAC secret for signature.",
    )
    parser.add_argument(
        "--published-at",
        default="",
        help="RFC3339 time. Empty means now UTC.",
    )
    parser.add_argument(
        "--extra-json",
        default="",
        help='Extra top-level JSON fields, e.g. {"min_app_version":"1.2.0"}',
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    out_path = Path(args.out).resolve()
    runtime_dir = Path(__file__).resolve().parents[1] / "runtime"

    version = (args.version or "").strip() or _default_version(runtime_dir)
    artifact_url = _normalize_artifact_url(args.artifact_url)
    artifact_file = (args.artifact_file or "").strip() or None
    published_at = (args.published_at or "").strip() or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    key_id = (args.key_id or "").strip()
    secret = (args.hmac_secret or "").strip()

    if not key_id:
        raise SystemExit("key_id missing: provide --key-id or DESKTOP_UPDATE_DEFAULT_KEY_ID")
    if not secret:
        raise SystemExit("hmac secret missing: provide --hmac-secret or DESKTOP_UPDATE_SIGNING_SECRET")

    artifact_bytes = _resolve_artifact_bytes(artifact_url, artifact_file)
    artifact_sha = _sha256_hex(artifact_bytes)

    manifest: dict = {
        "channel": args.channel,
        "version": version,
        "published_at": published_at,
        "notes": args.notes,
        "artifact": {
            "url": artifact_url,
            "sha256": artifact_sha,
        },
        "keyId": key_id,
        "signature_alg": "hmac-sha256",
    }

    if args.extra_json.strip():
        extra = json.loads(args.extra_json)
        if not isinstance(extra, dict):
            raise SystemExit("--extra-json must be a JSON object")
        manifest.update(extra)

    payload = _canonical_payload(manifest)
    signature = base64.b64encode(hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()).decode("ascii")
    manifest["signature"] = signature

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source = artifact_file or artifact_url
    if artifact_url.startswith("http://") or artifact_url.startswith("https://"):
        origin = urlparse(artifact_url).netloc
    else:
        origin = "local-file"

    print(f"[manifest] written: {out_path}")
    print(f"[manifest] channel={args.channel} version={version}")
    print(f"[manifest] keyId={key_id} alg=hmac-sha256")
    print(f"[manifest] artifact_source={source}")
    print(f"[manifest] artifact_origin={origin}")
    print(f"[manifest] artifact_sha256={artifact_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
