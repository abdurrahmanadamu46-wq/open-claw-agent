# CODEX TASK: pkgx 借鉴 P1 任务包
> 来源分析：`docs/PKGX_BORROWING_ANALYSIS.md`
> 优先级：P1（立即可落地）
> 创建日期：2026-04-02

---

## 任务总览

| # | 任务名 | 目标文件 | 估时 |
|---|--------|---------|------|
| P1-1 | 龙虾任务幂等执行锁 | `dragon-senate-saas-v2/task_idempotency_lock.py` | 0.5天 |
| P1-2 | Resolution 三段任务状态 | `dragon-senate-saas-v2/task_resolution.py` | 1天 |
| P1-3 | 龙虾执行上下文零泄漏沙箱 | `dragon-senate-saas-v2/lobster_context_injector.py` | 1天 |
| P1-4 | Agent 行为边界 CI 自动校验 | `scripts/agent_boundary_check.py` | 0.5天 |
| P1-5 | Provider 语义版本约束路由 | `dragon-senate-saas-v2/provider_version_selector.py` | 0.5天 |

---

## P1-1：龙虾任务幂等执行锁

### 背景
pkgx 的 `install.rs` 用 `fs2::FileExt` 文件锁确保同一包同时只有一个安装进程。我们的龙虾任务存在并发重复执行问题（用户重复提交/网络重试），导致输出重复或资源浪费。

### 完整代码

```python
"""
龙虾任务幂等执行锁
借鉴：pkgx crates/lib/src/install.rs fs2::FileExt 文件锁
用途：同一 task_id 同时只允许一个龙虾执行实例，防止并发重复执行
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


class TaskAlreadyRunningError(Exception):
    """任务正在执行中，不允许并发重复执行"""
    def __init__(self, task_id: str, started_at: float):
        self.task_id = task_id
        self.started_at = started_at
        super().__init__(
            f"任务 {task_id} 已在执行中（started_at={started_at:.0f}），拒绝重复执行"
        )


@dataclass
class LockInfo:
    task_id: str
    lobster_id: str
    tenant_id: str
    acquired_at: float
    ttl_seconds: int = 300   # 最长锁定 5 分钟


class TaskIdempotencyLock:
    """
    龙虾任务幂等执行锁。

    借鉴 pkgx fs2::FileExt 文件锁设计，适配为 Python 内存锁（单进程）
    或 Redis 分布式锁（多进程/多节点）。

    使用示例：
        lock = TaskIdempotencyLock()

        async with lock.acquire("task-001", "radar", "tenant-A"):
            # 只有一个实例能进入此块
            result = await radar.run(task)
    """

    def __init__(self, backend: str = "memory"):
        """
        Args:
            backend: "memory"（单进程）或 "redis"（分布式）
        """
        self._backend = backend
        self._memory_locks: dict[str, LockInfo] = {}
        self._lock = asyncio.Lock()
        self._redis = None   # 延迟初始化

    async def _get_redis(self):
        """懒加载 Redis 连接"""
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                self._redis = await aioredis.from_url("redis://localhost:6379")
            except ImportError:
                logger.warning("[IdempotencyLock] redis 包未安装，降级为内存锁")
                self._backend = "memory"
        return self._redis

    @asynccontextmanager
    async def acquire(
        self,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        ttl_seconds: int = 300,
    ):
        """
        获取任务执行锁的异步上下文管理器。

        Raises:
            TaskAlreadyRunningError: 任务已在执行中
        """
        lock_key = f"task_lock:{task_id}"
        acquired = False

        try:
            if self._backend == "redis":
                acquired = await self._acquire_redis(lock_key, task_id, lobster_id, tenant_id, ttl_seconds)
            else:
                acquired = await self._acquire_memory(task_id, lobster_id, tenant_id, ttl_seconds)

            if not acquired:
                existing = self._memory_locks.get(task_id)
                started_at = existing.acquired_at if existing else time.time()
                raise TaskAlreadyRunningError(task_id, started_at)

            logger.info(f"[IdempotencyLock] 获取锁 task={task_id} lobster={lobster_id}")
            yield

        finally:
            if acquired:
                await self._release(lock_key, task_id)
                logger.info(f"[IdempotencyLock] 释放锁 task={task_id}")

    async def _acquire_memory(
        self, task_id: str, lobster_id: str, tenant_id: str, ttl_seconds: int
    ) -> bool:
        """内存锁实现（单进程场景）"""
        async with self._lock:
            now = time.time()
            # 清理过期锁
            expired = [
                tid for tid, info in self._memory_locks.items()
                if now - info.acquired_at > info.ttl_seconds
            ]
            for tid in expired:
                del self._memory_locks[tid]
                logger.warning(f"[IdempotencyLock] 清理过期锁: {tid}")

            if task_id in self._memory_locks:
                return False

            self._memory_locks[task_id] = LockInfo(
                task_id=task_id,
                lobster_id=lobster_id,
                tenant_id=tenant_id,
                acquired_at=now,
                ttl_seconds=ttl_seconds,
            )
            return True

    async def _acquire_redis(
        self, lock_key: str, task_id: str, lobster_id: str, tenant_id: str, ttl_seconds: int
    ) -> bool:
        """Redis 分布式锁实现（多进程/多节点场景）"""
        redis = await self._get_redis()
        if self._backend == "memory":
            return await self._acquire_memory(task_id, lobster_id, tenant_id, ttl_seconds)

        import json
        value = json.dumps({
            "task_id": task_id,
            "lobster_id": lobster_id,
            "tenant_id": tenant_id,
            "acquired_at": time.time(),
        })
        # SET NX EX：只有不存在时才设置，有效期 ttl_seconds
        result = await redis.set(lock_key, value, nx=True, ex=ttl_seconds)
        return result is True

    async def _release(self, lock_key: str, task_id: str):
        """释放锁"""
        if self._backend == "redis" and self._redis:
            await self._redis.delete(lock_key)
        else:
            async with self._lock:
                self._memory_locks.pop(task_id, None)

    async def is_locked(self, task_id: str) -> bool:
        """查询任务是否正在执行"""
        if self._backend == "redis" and self._redis:
            redis = await self._get_redis()
            return await redis.exists(f"task_lock:{task_id}") > 0
        async with self._lock:
            info = self._memory_locks.get(task_id)
            if info is None:
                return False
            # 检查是否过期
            return time.time() - info.acquired_at <= info.ttl_seconds


# 全局单例
_global_lock = TaskIdempotencyLock(backend="memory")


def get_idempotency_lock() -> TaskIdempotencyLock:
    """获取全局幂等锁单例"""
    return _global_lock
```

