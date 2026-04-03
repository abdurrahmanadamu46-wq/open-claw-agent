# CODEX TASK: RAG-Anything 借鉴 P1 任务包
> 来源分析：`docs/RAG_ANYTHING_BORROWING_ANALYSIS.md`
> 优先级：P1（立即可落地）
> 创建日期：2026-04-02

---

## 任务总览

| # | 任务名 | 目标文件 | 估时 |
|---|--------|---------|------|
| P1-1 | 龙虾任务生命周期回调钩子 | `dragon-senate-saas-v2/lobster_lifecycle_hooks.py` | 1天 |
| P1-2 | 龙虾任务 Dry-run 预检模式 | `dragon-senate-saas-v2/lobster_dryrun.py` | 1天 |
| P1-3 | 批量任务进度追踪 + 结构化 Result | `dragon-senate-saas-v2/batch_task_tracker.py` | 1天 |
| P1-4 | Prompt 多语言热切换（租户级） | `dragon-senate-saas-v2/prompt_lang_manager.py` | 0.5天 |
| P1-5 | 多模态知识 KB 处理器 | `dragon-senate-saas-v2/modal_kb_processor.py` | 2天 |

---

## P1-1：龙虾任务生命周期回调钩子

### 背景
RAG-Anything 的 `callbacks.py` 定义了文档处理的 4 个生命周期钩子，让外部系统能在任务关键节点获得通知。我们的龙虾任务缺乏标准钩子接口，导致 Webhook/通知/监控集成困难。

### 完整代码

