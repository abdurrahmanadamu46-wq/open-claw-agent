# Codex 任务：审批流集成 (CODEX-MC-03)

## 任务目标

借鉴 OpenClaw Mission Control 的 `Approval` 模型，在 `dragon-senate-saas-v2/` 中创建审批流系统：
1. 新建 `approval_manager.py` — 审批数据模型 + 管理逻辑
2. 修改 `lobster_runner.py` — 在关键操作前插入审批检查点
3. 修改 `app.py` — 添加审批相关 API 端点

---

## 设计灵感

Mission Control 的 Approval 模型核心字段：
```python
# Mission Control 的做法（参考，不要照搬）
class Approval:
    action_type: str        # 触发审批的操作类型
    confidence: float       # AI 置信度 (0.0~1.0)
    rubric_scores: dict     # 评分维度
    status: str             # pending | approved | rejected | expired
    board_id: UUID          # 关联的工作空间
    task_id: UUID           # 关联的任务
    agent_id: UUID          # 触发审批的 agent
```

我们的实现要更轻量，使用现有的 SQLAlchemy async + SQLite 基础设施（与 `audit_logger.py` 一致）。

---

## 文件 1：新建 `dragon-senate-saas-v2/approval_manager.py`

### 完整实现

```python
"""
approval_manager.py — 审批流管理模块
====================================
借鉴 OpenClaw Mission Control 的 Approval 模式，为龙虾系统提供：
1. 审批请求创建（任何龙虾在执行高风险操作前必须提交）
2. 审批决策（人类审核 approve/reject）
3. 审批状态查询
4. 与 audit_logger 集成（每次审批决策自动记录审计日志）

设计原则：
- Approval 是 first-class 实体，不是日志的附属品
- 支持 confidence 评分（AI 自评操作置信度）
- 支持 rubric_scores（多维度评分）
- 支持超时自动过期
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


# ---------------------------------------------------------------------------
# Config — 复用 audit_logger 的数据库连接模式
# ---------------------------------------------------------------------------

def _normalize_db_url(db_url: str) -> str:
    if db_url.startswith("sqlite:///"):
        return db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return db_url


def _approval_db_url() -> str:
    raw = os.getenv("APPROVAL_DATABASE_URL", "").strip()
    if raw:
        return _normalize_db_url(raw)
    fallback = os.getenv("DATABASE_URL", "sqlite:///data/approval.sqlite").strip()
    return _normalize_db_url(fallback)


_engine = create_async_engine(_approval_db_url(), echo=False)
_async_session = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def approval_session() -> AsyncGenerator[AsyncSession, None]:
    async with _async_session() as session:
        yield session


# ---------------------------------------------------------------------------
# ORM Model
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class ApprovalEntry(Base):
    __tablename__ = "approvals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    approval_id = Column(String(64), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)

    # Who
    tenant_id = Column(String(128), nullable=False, index=True)
    lobster_id = Column(String(64), nullable=False, index=True)  # which lobster requested
    user_id = Column(String(128), nullable=True)  # which user will approve
    resolved_by = Column(String(128), nullable=True)  # who actually approved/rejected

    # What
    action_type = Column(String(128), nullable=False, index=True)  # e.g. "publish", "payment", "edge_deploy"
    resource_type = Column(String(128), nullable=True)  # e.g. "campaign", "content_pack"
    resource_id = Column(String(256), nullable=True)
    summary = Column(Text, nullable=False)
    detail_json = Column(Text, nullable=True)

    # AI Assessment
    confidence = Column(Float, nullable=False, default=0.5)  # 0.0~1.0 — AI 自评置信度
    rubric_scores_json = Column(Text, nullable=True)  # JSON dict of dimension→score

    # Decision
    status = Column(String(32), nullable=False, default="pending", index=True)
    # pending | approved | rejected | expired | auto_approved
    rejection_reason = Column(Text, nullable=True)

    # Context
    trace_id = Column(String(128), nullable=True)
    source = Column(String(64), nullable=False, default="lobster")

    __table_args__ = (
        Index("idx_approval_tenant_status", "tenant_id", "status"),
        Index("idx_approval_lobster_status", "lobster_id", "status"),
        Index("idx_approval_created", "created_at"),
    )


# ---------------------------------------------------------------------------
# Schema Init
# ---------------------------------------------------------------------------

async def init_approval_schema() -> None:
    """Create approval tables if not exist."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# API Models
# ---------------------------------------------------------------------------

class ApprovalRequest(BaseModel):
    """Request to create a new approval."""
    tenant_id: str
    lobster_id: str
    action_type: str
    summary: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    rubric_scores: dict[str, float] | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    detail: dict[str, Any] | None = None
    user_id: str | None = None
    trace_id: str | None = None
    timeout_minutes: int = Field(default=60, ge=1, le=1440)


class ApprovalDecision(BaseModel):
    """Decision on an approval request."""
    resolved_by: str
    decision: str = Field(description="approved or rejected")
    rejection_reason: str | None = None


class ApprovalResponse(BaseModel):
    """Approval entry response."""
    approval_id: str
    created_at: str
    resolved_at: str | None
    expires_at: str | None
    tenant_id: str
    lobster_id: str
    user_id: str | None
    resolved_by: str | None
    action_type: str
    resource_type: str | None
    resource_id: str | None
    summary: str
    detail: dict[str, Any] | None
    confidence: float
    rubric_scores: dict[str, float] | None
    status: str
    rejection_reason: str | None
    trace_id: str | None


class ApprovalQueryParams(BaseModel):
    """Query parameters for listing approvals."""
    tenant_id: str | None = None
    lobster_id: str | None = None
    status: str | None = None
    action_type: str | None = None
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def _entry_to_dict(entry: ApprovalEntry) -> dict[str, Any]:
    rubric = None
    if entry.rubric_scores_json:
        try:
            rubric = json.loads(entry.rubric_scores_json)
        except (json.JSONDecodeError, TypeError):
            rubric = None

    detail = None
    if entry.detail_json:
        try:
            detail = json.loads(entry.detail_json)
        except (json.JSONDecodeError, TypeError):
            detail = None

    return {
        "approval_id": entry.approval_id,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "resolved_at": entry.resolved_at.isoformat() if entry.resolved_at else None,
        "expires_at": entry.expires_at.isoformat() if entry.expires_at else None,
        "tenant_id": entry.tenant_id,
        "lobster_id": entry.lobster_id,
        "user_id": entry.user_id,
        "resolved_by": entry.resolved_by,
        "action_type": entry.action_type,
        "resource_type": entry.resource_type,
        "resource_id": entry.resource_id,
        "summary": entry.summary,
        "detail": detail,
        "confidence": float(entry.confidence or 0.5),
        "rubric_scores": rubric,
        "status": entry.status,
        "rejection_reason": entry.rejection_reason,
        "trace_id": entry.trace_id,
    }


# ---------------------------------------------------------------------------
# Auto-approval policy
# ---------------------------------------------------------------------------

# Actions that can be auto-approved if confidence > threshold
AUTO_APPROVE_THRESHOLD = float(os.getenv("APPROVAL_AUTO_THRESHOLD", "0.9"))

# Actions that always require human approval regardless of confidence
ALWAYS_REQUIRE_HUMAN: set[str] = {
    "payment",
    "delete_data",
    "edge_deploy_production",
    "subscription_change",
    "rollback",
}


def should_auto_approve(action_type: str, confidence: float) -> bool:
    """Determine if an action can be auto-approved based on confidence."""
    if action_type in ALWAYS_REQUIRE_HUMAN:
        return False
    return confidence >= AUTO_APPROVE_THRESHOLD


# ---------------------------------------------------------------------------
# Core Functions
# ---------------------------------------------------------------------------

async def create_approval(request: ApprovalRequest) -> dict[str, Any]:
    """
    Create a new approval request.
    If confidence is high enough and action allows, auto-approve.
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=request.timeout_minutes)

    # Check auto-approval
    auto = should_auto_approve(request.action_type, request.confidence)

    entry = ApprovalEntry(
        approval_id=str(uuid.uuid4()),
        created_at=now,
        resolved_at=now if auto else None,
        expires_at=expires,
        tenant_id=request.tenant_id,
        lobster_id=request.lobster_id,
        user_id=request.user_id,
        resolved_by="system:auto_approve" if auto else None,
        action_type=request.action_type,
        resource_type=request.resource_type,
        resource_id=request.resource_id,
        summary=request.summary,
        detail_json=json.dumps(request.detail, ensure_ascii=False) if request.detail else None,
        confidence=request.confidence,
        rubric_scores_json=json.dumps(request.rubric_scores) if request.rubric_scores else None,
        status="auto_approved" if auto else "pending",
        trace_id=request.trace_id,
        source="lobster",
    )

    async with _async_session() as session:
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return _entry_to_dict(entry)


async def resolve_approval(approval_id: str, decision: ApprovalDecision) -> dict[str, Any]:
    """Approve or reject a pending approval."""
    async with _async_session() as session:
        stmt = select(ApprovalEntry).where(ApprovalEntry.approval_id == approval_id)
        result = await session.execute(stmt)
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Approval not found: {approval_id}")
        if entry.status != "pending":
            raise ValueError(f"Approval is not pending (current: {entry.status})")

        if decision.decision not in ("approved", "rejected"):
            raise ValueError(f"Invalid decision: {decision.decision}")

        entry.status = decision.decision
        entry.resolved_by = decision.resolved_by
        entry.resolved_at = datetime.now(timezone.utc)
        if decision.rejection_reason:
            entry.rejection_reason = decision.rejection_reason

        await session.commit()
        await session.refresh(entry)
        return _entry_to_dict(entry)


async def get_approval(approval_id: str) -> dict[str, Any] | None:
    """Get a single approval by ID."""
    async with _async_session() as session:
        stmt = select(ApprovalEntry).where(ApprovalEntry.approval_id == approval_id)
        result = await session.execute(stmt)
        entry = result.scalar_one_or_none()
        if entry is None:
            return None
        return _entry_to_dict(entry)


async def query_approvals(params: ApprovalQueryParams) -> dict[str, Any]:
    """Query approvals with filters."""
    async with _async_session() as session:
        stmt = select(ApprovalEntry)
        count_stmt = select(func.count(ApprovalEntry.id))

        if params.tenant_id:
            stmt = stmt.where(ApprovalEntry.tenant_id == params.tenant_id)
            count_stmt = count_stmt.where(ApprovalEntry.tenant_id == params.tenant_id)
        if params.lobster_id:
            stmt = stmt.where(ApprovalEntry.lobster_id == params.lobster_id)
            count_stmt = count_stmt.where(ApprovalEntry.lobster_id == params.lobster_id)
        if params.status:
            stmt = stmt.where(ApprovalEntry.status == params.status)
            count_stmt = count_stmt.where(ApprovalEntry.status == params.status)
        if params.action_type:
            stmt = stmt.where(ApprovalEntry.action_type == params.action_type)
            count_stmt = count_stmt.where(ApprovalEntry.action_type == params.action_type)

        stmt = stmt.order_by(ApprovalEntry.created_at.desc())
        stmt = stmt.offset(params.offset).limit(params.limit)

        result = await session.execute(stmt)
        entries = result.scalars().all()

        count_result = await session.execute(count_stmt)
        total = count_result.scalar() or 0

        return {
            "items": [_entry_to_dict(e) for e in entries],
            "total": total,
            "limit": params.limit,
            "offset": params.offset,
        }


async def expire_stale_approvals() -> int:
    """Expire approvals that have passed their deadline. Returns count expired."""
    now = datetime.now(timezone.utc)
    async with _async_session() as session:
        stmt = select(ApprovalEntry).where(
            ApprovalEntry.status == "pending",
            ApprovalEntry.expires_at <= now,
        )
        result = await session.execute(stmt)
        entries = result.scalars().all()
        for entry in entries:
            entry.status = "expired"
            entry.resolved_at = now
            entry.resolved_by = "system:expired"
        await session.commit()
        return len(entries)


async def check_approval_status(approval_id: str) -> str:
    """
    Quick check if an approval is approved.
    Returns: "approved" | "auto_approved" | "pending" | "rejected" | "expired" | "not_found"
    """
    entry = await get_approval(approval_id)
    if entry is None:
        return "not_found"
    return str(entry["status"])


# ---------------------------------------------------------------------------
# Integration helper for LobsterRunner
# ---------------------------------------------------------------------------

async def require_approval(
    *,
    tenant_id: str,
    lobster_id: str,
    action_type: str,
    summary: str,
    confidence: float = 0.5,
    rubric_scores: dict[str, float] | None = None,
    detail: dict[str, Any] | None = None,
    trace_id: str | None = None,
    timeout_minutes: int = 60,
) -> dict[str, Any]:
    """
    Create an approval and return its result.

    If auto-approved (high confidence + allowed action), returns immediately
    with status="auto_approved".

    If pending, returns with status="pending" — caller must poll or wait.

    Usage in LobsterRunner:
    ```python
    result = await require_approval(
        tenant_id=state["tenant_id"],
        lobster_id="dispatcher",
        action_type="edge_deploy",
        summary="Deploy content pack to 3 edge nodes",
        confidence=0.85,
    )
    if result["status"] in ("approved", "auto_approved"):
        # proceed with action
        pass
    else:
        # block or queue for later
        pass
    ```
    """
    return await create_approval(ApprovalRequest(
        tenant_id=tenant_id,
        lobster_id=lobster_id,
        action_type=action_type,
        summary=summary,
        confidence=confidence,
        rubric_scores=rubric_scores,
        detail=detail,
        trace_id=trace_id,
        timeout_minutes=timeout_minutes,
    ))
```

