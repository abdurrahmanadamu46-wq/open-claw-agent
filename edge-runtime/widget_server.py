"""
WidgetServer — 官网嵌入式对话小部件服务

职责：
- 管理租户 widget 配置
- 生成嵌入脚本与 loader.js
- 管理匿名访客会话
- 将访客消息交给外部 reply_handler
- 将高意向访客回传给 lead_sink
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

logger = logging.getLogger("widget_server")

CONFIG_PATH = Path(__file__).resolve().parent / "data" / "widget_configs.json"

ReplyHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
LeadSink = Callable[[dict[str, Any]], Awaitable[None]]


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _stable_widget_id(tenant_id: str) -> str:
    digest = hashlib.sha1(str(tenant_id or "tenant_main").encode("utf-8")).hexdigest()
    return f"wid_{digest[:12]}"


@dataclass(slots=True)
class WidgetConfig:
    tenant_id: str
    widget_id: str
    enabled: bool = True
    allowed_origins: list[str] = field(default_factory=list)
    welcome_message: str = "你好，我是回声虾，有什么想先了解的？"
    theme_primary: str = "#14b8a6"
    accent_color: str = "#0f172a"
    custom_css: str = ""
    call_to_action: str = "留下联系方式，安排顾问跟进"
    launcher_label: str = "咨询"
    auto_open: bool = False
    capture_mode: str = "catcher_on_lead"
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class WidgetServer:
    def __init__(self, config_path: Path = CONFIG_PATH) -> None:
        self._config_path = config_path
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._configs: dict[str, WidgetConfig] = {}
        self._sessions: dict[str, dict[str, Any]] = {}
        self._reply_handler: ReplyHandler | None = None
        self._lead_sink: LeadSink | None = None
        self._load_configs()

    def set_handlers(
        self,
        *,
        reply_handler: ReplyHandler | None = None,
        lead_sink: LeadSink | None = None,
    ) -> None:
        if reply_handler is not None:
            self._reply_handler = reply_handler
        if lead_sink is not None:
            self._lead_sink = lead_sink

    def get_config(self, tenant_id: str) -> dict[str, Any]:
        with self._lock:
            config = self._configs.get(str(tenant_id or "tenant_main"))
            if config is None:
                config = WidgetConfig(
                    tenant_id=str(tenant_id or "tenant_main"),
                    widget_id=_stable_widget_id(tenant_id),
                )
                self._configs[config.tenant_id] = config
                self._persist_configs()
            payload = config.to_dict()
            payload["embed_script"] = self.get_embed_script(config.widget_id)
            return payload

    def update_config(self, tenant_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        safe_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        current = WidgetConfig(**{k: v for k, v in self.get_config(safe_tenant).items() if k in WidgetConfig.__dataclass_fields__})
        if patch.get("widget_id"):
            current.widget_id = str(patch["widget_id"]).strip()[:64] or current.widget_id
        origins_patch = patch.get("allowed_origins")
        if origins_patch is None:
            origins_patch = patch.get("allowed_domains")
        if origins_patch is not None:
            current.allowed_origins = [
                str(item).strip()
                for item in origins_patch
                if str(item).strip()
            ]
        if patch.get("welcome_message") is not None:
            current.welcome_message = str(patch["welcome_message"] or "").strip()[:400] or current.welcome_message
        theme_patch = patch.get("theme_primary")
        if theme_patch is None:
            theme_patch = patch.get("theme_color")
        if theme_patch is not None:
            current.theme_primary = str(theme_patch or "").strip()[:20] or current.theme_primary
        if patch.get("accent_color") is not None:
            current.accent_color = str(patch["accent_color"] or "").strip()[:20] or current.accent_color
        if patch.get("custom_css") is not None:
            current.custom_css = str(patch["custom_css"] or "").strip()[:4000]
        if patch.get("call_to_action") is not None:
            current.call_to_action = str(patch["call_to_action"] or "").strip()[:120] or current.call_to_action
        if patch.get("launcher_label") is not None:
            current.launcher_label = str(patch["launcher_label"] or "").strip()[:40] or current.launcher_label
        elif patch.get("call_to_action") is not None:
            current.launcher_label = str(patch["call_to_action"] or "").strip()[:40] or current.launcher_label
        if patch.get("auto_open") is not None:
            current.auto_open = bool(patch.get("auto_open"))
        if patch.get("enabled") is not None:
            current.enabled = bool(patch.get("enabled"))
        if patch.get("capture_mode") is not None:
            current.capture_mode = str(patch["capture_mode"] or "").strip()[:40] or current.capture_mode
        current.updated_at = _utc_now()
        with self._lock:
            self._configs[current.tenant_id] = current
            self._persist_configs()
        payload = current.to_dict()
        payload["embed_script"] = self.get_embed_script(current.widget_id)
        return payload

    def get_config_by_widget(self, widget_id: str) -> dict[str, Any]:
        safe_widget_id = str(widget_id or "").strip()
        with self._lock:
            for config in self._configs.values():
                if config.widget_id == safe_widget_id:
                    payload = config.to_dict()
                    payload["embed_script"] = self.get_embed_script(config.widget_id)
                    return payload
        return {}

    def get_embed_script(self, widget_id: str, base_url: str = "") -> str:
        base = str(base_url or "").rstrip("/")
        path = f"{base}/api/v1/widget/script/{widget_id}" if base else f"/api/v1/widget/script/{widget_id}"
        return f'<script async src="{path}"></script>'

    def render_loader_script(self, widget_id: str, base_url: str = "") -> str:
        config = self.get_config_by_widget(widget_id)
        if not config:
            return "console.error('OpenClaw widget: widget not found');"
        base = str(base_url or "").rstrip("/")
        api_message = f"{base}/api/v1/widget/message" if base else "/api/v1/widget/message"
        api_close_base = f"{base}/api/v1/widget" if base else "/api/v1/widget"
        welcome = json.dumps(config["welcome_message"], ensure_ascii=False)
        launcher_label = json.dumps(config["launcher_label"], ensure_ascii=False)
        theme_primary = json.dumps(config["theme_primary"], ensure_ascii=False)
        widget_id_json = json.dumps(widget_id, ensure_ascii=False)
        auto_open = "true" if config.get("auto_open") else "false"
        return f"""