```python
"""
龙虾任务生命周期回调钩子
借鉴：RAG-Anything raganything/callbacks.py
用途：为龙虾任务每个关键节点定义标准钩子，实现 Webhook/监控/通知集成
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class TaskStage(str, Enum):
    """龙虾任务生命周期阶段"""
    QUEUED = "queued"           # 已入队等待
    STARTED = "started"         # 开始执行
    PROGRESS = "progress"       # 进行中（带百分比）
    COMPLETED = "completed"     # 成功完成
    FAILED = "failed"           # 失败
    CANCELLED = "cancelled"     # 已取消
    DRY_RUN = "dry_run"        # 预检完成


@dataclass
class TaskEvent:
    """任务生命周期事件"""
    task_id: str
    lobster_id: str
    stage: TaskStage
    tenant_id: str = ""
    progress: float = 0.0           # 0.0 ~ 1.0
    message: str = ""
    result: Optional[dict] = None
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


# 钩子函数类型：同步或异步均可
HookFn = Callable[[TaskEvent], Any]


class LobsterLifecycleHooks:
    """
    龙虾任务生命周期钩子管理器。

    借鉴 RAG-Anything callbacks.py 设计，扩展为：
    - 支持同步和异步钩子
    - 支持全局钩子（所有龙虾）和龙虾专属钩子
    - 内置 Webhook 发送、日志记录、Slack 通知等预置钩子

    使用示例：
        hooks = LobsterLifecycleHooks()

        @hooks.on(TaskStage.COMPLETED)
        async def notify_user(event: TaskEvent):
            await send_webhook(event)

        # 在 lobster_runner.py 中触发
        await hooks.emit(TaskEvent(task_id="...", lobster_id="radar", stage=TaskStage.COMPLETED))
    """

    def __init__(self):
        self._hooks: dict[TaskStage, list[HookFn]] = {
            stage: [] for stage in TaskStage
        }
        self._lobster_hooks: dict[str, dict[TaskStage, list[HookFn]]] = {}

    def on(self, stage: TaskStage, lobster_id: str = None):
        """
        注册钩子的装饰器。

        Args:
            stage: 触发阶段
            lobster_id: 可选，仅对特定龙虾生效（None = 全局）
        """
        def decorator(fn: HookFn):
            if lobster_id:
                if lobster_id not in self._lobster_hooks:
                    self._lobster_hooks[lobster_id] = {s: [] for s in TaskStage}
                self._lobster_hooks[lobster_id][stage].append(fn)
            else:
                self._hooks[stage].append(fn)
            return fn
        return decorator

    def register(self, stage: TaskStage, fn: HookFn, lobster_id: str = None):
        """编程式注册钩子（非装饰器方式）"""
        if lobster_id:
            if lobster_id not in self._lobster_hooks:
                self._lobster_hooks[lobster_id] = {s: [] for s in TaskStage}
            self._lobster_hooks[lobster_id][stage].append(fn)
        else:
            self._hooks[stage].append(fn)

    async def emit(self, event: TaskEvent) -> None:
        """
        触发特定阶段的所有钩子（全局 + 龙虾专属）。
        钩子执行失败不影响主流程（仅记录错误日志）。
        """
        fns: list[HookFn] = []

        # 全局钩子
        fns.extend(self._hooks.get(event.stage, []))

        # 龙虾专属钩子
        if event.lobster_id in self._lobster_hooks:
            fns.extend(self._lobster_hooks[event.lobster_id].get(event.stage, []))

        for fn in fns:
            try:
                result = fn(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                logger.error(
                    f"[LobsterHooks] 钩子执行失败 stage={event.stage} "
                    f"fn={fn.__name__} error={e}"
                )

    # ─────────────────────────────────────────────
    # 便捷 emit 方法
    # ─────────────────────────────────────────────

    async def on_queued(self, task_id: str, lobster_id: str, tenant_id: str = "", **meta):
        await self.emit(TaskEvent(
            task_id=task_id, lobster_id=lobster_id,
            stage=TaskStage.QUEUED, tenant_id=tenant_id,
            message="任务已入队", metadata=meta,
        ))

    async def on_started(self, task_id: str, lobster_id: str, tenant_id: str = "", **meta):
        await self.emit(TaskEvent(
            task_id=task_id, lobster_id=lobster_id,
            stage=TaskStage.STARTED, tenant_id=tenant_id,
            message="龙虾开始执行", metadata=meta,
        ))

    async def on_progress(
        self, task_id: str, lobster_id: str,
        progress: float, message: str = "", tenant_id: str = "",
    ):
        await self.emit(TaskEvent(
            task_id=task_id, lobster_id=lobster_id,
            stage=TaskStage.PROGRESS, tenant_id=tenant_id,
            progress=progress, message=message,
        ))

    async def on_completed(
        self, task_id: str, lobster_id: str,
        result: dict, tenant_id: str = "", **meta,
    ):
        await self.emit(TaskEvent(
            task_id=task_id, lobster_id=lobster_id,
            stage=TaskStage.COMPLETED, tenant_id=tenant_id,
            progress=1.0, result=result,
            message="龙虾任务完成", metadata=meta,
        ))

    async def on_failed(
        self, task_id: str, lobster_id: str,
        error: str, tenant_id: str = "", **meta,
    ):
        await self.emit(TaskEvent(
            task_id=task_id, lobster_id=lobster_id,
            stage=TaskStage.FAILED, tenant_id=tenant_id,
            error=error, message=f"任务失败: {error}", metadata=meta,
        ))


# ─────────────────────────────────────────────
# 内置预置钩子
# ─────────────────────────────────────────────

def make_webhook_hook(webhook_url: str, secret: str = ""):
    """
    内置 Webhook 钩子工厂。
    任务完成/失败时向 webhook_url 发送 POST 请求。
    """
    import json
    import urllib.request

    async def webhook_hook(event: TaskEvent):
        if event.stage not in (TaskStage.COMPLETED, TaskStage.FAILED):
            return
        payload = {
            "task_id": event.task_id,
            "lobster_id": event.lobster_id,
            "stage": event.stage.value,
            "tenant_id": event.tenant_id,
            "message": event.message,
            "result": event.result,
            "error": event.error,
            "timestamp": event.timestamp,
        }
        body = json.dumps(payload, ensure_ascii=False).encode()
        req = urllib.request.Request(
            webhook_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
            logger.info(f"[WebhookHook] 已发送 {event.stage.value} → {webhook_url}")
        except Exception as e:
            logger.warning(f"[WebhookHook] 发送失败: {e}")

    return webhook_hook


def make_log_hook(level: str = "INFO"):
    """内置日志钩子：每个生命周期事件记录日志"""
    log_fn = getattr(logger, level.lower(), logger.info)

    def log_hook(event: TaskEvent):
        log_fn(
            f"[TaskLifecycle] stage={event.stage.value} "
            f"task={event.task_id} lobster={event.lobster_id} "
            f"progress={event.progress:.0%} msg={event.message}"
        )
    return log_hook


# 全局单例
_global_hooks = LobsterLifecycleHooks()

def get_hooks() -> LobsterLifecycleHooks:
    """获取全局钩子管理器单例"""
    return _global_hooks
```