---

## P1-2：Resolution 三段任务状态

### 背景
pkgx 的 `resolve.rs` 将依赖分为三段：全集(pkgs)/已有(installed)/待装(pending)。Commander 执行任务时可精确知道"哪些已完成、哪些需要做"，避免重复工作。我们的 `lobster_task_dag.py` 缺少这种三段状态分类。

### 完整代码

```python
"""
龙虾任务 Resolution 三段状态解析器
借鉴：pkgx crates/lib/src/resolve.rs Resolution 结构体
用途：任务提交时精确计算 required/satisfied/pending，避免重复执行已完成的子任务
"""

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SkillStatus(str, Enum):
    """技能状态"""
    REQUIRED = "required"       # 需要的（全集）
    SATISFIED = "satisfied"     # 已满足（缓存命中/已完成）
    PENDING = "pending"         # 待执行
    RUNNING = "running"         # 执行中
    FAILED = "failed"           # 失败


@dataclass
class SkillRef:
    """技能引用（类比 pkgx 的 PackageReq）"""
    skill_id: str
    lobster_id: str
    version_constraint: str = "*"   # 版本约束，"*" = 任意版本
    params: dict = field(default_factory=dict)


@dataclass
class SatisfiedSkill:
    """已满足的技能（类比 pkgx 的 Installation）"""
    skill_id: str
    lobster_id: str
    version: str
    cached_result: Optional[Any] = None
    completed_at: Optional[float] = None


@dataclass
class TaskResolution:
    """
    任务解析结果 - 三段结构。
    借鉴 pkgx Resolution { pkgs, installed, pending }

    字段：
        required:  本次任务所需的全部技能（全集）
        satisfied: 已在缓存/已完成的技能（可直接复用）
        pending:   需要实际执行的技能（差集 = required - satisfied）
    """
    task_id: str
    lobster_id: str
    tenant_id: str
    required: list[SkillRef] = field(default_factory=list)
    satisfied: list[SatisfiedSkill] = field(default_factory=list)
    pending: list[SkillRef] = field(default_factory=list)
    resolved_at: float = field(default_factory=time.time)

    @property
    def is_fully_satisfied(self) -> bool:
        """是否全部已满足（无需执行）"""
        return len(self.pending) == 0

    @property
    def satisfaction_rate(self) -> float:
        """满足率（缓存命中率）"""
        if not self.required:
            return 1.0
        return len(self.satisfied) / len(self.required)

    def summary(self) -> str:
        return (
            f"[Resolution] task={self.task_id} lobster={self.lobster_id}\n"
            f"  required={len(self.required)} | "
            f"satisfied={len(self.satisfied)} | "
            f"pending={len(self.pending)}\n"
            f"  缓存命中率: {self.satisfaction_rate:.0%}"
        )


class TaskResolver:
    """
    任务解析器。
    给定任务需求，计算 Resolution（required/satisfied/pending）。

    使用示例：
        resolver = TaskResolver(skill_cache=cache)
        resolution = await resolver.resolve(
            task_id="task-001",
            lobster_id="commander",
            tenant_id="tenant-A",
            required_skills=[
                SkillRef("competitor_search", "radar"),
                SkillRef("data_analysis", "abacus"),
                SkillRef("content_write", "inkwriter"),
            ]
        )
        # 只执行 pending，跳过 satisfied
        for skill_ref in resolution.pending:
            await execute_skill(skill_ref)
    """

    def __init__(self, skill_cache=None):
        """
        Args:
            skill_cache: 技能结果缓存（可注入任意缓存实现）
        """
        self._cache = skill_cache or {}

    async def resolve(
        self,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        required_skills: list[SkillRef],
    ) -> TaskResolution:
        """
        计算任务的 Resolution。

        对每个 required skill：
        1. 检查缓存是否命中（版本约束满足 + 未过期）
        2. 命中 → 加入 satisfied
        3. 未命中 → 加入 pending
        """
        resolution = TaskResolution(
            task_id=task_id,
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            required=required_skills,
        )

        for skill_ref in required_skills:
            cached = await self._check_cache(tenant_id, skill_ref)
            if cached:
                resolution.satisfied.append(cached)
                logger.debug(
                    f"[Resolver] 缓存命中 {skill_ref.skill_id}@{cached.version}"
                )
            else:
                resolution.pending.append(skill_ref)
                logger.debug(f"[Resolver] 待执行 {skill_ref.skill_id}")

        logger.info(resolution.summary())
        return resolution

    async def _check_cache(
        self, tenant_id: str, skill_ref: SkillRef
    ) -> Optional[SatisfiedSkill]:
        """
        检查技能缓存命中。

        缓存 key：{tenant_id}:{lobster_id}:{skill_id}
        值：SatisfiedSkill（含已完成时间戳）
        """
        cache_key = f"{tenant_id}:{skill_ref.lobster_id}:{skill_ref.skill_id}"

        if isinstance(self._cache, dict):
            cached = self._cache.get(cache_key)
        else:
            # 支持 Redis / 任意缓存后端
            cached = await self._async_get(cache_key)

        if cached is None:
            return None

        # 检查版本约束
        if not self._version_satisfies(cached.version, skill_ref.version_constraint):
            logger.debug(
                f"[Resolver] 版本不满足 {skill_ref.skill_id}: "
                f"cached={cached.version} constraint={skill_ref.version_constraint}"
            )
            return None

        return cached

    def _version_satisfies(self, version: str, constraint: str) -> bool:
        """简化版本约束检查（支持 * / >=x.y / ==x.y.z）"""
        if constraint == "*":
            return True
        if constraint.startswith(">="):
            min_ver = constraint[2:].strip()
            return self._ver_cmp(version, min_ver) >= 0
        if constraint.startswith("=="):
            exact = constraint[2:].strip()
            return version == exact
        return True

    def _ver_cmp(self, v1: str, v2: str) -> int:
        """语义版本比较，返回 -1/0/1"""
        def parse(v):
            parts = v.split(".")
            return tuple(int(x) for x in parts if x.isdigit())
        t1, t2 = parse(v1), parse(v2)
        if t1 < t2:
            return -1
        if t1 > t2:
            return 1
        return 0

    async def _async_get(self, key: str):
        """异步获取缓存值（供 Redis 后端重写）"""
        return self._cache.get(key) if isinstance(self._cache, dict) else None

    async def mark_satisfied(
        self,
        tenant_id: str,
        skill_ref: SkillRef,
        version: str,
        result: Any,
        ttl_seconds: int = 3600,
    ):
        """将执行完成的技能结果写入缓存"""
        cache_key = f"{tenant_id}:{skill_ref.lobster_id}:{skill_ref.skill_id}"
        satisfied = SatisfiedSkill(
            skill_id=skill_ref.skill_id,
            lobster_id=skill_ref.lobster_id,
            version=version,
            cached_result=result,
            completed_at=time.time(),
        )
        if isinstance(self._cache, dict):
            self._cache[cache_key] = satisfied
        logger.info(f"[Resolver] 技能结果已缓存: {cache_key}")
```

