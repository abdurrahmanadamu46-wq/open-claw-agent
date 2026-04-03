# CODEX TASK: 龙虾调用链 Pipeline 中间件（LobsterPipelineMiddleware）

**优先级：P1**  
**来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-3 + P1-4**  
**借鉴自**：Open WebUI `routers/pipelines.py` + `routers/tasks.py`

---

## 背景

当前龙虾 LLM 调用是直通模式（prompt → llm → output），无中间件拦截点。  
借鉴 Open WebUI 的 Pipeline 插件系统 + 后台任务机制，实现两大能力：

**A. Pipeline 中间件**：龙虾调用链可插入自定义处理逻辑（合规过滤/DLP/审批/日志增强）  
**B. 后台自动化任务**：龙虾任务完成后自动打标签/归档/摘要/写记忆

---

## A. Pipeline 中间件实现

### `dragon-senate-saas-v2/lobster_pipeline_middleware.py`

```python
from abc import ABC, abstractmethod
from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class PipelineContext:
    """Pipeline 执行上下文"""
    task_id: str
    lobster_id: str
    tenant_id: str
    prompt: str
    output: Optional[str] = None
    metadata: dict = None
    blocked: bool = False
    block_reason: str = ""

    def __post_init__(self):
        self.metadata = self.metadata or {}


class PipelinePlugin(ABC):
    """Pipeline 插件基类"""
    name: str = "unnamed"
    enabled: bool = True

    @abstractmethod
    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        """LLM 调用前拦截（可修改 prompt，可 block）"""
        return ctx

    @abstractmethod
    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        """LLM 调用后拦截（可修改 output）"""
        return ctx


class DLPPlugin(PipelinePlugin):
    """数据泄露防护（已有 ssrf_guard.py，此处扩展到内容层）"""
    name = "dlp_content_filter"

    SENSITIVE_PATTERNS = ["身份证", "银行卡", "密码", "secret", "password"]

    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        for pattern in self.SENSITIVE_PATTERNS:
            if pattern.lower() in ctx.prompt.lower():
                ctx.blocked = True
                ctx.block_reason = f"DLP: 检测到敏感词 [{pattern}]"
                break
        return ctx

    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        return ctx  # 响应阶段暂不拦截


class LLMCallEnhancerPlugin(PipelinePlugin):
    """LLM 调用日志增强（补充龙虾上下文信息到 llm_call_logger）"""
    name = "llm_call_enhancer"

    async def on_request(self, ctx: PipelineContext) -> PipelineContext:
        ctx.metadata["pipeline_enhanced"] = True
        ctx.metadata["lobster_id"] = ctx.lobster_id
        return ctx

    async def on_response(self, ctx: PipelineContext) -> PipelineContext:
        ctx.metadata["output_length"] = len(ctx.output or "")
        return ctx


class LobsterPipelineRunner:
    """
    Pipeline 执行器
    按注册顺序依次执行所有启用的 Plugin
    """

    def __init__(self):
        self._plugins: list[PipelinePlugin] = []

    def register(self, plugin: PipelinePlugin):
        if plugin.enabled:
            self._plugins.append(plugin)

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

    async def run(self, ctx: PipelineContext, llm_call_fn) -> PipelineContext:
        """完整 Pipeline 执行流程"""
        ctx = await self.run_request(ctx)
        if ctx.blocked:
            return ctx
        ctx.output = await llm_call_fn(ctx.prompt)
        ctx = await self.run_response(ctx)
        return ctx


# 全局默认 Pipeline（按需注册插件）
default_pipeline = LobsterPipelineRunner()
default_pipeline.register(DLPPlugin())
default_pipeline.register(LLMCallEnhancerPlugin())
```

---

## B. 后台自动化任务实现

### `dragon-senate-saas-v2/lobster_post_task_processor.py`