---

## 文件 2：修改 `dragon-senate-saas-v2/app.py`

### 当前状态
`app.py` 是 FastAPI 主入口，包含 `/run`, `/async`, `/variance`, `/kernel` 等端点。

### 需要添加的端点

在现有路由之后添加审批相关 API：

```python
from approval_manager import (
    ApprovalDecision,
    ApprovalQueryParams,
    ApprovalRequest,
    create_approval,
    expire_stale_approvals,
    get_approval,
    init_approval_schema,
    query_approvals,
    resolve_approval,
)

# 在 startup 事件中添加
@app.on_event("startup")
async def _startup():
    # ... 现有 startup 逻辑 ...
    await init_approval_schema()

# ── Approval API ──

@app.post("/approvals")
async def api_create_approval(request: ApprovalRequest):
    """Create a new approval request."""
    return await create_approval(request)

@app.get("/approvals/{approval_id}")
async def api_get_approval(approval_id: str):
    """Get approval details."""
    result = await get_approval(approval_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return result

@app.post("/approvals/{approval_id}/resolve")
async def api_resolve_approval(approval_id: str, decision: ApprovalDecision):
    """Approve or reject a pending approval."""
    try:
        return await resolve_approval(approval_id, decision)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/approvals")
async def api_list_approvals(
    tenant_id: str | None = None,
    lobster_id: str | None = None,
    status: str | None = None,
    action_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """List approvals with filters."""
    return await query_approvals(ApprovalQueryParams(
        tenant_id=tenant_id,
        lobster_id=lobster_id,
        status=status,
        action_type=action_type,
        limit=limit,
        offset=offset,
    ))

@app.post("/approvals/expire")
async def api_expire_approvals():
    """Expire all stale approvals."""
    count = await expire_stale_approvals()
    return {"expired_count": count}
```