---

## P1-3：龙虾执行上下文零泄漏沙箱

### 背景
pkgx 的 `execve.rs` 用精确的环境变量集合替换进程上下文，执行后零残留。我们的龙虾执行存在上下文（tenant_id/session_vars）跨请求污染风险。

### 完整代码

```python
"""
龙虾执行上下文零泄漏沙箱
借鉴：pkgx crates/cli/src/execve.rs 环境注入设计
用途：每次龙虾执行前构建精确隔离的上下文，执行后自动清理，防止跨租户泄漏
"""

import asyncio
import contextvars
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 上下文变量（线程/协程安全）
_current_context: contextvars.ContextVar[Optional["LobsterContext"]] = \
    contextvars.ContextVar("lobster_context", default=None)


@dataclass
class LobsterContext:
    """
    龙虾执行上下文（类比 pkgx execve 的环境变量集合）。

    精确定义本次执行的所有上下文变量，执行完毕后自动清理。
    """
    task_id: str
    lobster_id: str
    tenant_id: str
    skill_id: str = ""
    session_id: str = ""
    user_id: str = ""
    params: dict = field(default_factory=dict)
    provider_name: str = "openai"
    created_at: float = field(default_factory=time.time)
    # 运行时注入的变量（只在执行期间存在）
    _runtime_vars: dict = field(default_factory=dict, repr=False)

    def inject(self, key: str, value: Any):
        """运行时注入变量"""
        self._runtime_vars[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        """获取上下文变量（params > runtime_vars > default）"""
        if key in self.params:
            return self.params[key]
        return self._runtime_vars.get(key, default)

    def clear(self):
        """清理运行时变量（保留基础字段）"""
        self._runtime_vars.clear()

    def to_env_dict(self) -> dict[str, str]:
        """
        导出为环境变量字典（类比 pkgx execve 的环境注入）。
        只包含本次任务需要的最小变量集合。
        """
        env = {
            "LOBSTER_TASK_ID": self.task_id,
            "LOBSTER_ID": self.lobster_id,
            "LOBSTER_TENANT_ID": self.tenant_id,
            "LOBSTER_SKILL_ID": self.skill_id,
            "LOBSTER_SESSION_ID": self.session_id,
            "LOBSTER_PROVIDER": self.provider_name,
        }
        # 注入 params（转为 LOBSTER_PARAM_* 格式）
        for k, v in self.params.items():
            env[f"LOBSTER_PARAM_{k.upper()}"] = str(v)
        return env


def get_current_context() -> Optional[LobsterContext]:
    """获取当前协程/线程的龙虾上下文"""
    return _current_context.get()


def require_context() -> LobsterContext:
    """获取当前上下文，不存在则抛出异常"""
    ctx = _current_context.get()
    if ctx is None:
        raise RuntimeError("无龙虾执行上下文，请在 lobster_context() 内部调用")
    return ctx


@asynccontextmanager
async def lobster_context(
    task_id: str,
    lobster_id: str,
    tenant_id: str,
    skill_id: str = "",
    **params,
):
    """
    龙虾执行上下文管理器。

    借鉴 pkgx execve 的精确上下文注入，在此块内：
    1. 注入精确的执行上下文
    2. 执行结束后自动清理
    3. 不同协程之间完全隔离（基于 ContextVar）

    使用示例：
        async with lobster_context("task-001", "radar", "tenant-A", skill_id="search"):
            ctx = get_current_context()
            print(ctx.tenant_id)   # "tenant-A"
            result = await radar.run()
        # 退出后上下文自动清理
    """
    ctx = LobsterContext(
        task_id=task_id,
        lobster_id=lobster_id,
        tenant_id=tenant_id,
        skill_id=skill_id,
        params=params,
    )

    token = _current_context.set(ctx)
    logger.info(
        f"[ContextInjector] 注入上下文 task={task_id} "
        f"lobster={lobster_id} tenant={tenant_id}"
    )

    try:
        yield ctx
    finally:
        ctx.clear()
        _current_context.reset(token)
        logger.info(f"[ContextInjector] 清理上下文 task={task_id}")


class LobsterContextInjector:
    """
    龙虾上下文注入器（适配 lobster_runner.py 调用方式）。

    将 lobster_context 上下文管理器包装为注入器类，
    便于在 lobster_runner.py 中统一管理。
    """

    async def run_with_context(
        self,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        skill_id: str,
        coro,
        **params,
    ):
        """
        在隔离上下文中执行协程。

        Args:
            coro: 待执行的协程（龙虾业务逻辑）
        """
        async with lobster_context(task_id, lobster_id, tenant_id, skill_id, **params):
            return await coro

    def get_context_snapshot(self) -> Optional[dict]:
        """获取当前上下文的快照（用于日志/监控）"""
        ctx = get_current_context()
        if ctx is None:
            return None
        return {
            "task_id": ctx.task_id,
            "lobster_id": ctx.lobster_id,
            "tenant_id": ctx.tenant_id,
            "skill_id": ctx.skill_id,
            "age_seconds": round(time.time() - ctx.created_at, 2),
        }
```