```python
import asyncio
from enum import Enum


class PostTaskAction(str, Enum):
    AUTO_TAG = "auto_tag"           # 自动打标签
    AUTO_ARCHIVE = "auto_archive"   # 自动归档
    AUTO_SUMMARIZE = "auto_summarize" # 自动摘要
    WRITE_MEMORY = "write_memory"   # 写入记忆


class LobsterPostTaskProcessor:
    """
    龙虾任务完成后台处理器
    借鉴 Open WebUI tasks.py 的异步后台任务机制
    """

    def __init__(self, llm_client, memory_store, task_store, tag_store):
        self.llm = llm_client
        self.memory = memory_store
        self.tasks = task_store
        self.tags = tag_store

    async def process(self, task_id: str, tenant_id: str, actions: list[PostTaskAction] = None):
        """任务完成后异步触发所有后台动作"""
        if actions is None:
            actions = list(PostTaskAction)

        task = await self.tasks.get(task_id, tenant_id)
        if not task:
            return

        coros = []
        if PostTaskAction.AUTO_TAG in actions:
            coros.append(self._auto_tag(task))
        if PostTaskAction.AUTO_SUMMARIZE in actions:
            coros.append(self._auto_summarize(task))
        if PostTaskAction.WRITE_MEMORY in actions:
            coros.append(self._write_memory(task, tenant_id))
        if PostTaskAction.AUTO_ARCHIVE in actions:
            coros.append(self._auto_archive(task))

        await asyncio.gather(*coros, return_exceptions=True)

    async def _auto_tag(self, task: dict):
        """LLM 自动为任务输出生成标签"""
        prompt = f"""
为以下龙虾AI输出内容生成3-5个精准标签（仅返回逗号分隔的标签列表）：

{task.get('output', '')[:500]}
"""
        tags_str = await self.llm.complete(prompt, max_tokens=50)
        tags = [t.strip() for t in tags_str.split(",") if t.strip()]
        await self.tags.set_tags(task["task_id"], tags)

    async def _auto_summarize(self, task: dict):
        """LLM 自动生成任务摘要（用于列表页展示）"""
        if len(task.get("output", "")) < 100:
            return
        prompt = f"一句话总结以下内容（30字以内）：\n{task.get('output', '')[:800]}"
        summary = await self.llm.complete(prompt, max_tokens=60)
        await self.tasks.update(task["task_id"], {"summary": summary.strip()})

    async def _write_memory(self, task: dict, tenant_id: str):
        """将任务关键信息写入龙虾记忆"""
        if task.get("lobster_id") and task.get("output"):
            await self.memory.add(
                entity_id=task["lobster_id"],
                tenant_id=tenant_id,
                content=task["output"][:300],
                source=f"task:{task['task_id']}",
            )

    async def _auto_archive(self, task: dict):
        """自动将完成任务标记归档状态"""
        await self.tasks.update(task["task_id"], {"archived": True})
```

### 集成到龙虾运行器

```python
# dragon-senate-saas-v2/lobster_runner.py 中追加（任务完成后触发）
# asyncio.create_task(post_processor.process(task_id, tenant_id))
```

---

## 验收标准

### Pipeline 中间件
- [ ] `PipelinePlugin` 基类定义完整（on_request / on_response）
- [ ] `DLPPlugin` 检测到敏感词时 `ctx.blocked=True`
- [ ] `LobsterPipelineRunner.run()` 正确串联 request→llm→response 流程
- [ ] 插件注册/注销 API：`POST /api/v1/pipelines/register`

### 后台自动化任务
- [ ] `LobsterPostTaskProcessor.process()` 异步并发执行各动作
- [ ] 自动标签写入任务记录
- [ ] 自动摘要（< 30字）写入任务 summary 字段
- [ ] 写记忆成功（调用 `memory_store.add`）
- [ ] 龙虾 `lobster_runner.py` 在任务完成后 `asyncio.create_task` 触发处理器

---

*Codex Task | 来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-3+P1-4 | 2026-04-02*
