from __future__ import annotations

import hashlib
import hmac
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any


SUPPORTED_PROVIDERS = {"stripe", "alipay", "wechatpay"}


def _safe_slug(raw: str, fallback: str = "stripe") -> str:
    value = "".join(ch if (ch.isalnum() or ch in {"_", "-"}) else "_" for ch in (raw or "").strip().lower())
    value = value.strip("_")
    return value[:64] or fallback


def _utc_ts() -> int:
    return int(time.time())


def _provider_ready(provider: str) -> bool:
    if provider == "stripe":
        return bool(os.getenv("STRIPE_SECRET_KEY", "").strip())
    if provider == "alipay":
        return bool(os.getenv("ALIPAY_APP_ID", "").strip() and os.getenv("ALIPAY_PRIVATE_KEY", "").strip())
    if provider == "wechatpay":
        return bool(
            os.getenv("WECHATPAY_MCH_ID", "").strip()
            and os.getenv("WECHATPAY_PRIVATE_KEY", "").strip()
            and os.getenv("WECHATPAY_SERIAL_NO", "").strip()
        )
    return False


def _sandbox_checkout_allowed() -> bool:
    raw = os.getenv("PAYMENT_ALLOW_SANDBOX_CHECKOUT", "").strip().lower()
    if not raw:
        return True
    return raw in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class CheckoutIntent:
    provider: str
    checkout_id: str
    order_id: str
    amount_cny: int
    currency: str
    checkout_url: str
    status: str
    metadata: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "checkout_id": self.checkout_id,
            "order_id": self.order_id,
            "amount_cny": self.amount_cny,
            "currency": self.currency,
            "checkout_url": self.checkout_url,
            "status": self.status,
            "metadata": self.metadata,
        }


@dataclass(slots=True)
class WebhookDecision:
    ok: bool
    provider: str
    event_id: str
    action: str
    reason: str
    payload: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "provider": self.provider,
            "event_id": self.event_id,
            "action": self.action,
            "reason": self.reason,
            "payload": self.payload,
        }


class PaymentGateway:
    def __init__(self) -> None:
        configured = _safe_slug(os.getenv("PAYMENT_PROVIDER", "stripe"), fallback="stripe")
        self.default_provider = configured if configured in SUPPORTED_PROVIDERS else "stripe"

    def provider_health(self) -> dict[str, Any]:
        providers: dict[str, dict[str, Any]] = {}
        for provider in sorted(SUPPORTED_PROVIDERS):
            providers[provider] = {
                "enabled": self.default_provider == provider,
                "ready": _provider_ready(provider),
            }
        return {"default_provider": self.default_provider, "providers": providers}

    def create_checkout_intent(
        self,
        *,
        user_id: str,
        tenant_id: str,
        plan_code: str,
        cycle: str,
        amount_cny: int,
        provider: str | None = None,
        return_url: str | None = None,
    ) -> CheckoutIntent:
        selected = _safe_slug(provider or self.default_provider, fallback=self.default_provider)
        if selected not in SUPPORTED_PROVIDERS:
            raise RuntimeError(f"unsupported_payment_provider:{selected}")
        sandbox_mode = False
        if not _provider_ready(selected):
            if _sandbox_checkout_allowed():
                sandbox_mode = True
            else:
                raise RuntimeError(f"payment_provider_not_ready:{selected}")

        order_id = f"ord_{uuid.uuid4().hex[:16]}"
        checkout_id = f"chk_{uuid.uuid4().hex[:16]}"
        base_return = (return_url or os.getenv("PAYMENT_RETURN_URL", "http://127.0.0.1:3301/billing/return")).strip()

        # NOTE:
        # This gateway intentionally keeps a provider-agnostic contract.
        # Real SDK integration can replace checkout_url generation per provider
        # while preserving app-layer behavior and schema.
        checkout_url = f"{base_return}?provider={selected}&checkout_id={checkout_id}&order_id={order_id}&status={'sandbox' if sandbox_mode else 'redirect'}"
        status = "sandbox_checkout_url_ready" if sandbox_mode else "checkout_url_ready_pending_provider_redirect"

        return CheckoutIntent(
            provider=selected,
            checkout_id=checkout_id,
            order_id=order_id,
            amount_cny=max(0, int(amount_cny)),
            currency="CNY",
            checkout_url=checkout_url,
            status=status,
            metadata={
                "user_id": user_id,
                "tenant_id": tenant_id,
                "plan_code": plan_code,
                "cycle": cycle,
                "created_at_ts": _utc_ts(),
                "sandbox_mode": sandbox_mode,
            },
        )

    def verify_webhook(
        self,
        *,
        provider: str | None,
        body_raw: str,
        signature: str | None = None,
        event_id: str | None = None,
        action: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> WebhookDecision:
        selected = _safe_slug(provider or self.default_provider, fallback=self.default_provider)
        if selected not in SUPPORTED_PROVIDERS:
            return WebhookDecision(
                ok=False,
                provider=selected,
                event_id=(event_id or f"evt_{uuid.uuid4().hex[:14]}")[:64],
                action=_safe_slug(action or "payment_succeeded", fallback="payment_succeeded"),
                reason="unsupported_provider",
                payload=payload or {},
            )

        safe_event_id = (event_id or f"evt_{uuid.uuid4().hex[:14]}")[:64]
        safe_action = _safe_slug(action or "payment_succeeded", fallback="payment_succeeded")
        safe_payload = payload or {}

        secret = os.getenv("PAYMENT_WEBHOOK_HMAC_SECRET", "").strip()
        if not secret:
            return WebhookDecision(
                ok=False,
                provider=selected,
                event_id=safe_event_id,
                action=safe_action,
                reason="missing_webhook_secret",
                payload=safe_payload,
            )

        digest = hmac.new(secret.encode("utf-8"), body_raw.encode("utf-8"), hashlib.sha256).hexdigest()
        expected = f"sha256={digest}"
        if not signature or not hmac.compare_digest(signature, expected):
            return WebhookDecision(
                ok=False,
                provider=selected,
                event_id=safe_event_id,
                action=safe_action,
                reason="invalid_signature",
                payload=safe_payload,
            )

        return WebhookDecision(
            ok=True,
            provider=selected,
            event_id=safe_event_id,
            action=safe_action,
            reason="signature_verified",
            payload=safe_payload,
        )


payment_gateway = PaymentGateway()