---

## P1-4：Agent 行为边界 CI 自动校验

### 背景
pkgx 的 `agent-boundary-check.yml` 在 CI 中自动检查 AI agent 的操作是否符合 `AGENTS.md` 边界规则。我们有 `AGENTS.md` 但没有 CI 自动校验。

### 完整代码

```python
"""
Agent 行为边界 CI 自动校验脚本
借鉴：pkgx .github/workflows/agent-boundary-check.yml
用途：在 CI 中自动检查 agent 修改是否符合 AGENTS.md 定义的边界规则
运行：python scripts/agent_boundary_check.py [--diff-file changes.txt]
"""

import sys
import re
import argparse
import subprocess
from pathlib import Path
from dataclasses import dataclass, field

# 从 AGENTS.md 提取的边界规则（可扩展为动态读取）
NEVER_TOUCH_PATTERNS = [
    r"\.env$",                   # 环境变量文件
    r"secrets/",                 # 密钥目录
    r"\.pem$",                   # 证书文件
    r"saas_billing\.py",         # 计费核心，禁止直接修改
    r"rbac_permission\.py",      # 权限系统
    r"platform_governance\.py",  # 平台治理
]

# 需要审批才能修改的文件（警告，不阻断）
REQUIRE_REVIEW_PATTERNS = [
    r"lobster_constitution\.md",
    r"AGENTS\.md",
    r"provider_registry\.py",
    r"dragon_dashboard\.html",
]

# 允许 agent 自由修改的目录
SAFE_DIRS = [
    "docs/",
    "scripts/",
    "tests/",
    "dragon-senate-saas-v2/lobsters/",
    "docs/lobster-kb/",
]


@dataclass
class BoundaryViolation:
    file_path: str
    rule: str
    severity: str   # "error" | "warning"
    message: str


@dataclass
class BoundaryCheckResult:
    violations: list[BoundaryViolation] = field(default_factory=list)
    checked_files: int = 0

    @property
    def has_errors(self) -> bool:
        return any(v.severity == "error" for v in self.violations)

    @property
    def has_warnings(self) -> bool:
        return any(v.severity == "warning" for v in self.violations)

    def summary(self) -> str:
        errors = [v for v in self.violations if v.severity == "error"]
        warnings = [v for v in self.violations if v.severity == "warning"]
        lines = [
            f"[AgentBoundaryCheck] 检查了 {self.checked_files} 个文件",
            f"  错误: {len(errors)} | 警告: {len(warnings)}",
        ]
        for v in self.violations:
            icon = "❌" if v.severity == "error" else "⚠️"
            lines.append(f"  {icon} {v.file_path}: {v.message}")
        return "\n".join(lines)


def get_changed_files(diff_file: str = None) -> list[str]:
    """获取变更文件列表（从 git diff 或文件读取）"""
    if diff_file:
        with open(diff_file) as f:
            return [line.strip() for line in f if line.strip()]

    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, check=True
        )
        files = result.stdout.strip().split("\n")
        # 也包含暂存区文件
        result2 = subprocess.run(
            ["git", "diff", "--name-only", "--cached"],
            capture_output=True, text=True, check=True
        )
        files += result2.stdout.strip().split("\n")
        return [f for f in set(files) if f]
    except subprocess.CalledProcessError:
        print("[AgentBoundaryCheck] 无法获取 git diff，跳过检查")
        return []


def check_boundaries(changed_files: list[str]) -> BoundaryCheckResult:
    """检查变更文件是否越出边界"""
    result = BoundaryCheckResult(checked_files=len(changed_files))

    for file_path in changed_files:
        # 检查 NEVER_TOUCH 规则
        for pattern in NEVER_TOUCH_PATTERNS:
            if re.search(pattern, file_path):
                result.violations.append(BoundaryViolation(
                    file_path=file_path,
                    rule=pattern,
                    severity="error",
                    message=f"违反 AGENTS.md 'Never Do' 规则，禁止修改此文件（pattern: {pattern}）",
                ))

        # 检查需要审批的文件
        for pattern in REQUIRE_REVIEW_PATTERNS:
            if re.search(pattern, file_path):
                result.violations.append(BoundaryViolation(
                    file_path=file_path,
                    rule=pattern,
                    severity="warning",
                    message=f"此文件需要人工审批后才能合并（pattern: {pattern}）",
                ))

    return result


def main():
    parser = argparse.ArgumentParser(description="Agent 行为边界 CI 校验")
    parser.add_argument("--diff-file", help="包含变更文件列表的文件（每行一个文件路径）")
    parser.add_argument("--strict", action="store_true", help="警告也视为错误")
    args = parser.parse_args()

    changed_files = get_changed_files(args.diff_file)
    if not changed_files:
        print("[AgentBoundaryCheck] 无变更文件，校验通过")
        sys.exit(0)

    result = check_boundaries(changed_files)
    print(result.summary())

    if result.has_errors:
        print("\n❌ 边界检查失败：存在违规修改，请检查 AGENTS.md 规则")
        sys.exit(1)
    elif result.has_warnings and args.strict:
        print("\n❌ 严格模式：存在需要审批的文件")
        sys.exit(1)
    else:
        print("\n✅ 边界检查通过")
        sys.exit(0)


if __name__ == "__main__":
    main()
```

