"""
SSRFGuard — SSRF 防护中间件
============================
灵感来源：ClawTeam-OpenClaw (board/server.py _is_blocked_hostname + _normalize_proxy_target)
借鉴要点：
  - 阻止请求访问 localhost / 内网 IP / link-local / multicast / reserved
  - 仅允许 HTTPS（拒绝 HTTP/FTP 等）
  - 允许列表白名单机制（可配置）
  - FastAPI 依赖注入 + Starlette 中间件双模式

使用方式（FastAPI 依赖）：
    from ssrf_guard import validate_url_no_ssrf

    @app.post("/api/fetch-external")
    def fetch_url(url: str, _=Depends(validate_url_no_ssrf(url))):
        ...

使用方式（Starlette 中间件）：
    app.add_middleware(SSRFGuardMiddleware,
                       check_params=["url", "webhook_url", "callback"])
"""

from __future__ import annotations

import ipaddress
import os
import socket
from typing import Optional
from urllib.parse import urlparse

# 默认允许的外部域名白名单（仅用于代理场景）
_DEFAULT_ALLOWED_HOSTS = {
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com",
    "api.openai.com",
    "api.anthropic.com",
    "openrouter.ai",
}

# 从环境变量追加白名单
_EXTRA_ALLOWED = set(
    h.strip() for h in os.getenv("SSRF_ALLOWED_HOSTS", "").split(",") if h.strip()
)
ALLOWED_HOSTS = _DEFAULT_ALLOWED_HOSTS | _EXTRA_ALLOWED


# ─────────────────────────────────────────────────────────────────
# 核心检测函数
# ─────────────────────────────────────────────────────────────────

class SSRFError(ValueError):
    """SSRF 风险检测异常"""


def is_blocked_hostname(hostname: str) -> bool:
    """
    检测主机名是否为内网/危险地址（对应 ClawTeam _is_blocked_hostname）。
    阻止：localhost / 127.x / 10.x / 192.168.x / 172.16-31.x / 169.254.x / ::1 等。
    """
    host = hostname.strip().lower()

    # 直接匹配 localhost
    if host in {"localhost", "localhost.localdomain"}:
        return True

    # 尝试解析为 IP
    try:
        ip = ipaddress.ip_address(host)
        return (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        )
    except ValueError:
        pass

    # DNS 解析后再检查（防止 DNS rebinding）
    try:
        resolved_ips = socket.getaddrinfo(host, None)
        for _, _, _, _, sockaddr in resolved_ips:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                if (ip.is_loopback or ip.is_private or ip.is_link_local
                        or ip.is_multicast or ip.is_reserved):
                    return True
            except ValueError:
                continue
    except (socket.gaierror, OSError):
        # DNS 解析失败：保守处理，不阻止（避免误杀合法域名）
        pass

    return False


def validate_url(
    url: str,
    allow_http: bool = False,
    allowed_hosts: Optional[set[str]] = None,
    require_allowlist: bool = False,
) -> str:
    """
    验证 URL 是否安全（对应 ClawTeam _normalize_proxy_target）。
    返回清理后的 URL，或抛出 SSRFError。

    参数：
        url              : 待验证的 URL
        allow_http       : 是否允许 HTTP（默认只允许 HTTPS）
        allowed_hosts    : 自定义白名单（为 None 时用全局白名单）
        require_allowlist: 是否强制要求在白名单内
    """
    if not url or not url.strip():
        raise SSRFError("URL 不能为空")

    parsed = urlparse(url.strip())

    # 协议检查
    if parsed.scheme == "http" and not allow_http:
        raise SSRFError(f"拒绝 HTTP 协议（请使用 HTTPS）: {url}")
    if parsed.scheme not in {"http", "https"}:
        raise SSRFError(f"不支持的协议 '{parsed.scheme}'，仅允许 HTTPS: {url}")

    # 主机名检查
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise SSRFError(f"URL 缺少主机名: {url}")

    if is_blocked_hostname(hostname):
        raise SSRFError(f"拒绝访问内网/本地地址: {hostname}")

    # 白名单检查（可选）
    hosts = allowed_hosts if allowed_hosts is not None else ALLOWED_HOSTS
    if require_allowlist and hostname not in hosts:
        raise SSRFError(f"主机名不在白名单内: {hostname}")

    return url.strip()


def is_safe_url(url: str, **kwargs) -> bool:
    """validate_url 的布尔版本（不抛异常）"""
    try:
        validate_url(url, **kwargs)
        return True
    except SSRFError:
        return False


# ─────────────────────────────────────────────────────────────────
# FastAPI 依赖 + 中间件
# ─────────────────────────────────────────────────────────────────

def make_ssrf_guard_dependency(
    allow_http: bool = False,
    require_allowlist: bool = False,
):
    """
    创建 FastAPI 依赖，检查查询参数/请求体中的 URL。
    用法：
        @app.get("/proxy")
        def proxy(url: str, _=Depends(ssrf_dep)):
    """
    try:
        from fastapi import HTTPException, Query

        def _dep(url: str = Query(..., description="外部 URL")):
            try:
                return validate_url(url, allow_http=allow_http,
                                     require_allowlist=require_allowlist)
            except SSRFError as e:
                raise HTTPException(status_code=400, detail=f"SSRF 防护拦截: {e}")

        return _dep
    except ImportError:
        return None


def make_ssrf_middleware():
    """
    创建 Starlette/FastAPI 中间件，检查请求参数中的 URL 字段。
    在 app.add_middleware() 中使用。
    """
    try:
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.requests import Request
        from starlette.responses import JSONResponse

        _SUSPICIOUS_PARAMS = {
            "url", "webhook_url", "callback", "redirect_url",
            "target", "endpoint", "proxy", "dest", "next",
        }

        class SSRFGuardMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request: Request, call_next):
                # 检查查询参数
                for param_name, value in request.query_params.items():
                    if param_name.lower() in _SUSPICIOUS_PARAMS:
                        if not is_safe_url(value):
                            return JSONResponse(
                                {"error": f"SSRF 防护拦截参数 '{param_name}': {value}"},
                                status_code=400,
                            )
                return await call_next(request)

        return SSRFGuardMiddleware
    except ImportError:
        return None


# ─────────────────────────────────────────────────────────────────
# FastAPI Router（运维管理接口）
# ─────────────────────────────────────────────────────────────────

def make_ssrf_router():
    try:
        from fastapi import APIRouter
        from pydantic import BaseModel
    except ImportError:
        return None

    router = APIRouter(prefix="/api/ssrf-guard", tags=["SSRFGuard"])

    class CheckBody(BaseModel):
        url: str
        allow_http: bool = False

    @router.post("/check")
    def check_url(body: CheckBody):
        """检测 URL 是否安全"""
        try:
            clean = validate_url(body.url, allow_http=body.allow_http)
            return {"safe": True, "url": clean}
        except SSRFError as e:
            return {"safe": False, "reason": str(e)}

    @router.get("/allowed-hosts")
    def get_allowed_hosts():
        return {"allowed_hosts": sorted(ALLOWED_HOSTS)}

    return router