(function() {{
  if (window.__OPENCLAW_WIDGET_LOADED__) return;
  window.__OPENCLAW_WIDGET_LOADED__ = true;
  var widgetId = {widget_id_json};
  var apiMessage = {json.dumps(api_message)};
  var apiCloseBase = {json.dumps(api_close_base)};
  var themePrimary = {theme_primary};
  var welcomeMessage = {welcome};
  var launcherLabel = {launcher_label};
  var sessionId = '';
  var host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.right = '20px';
  host.style.bottom = '20px';
  host.style.zIndex = '2147483000';
  host.style.fontFamily = 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = launcherLabel;
  button.style.cssText = 'border:none;border-radius:999px;padding:14px 18px;background:' + themePrimary + ';color:#fff;font-weight:600;box-shadow:0 10px 30px rgba(2,6,23,.25);cursor:pointer;';
  var panel = document.createElement('div');
  panel.style.cssText = 'display:none;width:360px;max-width:calc(100vw - 24px);height:520px;background:#07111f;color:#e2e8f0;border:1px solid rgba(100,116,139,.35);border-radius:18px;box-shadow:0 20px 50px rgba(2,6,23,.45);overflow:hidden;margin-bottom:12px;';
  var header = document.createElement('div');
  header.style.cssText = 'padding:14px 16px;background:rgba(15,23,42,.92);border-bottom:1px solid rgba(100,116,139,.28);font-weight:700;';
  header.textContent = 'OpenClaw 咨询窗口';
  var body = document.createElement('div');
  body.style.cssText = 'height:390px;overflow:auto;padding:16px;background:linear-gradient(180deg,#0b1220,#111827);';
  var footer = document.createElement('div');
  footer.style.cssText = 'padding:12px;border-top:1px solid rgba(100,116,139,.2);display:flex;gap:8px;background:#07111f;';
  var input = document.createElement('textarea');
  input.rows = 2;
  input.placeholder = '输入你的问题...';
  input.style.cssText = 'flex:1;resize:none;border:1px solid rgba(100,116,139,.35);border-radius:12px;background:#0f172a;color:#e2e8f0;padding:10px 12px;';
  var send = document.createElement('button');
  send.type = 'button';
  send.textContent = '发送';
  send.style.cssText = 'border:none;border-radius:12px;padding:0 16px;background:' + themePrimary + ';color:#fff;font-weight:600;cursor:pointer;';
  function bubble(role, text) {{
    var row = document.createElement('div');
    row.style.marginBottom = '12px';
    var card = document.createElement('div');
    card.textContent = text;
    card.style.whiteSpace = 'pre-wrap';
    card.style.lineHeight = '1.55';
    card.style.padding = '10px 12px';
    card.style.borderRadius = '14px';
    card.style.maxWidth = '88%';
    if (role === 'user') {{
      row.style.textAlign = 'right';
      card.style.marginLeft = 'auto';
      card.style.background = 'rgba(20,184,166,.18)';
      card.style.border = '1px solid rgba(20,184,166,.25)';
    }} else {{
      card.style.background = 'rgba(15,23,42,.95)';
      card.style.border = '1px solid rgba(100,116,139,.2)';
    }}
    row.appendChild(card);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }}
  async function sendMessage() {{
    var text = input.value.trim();
    if (!text) return;
    bubble('user', text);
    input.value = '';
    send.disabled = true;
    try {{
      var resp = await fetch(apiMessage, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          widget_id: widgetId,
          session_id: sessionId || undefined,
          message: text,
          visitor_meta: {{
            page_url: window.location.href,
            title: document.title,
            referrer: document.referrer || ''
          }}
        }})
      }});
      var data = await resp.json();
      if (data && data.session_id) sessionId = data.session_id;
      bubble('assistant', (data && data.reply) ? String(data.reply) : '暂时无法响应，请稍后再试。');
    }} catch (err) {{
      bubble('assistant', '网络有点忙，请稍后再试。');
    }} finally {{
      send.disabled = false;
    }}
  }}
  send.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e) {{
    if (e.key === 'Enter' && !e.shiftKey) {{
      e.preventDefault();
      sendMessage();
    }}
  }});
  panel.appendChild(header);
  panel.appendChild(body);
  footer.appendChild(input);
  footer.appendChild(send);
  panel.appendChild(footer);
  host.appendChild(panel);
  host.appendChild(button);
  document.body.appendChild(host);
  bubble('assistant', welcomeMessage);
  button.addEventListener('click', function() {{
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }});
  if ({auto_open}) panel.style.display = 'block';
  window.addEventListener('beforeunload', function() {{
    if (!sessionId) return;
    navigator.sendBeacon(apiCloseBase + '/' + encodeURIComponent(sessionId) + '/close', JSON.stringify({{ widget_id: widgetId }}));
  }});
}})();
""".strip()

    async def handle_visitor_message(
        self,
        *,
        widget_id: str,
        session_id: str | None,
        message: str,
        visitor_meta: dict[str, Any] | None,
        origin: str = "",
    ) -> dict[str, Any]:
        config = self.get_config_by_widget(widget_id)
        if not config or not config.get("enabled", True):
            return {"ok": False, "error": "widget_not_found"}
        if not self._origin_allowed(config, origin):
            return {"ok": False, "error": "origin_not_allowed"}
        text = str(message or "").strip()
        if not text:
            return {"ok": False, "error": "message_required"}
        if not session_id:
            session_id = f"wss_{uuid.uuid4().hex[:12]}"
        session = self._sessions.setdefault(
            session_id,
            {
                "session_id": session_id,
                "widget_id": widget_id,
                "tenant_id": config["tenant_id"],
                "visitor_meta": dict(visitor_meta or {}),
                "messages": [],
                "created_at": _utc_now(),
                "updated_at": _utc_now(),
            },
        )
        session["updated_at"] = _utc_now()
        session["visitor_meta"] = {**dict(session.get("visitor_meta") or {}), **dict(visitor_meta or {})}
        session["messages"].append({"role": "user", "content": text, "at": _utc_now()})
        reply_payload = await self._generate_reply(config=config, session=session, message=text)
        reply_text = str(reply_payload.get("text") or "").strip() or "收到啦，我们先帮你梳理一下。"
        session["messages"].append({"role": "assistant", "content": reply_text, "at": _utc_now()})
        is_lead = self._is_lead(text, session.get("visitor_meta", {}), reply_payload)
        if is_lead:
            asyncio.create_task(self._emit_lead(session, reply_payload))
        return {
            "ok": True,
            "session_id": session_id,
            "reply": reply_text,
            "is_lead": is_lead,
            "show_cta": is_lead,
            "cta_text": "留下联系方式，安排顾问跟进" if is_lead else "",
        }

    async def close_session(self, session_id: str, widget_id: str | None = None) -> dict[str, Any]:
        session = self._sessions.pop(str(session_id or "").strip(), None)
        if not session:
            return {"ok": True, "status": "not_found"}
        if widget_id and str(session.get("widget_id") or "") != str(widget_id):
            return {"ok": False, "status": "widget_mismatch"}
        await self._emit_lead(session, {"closed": True})
        return {"ok": True, "status": "closed"}

    async def _generate_reply(self, *, config: dict[str, Any], session: dict[str, Any], message: str) -> dict[str, Any]:
        if self._reply_handler is not None:
            try:
                payload = await self._reply_handler(
                    {
                        "tenant_id": config["tenant_id"],
                        "widget_id": config["widget_id"],
                        "session_id": session["session_id"],
                        "message": message,
                        "history": list(session.get("messages", [])[-8:]),
                        "visitor_meta": dict(session.get("visitor_meta") or {}),
                        "config": config,
                    }
                )
                if isinstance(payload, dict):
                    return payload
            except Exception as exc:  # noqa: BLE001
                logger.warning("Widget reply handler failed: %s", exc)
        return {"text": self._fallback_reply(message)}

    async def _emit_lead(self, session: dict[str, Any], reply_payload: dict[str, Any]) -> None:
        if self._lead_sink is None:
            return
        try:
            await self._lead_sink(
                {
                    "tenant_id": session.get("tenant_id"),
                    "widget_id": session.get("widget_id"),
                    "session_id": session.get("session_id"),
                    "visitor_meta": dict(session.get("visitor_meta") or {}),
                    "messages": list(session.get("messages") or []),
                    "reply_payload": dict(reply_payload or {}),
                    "source": "embed_widget",
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Widget lead sink failed: %s", exc)

    def _origin_allowed(self, config: dict[str, Any], origin: str) -> bool:
        allowed = [str(item).strip() for item in config.get("allowed_origins", []) if str(item).strip()]
        if not allowed:
            return True
        host = urlparse(str(origin or "")).netloc.lower()
        if not host:
            return False
        return any(host == item.lower() or host.endswith("." + item.lower()) for item in allowed)

    @staticmethod
    def _is_lead(message: str, visitor_meta: dict[str, Any], reply_payload: dict[str, Any]) -> bool:
        text = f"{message} {json.dumps(visitor_meta, ensure_ascii=False)}".lower()
        if reply_payload.get("is_lead") is True:
            return True
        keywords = (
            "报价",
            "价格",
            "多少钱",
            "联系方式",
            "微信",
            "电话",
            "demo",
            "试用",
            "方案",
            "合作",
            "预约",
            "quote",
            "pricing",
            "contact",
            "call me",
            "wechat",
        )
        return any(token in text for token in keywords)

    @staticmethod
    def _fallback_reply(message: str) -> str:
        lowered = str(message or "").lower()
        if any(token in lowered for token in ("价格", "报价", "多少钱", "pricing", "quote")):
            return "可以的，我先帮你记录需求范围。如果方便，也可以留下联系方式，我们让顾问给你一版报价建议。"
        if any(token in lowered for token in ("demo", "演示", "试用", "案例")):
            return "可以安排，我们通常会先了解你的行业、目标和渠道，再给你匹配演示内容。"
        return "收到，我先帮你梳理下重点。如果你愿意，也可以继续说说你的行业、目标和当前卡点。"

    def _load_configs(self) -> None:
        with self._lock:
            if not self._config_path.exists():
                self._configs = {}
                return
            try:
                payload = json.loads(self._config_path.read_text(encoding="utf-8"))
            except Exception:
                self._configs = {}
                return
            self._configs = {}
            for item in payload.get("items", []):
                if not isinstance(item, dict):
                    continue
                try:
                    config = WidgetConfig(**item)
                except TypeError:
                    continue
                self._configs[config.tenant_id] = config

    def _persist_configs(self) -> None:
        with self._lock:
            payload = {"items": [config.to_dict() for config in self._configs.values()]}
            self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


_widget_server: WidgetServer | None = None


def get_widget_server() -> WidgetServer:
    global _widget_server
    if _widget_server is None:
        _widget_server = WidgetServer()
    return _widget_server
