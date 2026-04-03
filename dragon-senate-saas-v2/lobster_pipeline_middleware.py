"""
Pipeline middleware for lobster LLM invocation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass(slots=True)
class PipelineContext:
    task_id: str
    lobster_id: str
    tenant_id: str
    system_prompt: str
    prompt: str
    output: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    blocked: bool = False
    block_reason: str = ""


class PipelineBlockedError(RuntimeError):
    pass


class PipelinePlugin(ABC):
    name: str = "unnamed"
    enabled: bool = True

    @abstractmethod
    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        return ctx

    @abstractmethod
    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        return ctx


class DLPPlugin(PipelinePlugin):
    name = "dlp_content_filter"
    SENSITIVE_PATTERNS = ("身份证", "银行卡", "密码", "secret", "password", "api_key", "cookie")

    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        lower = f"{ctx.system_prompt}\n{ctx.prompt}".lower()
        for pattern in self.SENSITIVE_PATTERNS:
            if pattern.lower() in lower:
                ctx.blocked = True
                ctx.block_reason = f"DLP blocked sensitive token: {pattern}"
                break
        return ctx

    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        return ctx


class LLMCallEnhancerPlugin(PipelinePlugin):
    name = "llm_call_enhancer"

    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        ctx.metadata["pipeline_enhanced"] = True
        ctx.metadata["lobster_id"] = ctx.lobster_id
        return ctx

    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        ctx.metadata["output_length"] = len(ctx.output or "")
        return ctx


class ArtifactHintPlugin(PipelinePlugin):
    name = "artifact_hint"

    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        artifact_hint = str(ctx.metadata.get("artifact_hint") or "").strip()
        if artifact_hint:
            ctx.prompt = f"{ctx.prompt}\n\n[Artifact Hint]\n{artifact_hint}"
        return ctx

    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        return ctx


class LobsterPipelineRunner:
    def __init__(self) -> None:
        self._plugins: list[PipelinePlugin] = []

    def register(self, plugin: PipelinePlugin) -> None:
        if plugin.enabled:
            self._plugins.append(plugin)

    def list_plugins(self) -> list[dict[str, Any]]:
        return [
            {"name": plugin.name, "enabled": plugin.enabled, "class": plugin.__class__.__name__}
            for plugin in self._plugins
        ]

    async def run_request(self, ctx: PipelineContext) -> PipelineContext:
        for plugin in self._plugins:
            ctx = await plugin.on_request(ctx)
            if ctx.blocked:
                break
        return ctx

    async def run_response(self, ctx: PipelineContext) -> PipelineContext:
        for plugin in reversed(self._plugins):
            ctx = await plugin.on_response(ctx)
        return ctx

    async def run(
        self,
        ctx: PipelineContext,
        llm_call_fn: Callable[[str, str], Awaitable[str]],
    ) -> PipelineContext:
        ctx = await self.run_request(ctx)
        if ctx.blocked:
            raise PipelineBlockedError(ctx.block_reason or "pipeline_blocked")
        ctx.output = await llm_call_fn(ctx.system_prompt, ctx.prompt)
        ctx = await self.run_response(ctx)
        return ctx


_default_pipeline: LobsterPipelineRunner | None = None


def get_default_pipeline() -> LobsterPipelineRunner:
    global _default_pipeline
    if _default_pipeline is None:
        runner = LobsterPipelineRunner()
        runner.register(DLPPlugin())
        runner.register(LLMCallEnhancerPlugin())
        runner.register(ArtifactHintPlugin())
        _default_pipeline = runner
    return _default_pipeline
