from __future__ import annotations

import json
import os
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _notification_mode() -> str:
    return os.getenv("AUTH_NOTIFICATION_MODE", "file").strip().lower() or "file"


def _notification_dir() -> Path:
    raw = os.getenv("AUTH_NOTIFICATION_DIR", "./tmp/auth_notifications").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_file(kind: str, payload: dict[str, Any]) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    token = str(payload.get("token") or payload.get("email") or uuid.uuid4().hex)[:24]
    target = _notification_dir() / f"{kind}_{stamp}_{token}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(target)


def list_recent_notifications(limit: int = 20) -> list[dict[str, Any]]:
    bounded_limit = max(1, min(int(limit), 200))
    rows: list[dict[str, Any]] = []
    for path in sorted(_notification_dir().glob("*.json"), reverse=True)[:bounded_limit]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            payload = {}
        rows.append(
            {
                "file": str(path),
                "kind": str(payload.get("kind") or ""),
                "target": str(payload.get("email") or payload.get("target") or ""),
                "requested_at": str(payload.get("requested_at") or ""),
                "channel": str(payload.get("channel") or _notification_mode()),
            }
        )
    return rows


@dataclass(slots=True)
class NotificationResult:
    ok: bool
    mode: str
    kind: str
    target: str
    detail: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "mode": self.mode,
            "kind": self.kind,
            "target": self.target,
            "detail": self.detail,
        }


def _smtp_status() -> dict[str, Any]:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587").strip() or 587)
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    sender = os.getenv("SMTP_FROM_EMAIL", "").strip()
    return {
        "configured": bool(host and sender),
        "host": host,
        "port": port,
        "username_configured": bool(username),
        "password_configured": bool(password),
        "from_email": sender,
        "starttls": _env_bool("SMTP_STARTTLS", True),
        "ssl": _env_bool("SMTP_SSL", False),
    }


def notification_status() -> dict[str, Any]:
    return {
        "mode": _notification_mode(),
        "file_outbox": str(_notification_dir()),
        "smtp": _smtp_status(),
        "sms_mock_enabled": _env_bool("SMS_MOCK_ENABLED", True),
        "sms_webhook_configured": bool(os.getenv("SMS_PROVIDER_WEBHOOK", "").strip()),
    }


def _send_via_smtp(*, subject: str, text: str, to_email: str) -> NotificationResult:
    status = _smtp_status()
    if not status["configured"]:
        raise RuntimeError("smtp_not_configured")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = status["from_email"]
    message["To"] = to_email
    message.set_content(text)

    host = str(status["host"])
    port = int(status["port"])
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()

    if status["ssl"]:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as server:
            if username:
                server.login(username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            if status["starttls"]:
                server.starttls(context=ssl.create_default_context())
            if username:
                server.login(username, password)
            server.send_message(message)

    return NotificationResult(
        ok=True,
        mode="smtp",
        kind="email",
        target=to_email,
        detail={"subject": subject},
    )


def _send_sms_mock(*, kind: str, target: str, payload: dict[str, Any]) -> NotificationResult:
    file_path = _write_file(kind, {"channel": "sms_mock", "target": target, **payload})
    return NotificationResult(
        ok=True,
        mode="sms-mock",
        kind=kind,
        target=target,
        detail={"outbox_file": file_path},
    )


def send_password_reset_notification(*, email: str, token: str, tenant_id: str, username: str | None = None) -> NotificationResult:
    mode = _notification_mode()
    reset_base_url = os.getenv("AUTH_RESET_BASE_URL", "http://127.0.0.1:3301/reset-password").strip()
    reset_url = f"{reset_base_url}?token={token}"
    payload = {
        "kind": "reset_password",
        "email": email,
        "username": username,
        "tenant_id": tenant_id,
        "token": token,
        "reset_url": reset_url,
        "requested_at": _utc_now_iso(),
    }

    if mode == "smtp":
        text = (
            "Lobster Pool password reset\n\n"
            f"tenant: {tenant_id}\n"
            f"user: {username or email}\n"
            f"token: {token}\n"
            f"reset_url: {reset_url}\n"
        )
        return _send_via_smtp(subject="Lobster Pool password reset", text=text, to_email=email)

    if mode == "sms-mock":
        return _send_sms_mock(kind="reset_password", target=email, payload=payload)

    file_path = _write_file("reset_password", payload)
    return NotificationResult(
        ok=True,
        mode="file",
        kind="reset_password",
        target=email,
        detail={"outbox_file": file_path},
    )


def send_test_notification(*, target: str, text: str, kind: str = "test_notification") -> NotificationResult:
    mode = _notification_mode()
    payload = {
        "kind": kind,
        "target": target,
        "text": text,
        "requested_at": _utc_now_iso(),
    }

    if mode == "smtp":
        return _send_via_smtp(subject="Lobster Pool notification test", text=text, to_email=target)

    if mode == "sms-mock":
        return _send_sms_mock(kind=kind, target=target, payload=payload)

    file_path = _write_file(kind, payload)
    return NotificationResult(
        ok=True,
        mode="file",
        kind=kind,
        target=target,
        detail={"outbox_file": file_path},
    )


async def send_notification(
    *,
    tenant_id: str,
    message: str,
    level: str = "info",
    category: str = "system",
    target: str | None = None,
) -> NotificationResult:
    """
    Generic async notification helper used by runtime governance features.

    The current project does not yet have a unified multi-channel dispatcher, so
    notifications are routed through the existing file/smtp/mock modes.
    """

    resolved_target = str(
        target
        or os.getenv("OPERATIONS_NOTIFICATION_TARGET", "").strip()
        or os.getenv("SMTP_FROM_EMAIL", "").strip()
        or tenant_id
    ).strip()
    payload = {
        "kind": "runtime_notification",
        "tenant_id": tenant_id,
        "category": category,
        "level": level,
        "target": resolved_target,
        "text": message,
        "requested_at": _utc_now_iso(),
    }
    mode = _notification_mode()

    if mode == "smtp" and "@" in resolved_target:
        return _send_via_smtp(
            subject=f"Lobster Pool {category} ({level})",
            text=message,
            to_email=resolved_target,
        )

    if mode == "sms-mock":
        return _send_sms_mock(kind=f"{category}_{level}", target=resolved_target, payload=payload)

    file_path = _write_file(f"{category}_{level}", payload)
    return NotificationResult(
        ok=True,
        mode="file",
        kind=f"{category}_{level}",
        target=resolved_target,
        detail={"outbox_file": file_path},
    )