---

## P1-5：Provider 语义版本约束路由

### 完整代码

```python
"""
Provider 语义版本约束路由
借鉴：pkgx crates/lib/src/inventory.rs 语义版本约束过滤
用途：技能声明兼容的 LLM 版本范围，自动路由到满足约束的最高版本 Provider
"""

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ProviderInfo:
    """Provider 信息"""
    name: str
    model: str
    version: str          # 语义版本（如 "4.1", "4.0", "3.5"）
    priority: int = 0     # 优先级，越高越优先（满足约束时选最高优先级）
    available: bool = True


class ProviderVersionSelector:
    """
    Provider 语义版本约束路由器。

    借鉴 pkgx inventory::select() 语义版本过滤逻辑：
    - 过滤满足版本约束的 Provider
    - 在满足约束的 Provider 中选最高版本（或最高优先级）

    使用示例：
        selector = ProviderVersionSelector()
        selector.register(ProviderInfo("openai-gpt4o", "gpt-4o", "4.1", priority=10))
        selector.register(ProviderInfo("openai-gpt4", "gpt-4", "4.0", priority=8))
        selector.register(ProviderInfo("openai-gpt35", "gpt-3.5-turbo", "3.5", priority=5))

        # 技能要求 gpt >= 4.0
        provider = selector.select(constraint=">=4.0")
        # → 选 gpt-4o（版本 4.1，满足 >=4.0 且最高）
    """

    def __init__(self):
        self._providers: list[ProviderInfo] = []

    def register(self, provider: ProviderInfo):
        """注册一个 Provider"""
        self._providers.append(provider)
        logger.info(f"[VersionSelector] 注册 {provider.name} v{provider.version}")

    def select(self, constraint: str = "*", tenant_id: str = "") -> ProviderInfo | None:
        """
        选择满足版本约束的最优 Provider。

        Args:
            constraint: 版本约束（"*" / ">=4.0" / "==4.1" / "<4.0"）
            tenant_id: 租户 ID（用于租户级 Provider 覆盖，暂留）

        Returns:
            满足约束的最高版本/最高优先级 Provider，无满足时返回 None
        """
        candidates = [
            p for p in self._providers
            if p.available and self._satisfies(p.version, constraint)
        ]

        if not candidates:
            logger.warning(
                f"[VersionSelector] 无满足约束 '{constraint}' 的 Provider"
            )
            return None

        # 先按版本降序，再按优先级降序
        selected = max(
            candidates,
            key=lambda p: (self._parse_version(p.version), p.priority)
        )
        logger.info(
            f"[VersionSelector] 约束='{constraint}' → 选择 {selected.name} v{selected.version}"
        )
        return selected

    def _satisfies(self, version: str, constraint: str) -> bool:
        """版本约束检查"""
        if constraint == "*":
            return True

        v = self._parse_version(version)

        # 支持 >= / <= / == / > / < / != 及组合（逗号分隔）
        parts = [c.strip() for c in constraint.split(",")]
        for part in parts:
            if not self._check_single(v, part):
                return False
        return True

    def _check_single(self, v: tuple, constraint: str) -> bool:
        """单个约束检查"""
        m = re.match(r"(>=|<=|==|!=|>|<)\s*(.+)", constraint)
        if not m:
            return True
        op, ver_str = m.group(1), m.group(2).strip()
        c = self._parse_version(ver_str)
        if op == ">=":
            return v >= c
        if op == "<=":
            return v <= c
        if op == "==":
            return v == c
        if op == "!=":
            return v != c
        if op == ">":
            return v > c
        if op == "<":
            return v < c
        return True

    def _parse_version(self, version: str) -> tuple:
        """解析版本字符串为可比较的 tuple"""
        parts = re.split(r"[.\-]", version)
        result = []
        for p in parts:
            try:
                result.append(int(p))
            except ValueError:
                pass
        return tuple(result) if result else (0,)

    def list_providers(self, constraint: str = "*") -> list[ProviderInfo]:
        """列出满足约束的所有 Provider"""
        return [
            p for p in self._providers
            if p.available and self._satisfies(p.version, constraint)
        ]
```