---

## 文件 3：修改 `dragon-senate-saas-v2/lobster_runner.py`

### 当前状态
`LobsterRunner` 有 Hook 系统，在 `execute` 方法中按顺序调用 hooks。

### 需要添加的逻辑

在 `LobsterRunner` 中添加一个可选的审批检查：

```python
# 在 LobsterRunner 类中添加属性
class LobsterRunner:
    # ... 现有代码 ...
    
    # 需要审批的 action_type 列表（可配置）
    APPROVAL_REQUIRED_ACTIONS: set[str] = {
        "publish",
        "edge_deploy",
        "payment",
        "delete_data",
        "batch_operation",
    }
    
    async def check_approval_if_needed(
        self,
        *,
        lobster_id: str,
        action_type: str,
        summary: str,
        confidence: float,
        tenant_id: str = "tenant_main",
        detail: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Check if this action requires approval.
        Returns approval result if needed, None if no approval required.
        """
        if action_type not in self.APPROVAL_REQUIRED_ACTIONS:
            return None
        
        try:
            from approval_manager import require_approval
            return await require_approval(
                tenant_id=tenant_id,
                lobster_id=lobster_id,
                action_type=action_type,
                summary=summary,
                confidence=confidence,
                detail=detail,
                trace_id=trace_id,
            )
        except Exception:
            # If approval system is unavailable, log and continue
            # (fail-open for now, can be changed to fail-close)
            return None
```