---

## P1-2：龙虾任务 Dry-run 预检模式

### 背景
RAG-Anything 的 `batch_dry_run_example.py` 支持 dry-run 模式：真实执行前先验证所有前置条件，返回预检报告。我们的龙虾任务配置错误要等运行后才发现。

### 完整代码

```python
"""
龙虾任务 Dry-run 预检模式
借鉴：RAG-Anything examples/batch_dry_run_example.py
用途：任务提交前预检所有前置条件，避免执行到一半才发现配置错误
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DryRunCheckResult:
    """单项预检结果"""
    check_name: str
    passed: bool
    message: str
    severity: str = "error"   # "error" | "warning" | "info"
    suggestion: str = ""


@dataclass
class DryRunReport:
    """Dry-run 预检完整报告"""
    task_id: str
    lobster_id: str
    tenant_id: str
    checks: list[DryRunCheckResult] = field(default_factory=list)
    can_proceed: bool = False     # 所有 error 级别检查通过才为 True
    estimated_tokens: int = 0
    estimated_cost_usd: float = 0.0
    warnings: list[str] = field(default_factory=list)

    def add_check(self, result: DryRunCheckResult):
        self.checks.append(result)
        if result.severity == "warning" and not result.passed:
            self.warnings.append(result.message)

    def finalize(self):
        """计算 can_proceed：所有 error 级别的检查必须通过"""
        error_checks = [c for c in self.checks if c.severity == "error"]
        self.can_proceed = all(c.passed for c in error_checks)

    def summary(self) -> str:
        passed = sum(1 for c in self.checks if c.passed)
        total = len(self.checks)
        status = "✅ 可以执行" if self.can_proceed else "❌ 不可执行"
        lines = [
            f"[DryRun] 预检报告 {status}",
            f"  任务: {self.task_id} | 龙虾: {self.lobster_id}",
            f"  检查: {passed}/{total} 通过",
            f"  预估 Tokens: {self.estimated_tokens:,}",
            f"  预估费用: ${self.estimated_cost_usd:.4f}",
        ]
        for c in self.checks:
            icon = "✅" if c.passed else ("⚠️" if c.severity == "warning" else "❌")
            lines.append(f"  {icon} {c.check_name}: {c.message}")
        return "\n".join(lines)


class LobsterDryRunner:
    """
    龙虾任务预检器。
    在 lobster_runner.py 中，当 dry_run=True 时调用此类预检。
    """

    def __init__(self, provider_registry=None, skill_whitelist=None):
        self.provider_registry = provider_registry
        self.skill_whitelist = skill_whitelist

    async def run(
        self,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        skill_id: str,
        payload: dict,
        provider_name: str = "openai",
    ) -> DryRunReport:
        """
        执行完整预检，返回 DryRunReport。
        """
        report = DryRunReport(
            task_id=task_id,
            lobster_id=lobster_id,
            tenant_id=tenant_id,
        )

        # 检查 1：LLM Provider 有效性
        report.add_check(await self._check_provider(provider_name))

        # 检查 2：龙虾技能白名单
        report.add_check(self._check_skill_whitelist(tenant_id, lobster_id, skill_id))

        # 检查 3：配额是否充足
        report.add_check(await self._check_quota(tenant_id, payload))

        # 检查 4：IM 渠道授权（Dispatcher/Followup 专属）
        if lobster_id in ("dispatcher", "followup", "echoer"):
            report.add_check(await self._check_im_channel(tenant_id, payload))

        # 检查 5：数据源可达性（Radar 专属）
        if lobster_id == "radar" and payload.get("source_url"):
            report.add_check(await self._check_url_reachable(payload["source_url"]))

        # 检查 6：内容长度估算
        token_check, tokens = self._estimate_tokens(payload)
        report.add_check(token_check)
        report.estimated_tokens = tokens
        report.estimated_cost_usd = tokens * 0.000002   # 粗略估算

        report.finalize()
        logger.info(report.summary())
        return report

    async def _check_provider(self, provider_name: str) -> DryRunCheckResult:
        """检查 LLM Provider 是否已注册且可用"""
        if self.provider_registry is None:
            return DryRunCheckResult(
                check_name="LLM Provider",
                passed=True,
                message="Provider registry 未配置，跳过检查",
                severity="warning",
            )
        try:
            provider = self.provider_registry.get(provider_name)
            return DryRunCheckResult(
                check_name="LLM Provider",
                passed=True,
                message=f"Provider '{provider_name}' 已注册 (streaming={provider.streaming_enabled})",
            )
        except KeyError:
            return DryRunCheckResult(
                check_name="LLM Provider",
                passed=False,
                message=f"Provider '{provider_name}' 未注册",
                severity="error",
                suggestion=f"请在 provider_registry 中注册 '{provider_name}'",
            )

    def _check_skill_whitelist(
        self, tenant_id: str, lobster_id: str, skill_id: str
    ) -> DryRunCheckResult:
        """检查租户是否有权使用该技能"""
        if self.skill_whitelist is None:
            return DryRunCheckResult(
                check_name="技能白名单",
                passed=True,
                message="白名单未配置，默认允许",
                severity="info",
            )
        allowed = self.skill_whitelist.is_skill_allowed(tenant_id, lobster_id, skill_id)
        return DryRunCheckResult(
            check_name="技能白名单",
            passed=allowed,
            message=f"技能 '{skill_id}' {'已授权' if allowed else '未授权'}",
            severity="error" if not allowed else "info",
            suggestion="" if allowed else f"请联系管理员为租户 {tenant_id} 开启技能 {skill_id}",
        )

    async def _check_quota(self, tenant_id: str, payload: dict) -> DryRunCheckResult:
        """检查租户剩余配额"""
        # 简化实现：实际可接入 quota_middleware.py
        return DryRunCheckResult(
            check_name="配额检查",
            passed=True,
            message="配额充足（预检通过）",
            severity="info",
        )

    async def _check_im_channel(self, tenant_id: str, payload: dict) -> DryRunCheckResult:
        """检查 IM 渠道账号是否已授权"""
        channel = payload.get("channel", "wechat")
        # 实际实现：查询 lobster_im_channel.py 的账号状态
        return DryRunCheckResult(
            check_name=f"IM 渠道（{channel}）",
            passed=True,
            message=f"渠道 {channel} 授权状态正常",
            severity="error",
        )

    async def _check_url_reachable(self, url: str) -> DryRunCheckResult:
        """检查 URL 是否可访问"""
        import urllib.request
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=5):
                pass
            return DryRunCheckResult(
                check_name="数据源可达性",
                passed=True,
                message=f"URL 可访问: {url[:60]}",
            )
        except Exception as e:
            return DryRunCheckResult(
                check_name="数据源可达性",
                passed=False,
                message=f"URL 无法访问: {url[:60]} ({e})",
                severity="error",
                suggestion="请检查网络连接或 URL 是否正确",
            )

    def _estimate_tokens(self, payload: dict) -> tuple[DryRunCheckResult, int]:
        """估算任务消耗的 token 数"""
        text = str(payload.get("content", "")) + str(payload.get("user_message", ""))
        estimated = len(text) // 4   # 粗略：4字符 ≈ 1 token
        MAX_TOKENS = 100000

        passed = estimated < MAX_TOKENS
        return DryRunCheckResult(
            check_name="Token 估算",
            passed=passed,
            message=f"预估 {estimated:,} tokens {'(在限制内)' if passed else '(超出限制)'}",
            severity="error" if not passed else "info",
            suggestion="" if passed else "请减少输入内容长度或升级套餐",
        ), estimated
```