---

## 验收标准

| 任务 | 验收标准 |
|------|---------|
| P1-1 | 同一 task_id 第二次 `acquire()` 抛出 `TaskAlreadyRunningError` |
| P1-1 | `with lock.acquire()` 退出后，`is_locked(task_id)` 返回 False |
| P1-2 | `TaskResolver.resolve()` 缓存命中的 skill 进入 satisfied，未命中进入 pending |
| P1-2 | `resolution.is_fully_satisfied` 为 True 时，pending 列表为空 |
| P1-3 | `get_current_context()` 在 `lobster_context()` 块外返回 None |
| P1-3 | 两个并发协程使用不同 tenant_id，`get_current_context().tenant_id` 互不干扰 |
| P1-4 | 修改 `.env` 文件时，`agent_boundary_check.py` 退出码为 1 |
| P1-4 | 修改 `docs/` 下的文件时，退出码为 0 |
| P1-5 | `selector.select(">=4.0")` 在注册了 3.5/4.0/4.1 时返回 4.1 |
| P1-5 | 无满足约束的 Provider 时返回 None，不抛出异常 |

---

*CODEX TASK 创建：2026-04-02 | 借鉴来源：pkgx resolve.rs + install.rs + execve.rs + inventory.rs + agent-boundary-check.yml*
