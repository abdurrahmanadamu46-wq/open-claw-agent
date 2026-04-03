"""
OpenClaw SDK — 轻量 Python 客户端
====================================
灵感来源：Langfuse Python SDK（langfuse-python）
借鉴要点：
  - 单例 Client，支持 context manager
  - trace/span/generation/score 一行接入
  - Prompt 版本管理（get_prompt / push_prompt）
  - Dataset 管理（get_dataset / create_dataset_item）
  - 完全兼容 OpenClaw SaaS 后端 API

快速开始：
    from dragon-senate-saas-v2.sdk import OpenClawSDK

    sdk = OpenClawSDK(
        api_key="sk-xxxxxx",
        base_url="http://localhost:8000",
        tenant_id="t001",
    )

    # 记录一次 LLM 调用
    with sdk.trace("content-campaign", workflow_run_id="run-001") as trace:
        with trace.span("inkwriter", skill="inkwriter_copy") as span:
            prompt = sdk.get_prompt("inkwriter_copy_generate")
            output = my_llm_call(prompt)
            span.generation(
                model="gpt-4o",
                input=prompt,
                output=output,
                tokens={"prompt": 800, "completion": 400},
            )
            span.score("copy_quality", 0.85)
"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Generator, Optional

# ─────────────────────────────────────────────────────────────────
# 内部：HTTP 客户端（无依赖，使用 urllib）
# ─────────────────────────────────────────────────────────────────

class _HttpClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, method: str, path: str,
                  body: Any = None) -> dict:
        import urllib.request, urllib.error
        url = f"{self.base_url}{path}"
        data = json.dumps(body, ensure_ascii=False, default=str).encode() if body else None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode())
            except Exception:
                err_body = {"error": str(e)}
            raise OpenClawAPIError(e.code, err_body) from e
        except Exception as e:
            raise OpenClawAPIError(0, {"error": str(e)}) from e

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def post(self, path: str, body: Any = None) -> dict:
        return self._request("POST", path, body)

    def delete(self, path: str) -> dict:
        return self._request("DELETE", path)


class OpenClawAPIError(Exception):
    def __init__(self, status_code: int, body: dict) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"OpenClaw API Error {status_code}: {body}")


# ─────────────────────────────────────────────────────────────────
# Generation（LLM 调用记录）
# ─────────────────────────────────────────────────────────────────

class Generation:
    def __init__(self, gen_id: str, span: "Span") -> None:
        self.gen_id = gen_id
        self._span = span

    def score(self, name: str, value: float,
               comment: str = "", score_type: str = "manual") -> None:
        """为此 Generation 打分"""
        self._span._sdk._http.post("/api/observability/scores", {
            "gen_id": self.gen_id,
            "trace_id": self._span._trace.trace_id,
            "tenant_id": self._span._trace._sdk.tenant_id,
            "name": name,
            "value": value,
            "comment": comment,
            "score_type": score_type,
            "scorer": "sdk-manual",
        })


# ─────────────────────────────────────────────────────────────────
# Span（龙虾步骤）
# ─────────────────────────────────────────────────────────────────

class Span:
    def __init__(self, span_id: str, trace: "Trace",
                 lobster: str = "", skill: str = "") -> None:
        self.span_id = span_id
        self._trace = trace
        self._sdk = trace._sdk
        self.lobster = lobster
        self.skill = skill
        self._start_time = time.time()

    def generation(
        self,
        model: str,
        input: str,
        output: str,
        tokens: Optional[dict] = None,
        latency_ms: Optional[int] = None,
        meta: Optional[dict] = None,
    ) -> Generation:
        """记录 LLM Generation"""
        if latency_ms is None:
            latency_ms = int((time.time() - self._start_time) * 1000)
        tokens = tokens or {}
        try:
            resp = self._sdk._http.post("/api/observability/generations", {
                "trace_id": self._trace.trace_id,
                "span_id": self.span_id,
                "tenant_id": self._sdk.tenant_id,
                "model": model,
                "input_text": input,
                "output_text": output,
                "prompt_tokens": tokens.get("prompt", 0),
                "completion_tokens": tokens.get("completion", 0),
                "latency_ms": latency_ms,
                "meta": meta or {},
            })
            gen_id = resp.get("gen_id", f"gn_{uuid.uuid4().hex[:12]}")
        except Exception:
            gen_id = f"gn_{uuid.uuid4().hex[:12]}"
        return Generation(gen_id, self)

    def score(self, name: str, value: float,
               comment: str = "", score_type: str = "manual") -> None:
        """为此 Span 打分"""
        self._sdk._http.post("/api/observability/scores", {
            "span_id": self.span_id,
            "trace_id": self._trace.trace_id,
            "tenant_id": self._sdk.tenant_id,
            "name": name,
            "value": value,
            "comment": comment,
            "score_type": score_type,
            "scorer": "sdk-manual",
        })

    def end(self, status: str = "completed") -> None:
        """结束 Span"""
        try:
            self._sdk._http.post(f"/api/observability/spans/{self.span_id}/end", {
                "status": status,
                "latency_ms": int((time.time() - self._start_time) * 1000),
            })
        except Exception:
            pass

    def __enter__(self) -> "Span":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        status = "error" if exc_type else "completed"
        self.end(status=status)


# ─────────────────────────────────────────────────────────────────
# Trace（工作流执行）
# ─────────────────────────────────────────────────────────────────

class Trace:
    def __init__(self, trace_id: str, sdk: "OpenClawSDK") -> None:
        self.trace_id = trace_id
        self._sdk = sdk
        self._step_index = 0

    def span(self, lobster: str = "", skill: str = "",
              step_index: Optional[int] = None) -> Span:
        """创建子 Span（龙虾步骤）"""
        if step_index is None:
            step_index = self._step_index
            self._step_index += 1
        try:
            resp = self._sdk._http.post("/api/observability/spans", {
                "trace_id": self.trace_id,
                "tenant_id": self._sdk.tenant_id,
                "lobster": lobster,
                "skill": skill,
                "step_index": step_index,
            })
            span_id = resp.get("span_id", f"sp_{uuid.uuid4().hex[:12]}")
        except Exception:
            span_id = f"sp_{uuid.uuid4().hex[:12]}"
        return Span(span_id, self, lobster=lobster, skill=skill)

    def end(self, status: str = "completed") -> None:
        """结束 Trace"""
        try:
            self._sdk._http.post(f"/api/observability/traces/{self.trace_id}/end", {
                "status": status,
            })
        except Exception:
            pass

    def score(self, name: str, value: float, comment: str = "") -> None:
        """为整个 Trace 打分"""
        self._sdk._http.post("/api/observability/scores", {
            "trace_id": self.trace_id,
            "tenant_id": self._sdk.tenant_id,
            "name": name,
            "value": value,
            "comment": comment,
            "score_type": "manual",
            "scorer": "sdk-manual",
        })

    def __enter__(self) -> "Trace":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        status = "error" if exc_type else "completed"
        self.end(status=status)


# ─────────────────────────────────────────────────────────────────
# PromptClient — Prompt 版本管理
# ─────────────────────────────────────────────────────────────────

class PromptClient:
    def __init__(self, sdk: "OpenClawSDK") -> None:
        self._sdk = sdk
        self._cache: dict[str, dict] = {}

    def get(self, name: str, label: str = "production",
             version: Optional[int] = None) -> str:
        """
        获取 Prompt（对应 Langfuse prompt.get()）。
        优先从内存缓存读取（60秒 TTL）。
        """
        cache_key = f"{name}:{label}:{version}"
        cached = self._cache.get(cache_key)
        if cached and time.time() - cached["_ts"] < 60:
            return cached["content"]
        try:
            path = f"/api/observability/prompts/{name}/versions"
            resp = self._sdk._http.get(path)
            versions = resp if isinstance(resp, list) else resp.get("versions", [])
            # 找到对应版本
            target = None
            for v in versions:
                if version is not None and v.get("version") == version:
                    target = v
                    break
                if version is None and label in (v.get("labels") or []):
                    target = v
                    break
            content = target["content"] if target else ""
            self._cache[cache_key] = {"content": content, "_ts": time.time()}
            return content
        except Exception:
            return self._cache.get(cache_key, {}).get("content", "")

    def push(self, name: str, content: str,
              lobster: str = "", label: str = "preview",
              config: Optional[dict] = None) -> dict:
        """推送新 Prompt 版本（对应 Langfuse prompt.push()）"""
        return self._sdk._http.post("/api/observability/prompts/push", {
            "name": name,
            "content": content,
            "lobster": lobster,
            "label": label,
            "config": config or {},
            "pushed_by": "sdk",
        })

    def render(self, name: str, variables: dict,
                label: str = "production") -> str:
        """获取 Prompt 并渲染变量"""
        content = self.get(name, label=label)
        for k, v in variables.items():
            content = content.replace(f"{{{{{k}}}}}", str(v))
        return content


# ─────────────────────────────────────────────────────────────────
# DatasetClient — Golden Set 数据集
# ─────────────────────────────────────────────────────────────────

class DatasetClient:
    def __init__(self, sdk: "OpenClawSDK") -> None:
        self._sdk = sdk

    def create(self, name: str, description: str = "") -> dict:
        """创建数据集"""
        return self._sdk._http.post("/api/observability/datasets/create", {
            "name": name,
            "description": description,
            "tenant_id": self._sdk.tenant_id,
        })

    def get_stats(self, name: str) -> dict:
        """获取数据集统计"""
        return self._sdk._http.get(f"/api/observability/datasets/{name}/stats")

    def add_item(self, dataset_name: str, input: Any,
                  expected_output: Any, quality_score: float = 0.0,
                  tags: Optional[list[str]] = None,
                  source_gen_id: str = "") -> dict:
        """添加数据集条目（对应 Langfuse dataset.create_dataset_item()）"""
        return self._sdk._http.post("/api/observability/datasets/items", {
            "dataset_name": dataset_name,
            "input": input if isinstance(input, str) else json.dumps(input),
            "expected_output": expected_output if isinstance(expected_output, str) else json.dumps(expected_output),
            "quality_score": quality_score,
            "tags": tags or [],
            "source_gen_id": source_gen_id,
            "tenant_id": self._sdk.tenant_id,
        })


# ─────────────────────────────────────────────────────────────────
# OpenClawSDK — 主入口
# ─────────────────────────────────────────────────────────────────

class OpenClawSDK:
    """
    OpenClaw Python SDK（对应 Langfuse Python SDK）。

    使用方式：
        sdk = OpenClawSDK(
            api_key=os.environ["OPENCLAW_API_KEY"],
            base_url="http://localhost:8000",
            tenant_id="t001",
        )

        # Trace 记录
        with sdk.trace("content-campaign") as t:
            with t.span("inkwriter", skill="copy_generate") as s:
                output = llm_call(sdk.prompt.render("inkwriter_copy", vars))
                s.generation(model="gpt-4o", input=prompt, output=output,
                              tokens={"prompt": 800, "completion": 400})

        # 批量导出
        sdk.export("workflow_runs", days=30, fmt="csv")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        tenant_id: str = "tenant_main",
        timeout: int = 30,
        debug: bool = False,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENCLAW_API_KEY", "")
        self.base_url = (base_url or os.environ.get("OPENCLAW_BASE_URL", "http://localhost:8000")).rstrip("/")
        self.tenant_id = tenant_id
        self.debug = debug
        self._http = _HttpClient(self.base_url, self.api_key, timeout=timeout)
        self.prompt = PromptClient(self)
        self.dataset = DatasetClient(self)

    def trace(self, workflow_name: str = "",
               workflow_run_id: Optional[str] = None,
               tags: Optional[list[str]] = None,
               meta: Optional[dict] = None) -> Trace:
        """
        创建 Trace（对应 Langfuse langfuse.trace()）。
        返回 Trace 对象，支持 context manager。
        """
        try:
            resp = self._http.post("/api/observability/traces", {
                "workflow_name": workflow_name,
                "workflow_run_id": workflow_run_id or f"run_{uuid.uuid4().hex[:12]}",
                "tenant_id": self.tenant_id,
                "tags": tags or [],
                "meta": meta or {},
            })
            trace_id = resp.get("trace_id", f"tr_{uuid.uuid4().hex[:12]}")
        except Exception as e:
            if self.debug:
                print(f"[OpenClawSDK] trace() 失败（降级为本地ID）: {e}")
            trace_id = f"tr_{uuid.uuid4().hex[:12]}"
        return Trace(trace_id, self)

    def score(self, name: str, value: float,
               gen_id: str = "", trace_id: str = "",
               comment: str = "", score_type: str = "manual") -> dict:
        """直接提交评分（对应 Langfuse langfuse.score()）"""
        return self._http.post("/api/observability/scores", {
            "name": name,
            "value": value,
            "gen_id": gen_id,
            "trace_id": trace_id,
            "tenant_id": self.tenant_id,
            "comment": comment,
            "score_type": score_type,
            "scorer": "sdk-manual",
        })

    def export(self, export_type: str = "workflow_runs",
                days: int = 30, fmt: str = "csv",
                limit: int = 10000, async_mode: bool = False) -> dict:
        """触发数据导出（对应 Langfuse Batch Export）"""
        if async_mode:
            return self._http.post(f"/api/exports/async/{export_type}", None)
        else:
            return self._http.post(f"/api/exports/sync/{export_type}", None)

    def get_dashboard(self, days: int = 30) -> dict:
        """获取成本/token/延迟 Dashboard 数据"""
        return self._http.get(f"/api/observability/dashboard?tenant_id={self.tenant_id}&days={days}")

    def get_quota_summary(self) -> dict:
        """获取配额使用摘要"""
        return self._http.get(f"/api/observability/quota/summary?tenant_id={self.tenant_id}")

    def create_api_key(self, label: str = "", tag: str = "production") -> dict:
        """创建 API Key（返回含一次性明文 secret）"""
        return self._http.post(f"/api/observability/api-keys?tenant_id={self.tenant_id}&label={label}&tag={tag}")

    def flush(self) -> None:
        """（保留接口，暂无批量缓冲，与 Langfuse SDK 兼容）"""
        pass

    def __repr__(self) -> str:
        return f"OpenClawSDK(base_url={self.base_url!r}, tenant_id={self.tenant_id!r})"


# ─────────────────────────────────────────────────────────────────
# 全局默认实例（可直接 from sdk import sdk 使用）
# ─────────────────────────────────────────────────────────────────

_default_sdk: Optional[OpenClawSDK] = None

def get_sdk(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    tenant_id: str = "tenant_main",
) -> OpenClawSDK:
    """获取全局 SDK 单例"""
    global _default_sdk
    if _default_sdk is None:
        _default_sdk = OpenClawSDK(
            api_key=api_key or os.environ.get("OPENCLAW_API_KEY", ""),
            base_url=base_url or os.environ.get("OPENCLAW_BASE_URL", "http://localhost:8000"),
            tenant_id=tenant_id,
        )
    return _default_sdk


# 模块级别便捷别名
sdk = get_sdk