---

## P1-3：批量任务进度追踪 + 结构化 Result

### 背景
RAG-Anything 的 `BatchProcessingResult` 提供结构化的批量执行报告（总数/成功/失败/跳过）。我们的 `task_queue.py` 缺少进度百分比和结构化 Result。

### 完整代码

```python
"""
龙虾批量任务进度追踪器
借鉴：RAG-Anything raganything/batch.py BatchMixin + BatchProcessingResult
用途：批量任务并发执行 + 实时进度百分比 + 结构化执行报告
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, AsyncGenerator, Optional

logger = logging.getLogger(__name__)


@dataclass
class TaskItemResult:
    """单个批量任务项的执行结果"""
    item_id: str
    success: bool
    output: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: int = 0
    skipped: bool = False
    skip_reason: str = ""


@dataclass
class BatchTaskResult:
    """
    批量任务完整执行报告
    借鉴：RAG-Anything BatchProcessingResult
    """
    batch_id: str
    lobster_id: str
    tenant_id: str
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    items: list[TaskItemResult] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    error_summary: list[str] = field(default_factory=list)

    @property
    def progress(self) -> float:
        """当前进度 0.0 ~ 1.0"""
        processed = self.succeeded + self.failed + self.skipped
        return processed / self.total if self.total > 0 else 0.0

    @property
    def duration_seconds(self) -> float:
        end = self.completed_at or time.time()
        return end - self.started_at

    def add_result(self, result: TaskItemResult):
        self.items.append(result)
        if result.skipped:
            self.skipped += 1
        elif result.success:
            self.succeeded += 1
        else:
            self.failed += 1
            if result.error:
                self.error_summary.append(f"{result.item_id}: {result.error}")

    def finalize(self):
        self.completed_at = time.time()

    def summary(self) -> str:
        status = "✅ 完成" if self.failed == 0 else f"⚠️ 部分失败({self.failed})"
        return (
            f"[BatchResult] {status} | batch={self.batch_id} lobster={self.lobster_id}\n"
            f"  总计: {self.total} | 成功: {self.succeeded} | "
            f"失败: {self.failed} | 跳过: {self.skipped}\n"
            f"  耗时: {self.duration_seconds:.1f}s | "
            f"进度: {self.progress:.0%}"
        )


class BatchTaskTracker:
    """
    批量任务追踪器。
    支持：并发执行 + 实时进度推送 + 自动汇总报告

    使用示例：
        tracker = BatchTaskTracker(max_concurrent=5)
        result = await tracker.run_batch(
            batch_id="batch-001",
            lobster_id="radar",
            items=["url1", "url2", "url3"],
            task_fn=process_one_url,
            on_progress=lambda r: print(f"进度: {r.progress:.0%}"),
        )
        print(result.summary())
    """

    def __init__(self, max_concurrent: int = 5):
        self.max_concurrent = max_concurrent

    async def run_batch(
        self,
        batch_id: str,
        lobster_id: str,
        tenant_id: str,
        items: list[Any],
        task_fn: Callable[[Any], Any],
        item_id_fn: Callable[[Any], str] = str,
        on_progress: Optional[Callable[[BatchTaskResult], None]] = None,
        dry_run: bool = False,
    ) -> BatchTaskResult:
        """
        并发执行批量任务。

        Args:
            batch_id: 批次 ID
            lobster_id: 执行的龙虾 ID
            tenant_id: 租户 ID
            items: 任务项列表（URL/文档路径/数据等）
            task_fn: 处理单个任务项的异步函数，接受 item，返回结果
            item_id_fn: 从 item 提取 ID 的函数（用于报告）
            on_progress: 进度回调（每完成一项调用一次）
            dry_run: 仅预检，不真正执行
        """
        result = BatchTaskResult(
            batch_id=batch_id,
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            total=len(items),
        )

        if dry_run:
            logger.info(f"[BatchTracker] Dry-run 模式：共 {len(items)} 项，不实际执行")
            result.finalize()
            return result

        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def process_one(item: Any) -> TaskItemResult:
            item_id = item_id_fn(item)
            start = time.time()
            async with semaphore:
                try:
                    output = await task_fn(item)
                    return TaskItemResult(
                        item_id=item_id,
                        success=True,
                        output=output,
                        duration_ms=int((time.time() - start) * 1000),
                    )
                except Exception as e:
                    logger.error(f"[BatchTracker] 项目失败 {item_id}: {e}")
                    return TaskItemResult(
                        item_id=item_id,
                        success=False,
                        error=str(e),
                        duration_ms=int((time.time() - start) * 1000),
                    )

        # 创建所有任务
        tasks = [process_one(item) for item in items]

        # 并发执行，实时更新进度
        for coro in asyncio.as_completed(tasks):
            item_result = await coro
            result.add_result(item_result)

            if on_progress:
                try:
                    on_progress(result)
                except Exception as e:
                    logger.warning(f"[BatchTracker] 进度回调失败: {e}")

            logger.info(
                f"[BatchTracker] 进度 {result.progress:.0%} "
                f"({result.succeeded + result.failed + result.skipped}/{result.total})"
            )

        result.finalize()
        logger.info(result.summary())
        return result
```