**注意**：不要修改现有的 `execute` 方法流程。审批检查作为可选能力添加，由各龙虾的节点函数主动调用。

---

## 测试要求

在 `dragon-senate-saas-v2/tests/test_approval_manager.py` 新建测试文件：

```python
"""Tests for approval_manager."""
import pytest
import asyncio
from approval_manager import (
    ApprovalDecision,
    ApprovalQueryParams,
    ApprovalRequest,
    create_approval,
    expire_stale_approvals,
    get_approval,
    init_approval_schema,
    query_approvals,
    resolve_approval,
    should_auto_approve,
    require_approval,
    ALWAYS_REQUIRE_HUMAN,
    AUTO_APPROVE_THRESHOLD,
)


@pytest.fixture(autouse=True)
async def setup_schema():
    await init_approval_schema()


class TestAutoApprovePolicy:
    def test_high_confidence_normal_action_auto_approves(self):
        assert should_auto_approve("publish", 0.95) is True

    def test_low_confidence_does_not_auto_approve(self):
        assert should_auto_approve("publish", 0.5) is False

    def test_payment_never_auto_approves(self):
        assert should_auto_approve("payment", 0.99) is False

    def test_delete_data_never_auto_approves(self):
        assert should_auto_approve("delete_data", 0.99) is False


class TestCreateApproval:
    @pytest.mark.asyncio
    async def test_create_pending_approval(self):
        result = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="dispatcher",
            action_type="edge_deploy",
            summary="Deploy to 3 nodes",
            confidence=0.5,
        ))
        assert result["status"] == "pending"
        assert result["lobster_id"] == "dispatcher"
        assert result["approval_id"] is not None

    @pytest.mark.asyncio
    async def test_create_auto_approved(self):
        result = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="inkwriter",
            action_type="publish",
            summary="Publish content",
            confidence=0.95,
        ))
        assert result["status"] == "auto_approved"
        assert result["resolved_by"] == "system:auto_approve"

    @pytest.mark.asyncio
    async def test_payment_always_pending(self):
        result = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="abacus",
            action_type="payment",
            summary="Process payment",
            confidence=0.99,
        ))
        assert result["status"] == "pending"


class TestResolveApproval:
    @pytest.mark.asyncio
    async def test_approve_pending(self):
        created = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="dispatcher",
            action_type="edge_deploy",
            summary="Deploy",
            confidence=0.5,
        ))
        resolved = await resolve_approval(
            created["approval_id"],
            ApprovalDecision(resolved_by="admin", decision="approved"),
        )
        assert resolved["status"] == "approved"
        assert resolved["resolved_by"] == "admin"

    @pytest.mark.asyncio
    async def test_reject_pending(self):
        created = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="dispatcher",
            action_type="edge_deploy",
            summary="Deploy",
            confidence=0.5,
        ))
        resolved = await resolve_approval(
            created["approval_id"],
            ApprovalDecision(
                resolved_by="admin",
                decision="rejected",
                rejection_reason="Too risky",
            ),
        )
        assert resolved["status"] == "rejected"
        assert resolved["rejection_reason"] == "Too risky"

    @pytest.mark.asyncio
    async def test_cannot_resolve_non_pending(self):
        created = await create_approval(ApprovalRequest(
            tenant_id="t1",
            lobster_id="inkwriter",
            action_type="publish",
            summary="Publish",
            confidence=0.95,
        ))
        # auto_approved, not pending
        with pytest.raises(ValueError, match="not pending"):
            await resolve_approval(
                created["approval_id"],
                ApprovalDecision(resolved_by="admin", decision="approved"),
            )


class TestQueryApprovals:
    @pytest.mark.asyncio
    async def test_query_by_status(self):
        await create_approval(ApprovalRequest(
            tenant_id="t1", lobster_id="radar",
            action_type="scan", summary="Scan", confidence=0.5,
        ))
        result = await query_approvals(ApprovalQueryParams(
            tenant_id="t1", status="pending",
        ))
        assert result["total"] >= 1

    @pytest.mark.asyncio
    async def test_query_by_lobster(self):
        await create_approval(ApprovalRequest(
            tenant_id="t1", lobster_id="catcher",
            action_type="capture", summary="Capture", confidence=0.5,
        ))
        result = await query_approvals(ApprovalQueryParams(
            lobster_id="catcher",
        ))
        assert result["total"] >= 1


class TestRequireApproval:
    @pytest.mark.asyncio
    async def test_require_approval_returns_result(self):
        result = await require_approval(
            tenant_id="t1",
            lobster_id="dispatcher",
            action_type="edge_deploy",
            summary="Deploy content",
            confidence=0.7,
        )
        assert result["status"] in ("pending", "auto_approved")
        assert result["approval_id"] is not None
```