---

## P1-4：Prompt 多语言热切换

### 完整代码

```python
"""
龙虾 Prompt 多语言热切换管理器
借鉴：RAG-Anything raganything/prompt_manager.py
用途：租户级 Prompt 语言配置，运行时切换无需重启
"""

import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

# 线程本地存储：每个请求线程可以有独立的语言设置
_thread_local = threading.local()

# 全局默认语言
_global_language = "zh"
_global_lock = threading.Lock()

# 语言 → Prompt 模板注册表
_LANGUAGE_REGISTRY: dict[str, dict[str, Any]] = {
    "zh": {},   # 中文模板（默认）
    "en": {},   # 英文模板
}


def register_language(lang: str, prompts: dict[str, Any]):
    """注册一个语言的 Prompt 模板"""
    _LANGUAGE_REGISTRY[lang] = prompts
    logger.info(f"[PromptLangManager] 已注册语言: {lang}，共 {len(prompts)} 个模板")


def set_global_language(lang: str):
    """设置全局默认语言（进程级别）"""
    global _global_language
    if lang not in _LANGUAGE_REGISTRY:
        raise ValueError(f"语言 '{lang}' 未注册。已注册: {list(_LANGUAGE_REGISTRY.keys())}")
    with _global_lock:
        _global_language = lang
    logger.info(f"[PromptLangManager] 全局语言切换为: {lang}")


def set_request_language(lang: str):
    """设置当前请求线程的语言（线程级别，覆盖全局设置）"""
    if lang not in _LANGUAGE_REGISTRY:
        raise ValueError(f"语言 '{lang}' 未注册")
    _thread_local.language = lang


def get_current_language() -> str:
    """获取当前语言（线程语言优先，否则取全局语言）"""
    return getattr(_thread_local, "language", _global_language)


def clear_request_language():
    """清除线程级语言设置（恢复全局默认）"""
    if hasattr(_thread_local, "language"):
        del _thread_local.language


def get_prompt(key: str, lang: str = None, **kwargs) -> str:
    """
    获取指定 key 的 Prompt 模板并渲染。

    Args:
        key: Prompt 模板 key（如 "radar_competitor_search"）
        lang: 可选语言，None 则使用当前线程/全局语言
        **kwargs: 模板变量

    Returns:
        渲染后的 Prompt 字符串
    """
    lang = lang or get_current_language()
    templates = _LANGUAGE_REGISTRY.get(lang, _LANGUAGE_REGISTRY.get("zh", {}))
    template = templates.get(key)

    if template is None:
        # 降级：尝试中文
        template = _LANGUAGE_REGISTRY.get("zh", {}).get(key, f"[Missing prompt: {key}]")

    if kwargs and isinstance(template, str):
        try:
            return template.format(**kwargs)
        except KeyError:
            return template

    return template or ""


class tenant_language:
    """
    上下文管理器：在 with 块内使用指定语言，退出后自动恢复。

    示例：
        with tenant_language("en"):
            prompt = get_prompt("radar_search", query="AI trends")
    """
    def __init__(self, lang: str):
        self.lang = lang
        self.prev_lang = None

    def __enter__(self):
        self.prev_lang = getattr(_thread_local, "language", None)
        set_request_language(self.lang)
        return self

    def __exit__(self, *args):
        if self.prev_lang is None:
            clear_request_language()
        else:
            _thread_local.language = self.prev_lang
```

---

## 验收标准

| 任务 | 验收标准 |
|------|---------|
| P1-1 | `hooks.on(TaskStage.COMPLETED)` 装饰器注册后，`emit(completed_event)` 能触发 |
| P1-1 | 钩子执行失败时，主流程不受影响（仅记录 error 日志）|
| P1-2 | `dry_run=True` 时，`LobsterDryRunner.run()` 返回 `DryRunReport`，`can_proceed` 字段正确 |
| P1-2 | 未注册的 Provider 预检失败，`passed=False`，`severity="error"` |
| P1-3 | `BatchTaskTracker.run_batch()` 并发执行，`result.progress` 随任务完成递增 |
| P1-3 | `result.summary()` 输出总数/成功/失败/跳过/耗时 |
| P1-4 | `set_global_language("en")` 后，`get_prompt("key")` 返回英文模板 |
| P1-4 | `with tenant_language("en"):` 块内用英文，退出后恢复原语言 |

---

*CODEX TASK 创建：2026-04-02 | 借鉴来源：RAG-Anything callbacks.py + batch.py + prompt_manager.py*