---

## 与现有系统的关系

### 与 `audit_logger.py` 的关系
- `audit_logger.py` 记录**已发生的事实**（谁做了什么）
- `approval_manager.py` 管理**将要发生的决策**（是否允许做）
- 两者互补，不重复。审批决策后可以调用 `audit_approval()` 记录审计日志。

### 与 `approval_gate.py` 的关系
- 项目中已有 `dragon-senate-saas-v2/approval_gate.py`，它是 LangGraph 图中的审批节点
- `approval_manager.py` 是底层审批数据管理，`approval_gate.py` 是图节点入口
- 两者应该集成：`approval_gate.py` 应该调用 `approval_manager.create_approval()`

---

## 验证标准

1. ✅ `approval_manager.py` 包含完整 CRUD + auto-approve + expire 逻辑
2. ✅ `app.py` 新增 5 个审批 API 端点
3. ✅ `LobsterRunner` 有 `check_approval_if_needed` 方法
4. ✅ 12 项单测全部通过
5. ✅ 与 `audit_logger.py` 风格一致（SQLAlchemy async + Pydantic models）
6. ✅ auto-approve 策略可通过环境变量配置

## 不要做的事

- ❌ 不要修改 `audit_logger.py`
- ❌ 不要修改 `dragon_senate.py`
- ❌ 不要修改 `approval_gate.py`（后续任务集成）
- ❌ 不要引入新的外部依赖（pydantic/sqlalchemy 已在项目中）
- ❌ 不要做前端（审批 UI 是独立任务）
