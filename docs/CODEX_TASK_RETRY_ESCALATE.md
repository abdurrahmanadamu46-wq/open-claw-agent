# CODEX TASK: Retry & Escalate 自动重试 + 人工升级机制

> **任务来源**：G04 — AntFarm 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/ANTFARM_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🔴 P0 极高（龙虾失败 = 静默丢失，用户完全不知道）  
> **预估工作量**：1 天  
> **负责人**：Codex  
> **依赖**：CODEX_TASK_EXPECTS_VALIDATION.md（G03，先落地 expects 机制）

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查现有 retry 逻辑
grep -n "retry\|max_retry\|escalate\|escalation\|human.*review\|pending.*approval" \
  dragon-senate-saas-v2/lobster_runner.py 2>/dev/null | head -20

# 2. 检查现有 notification_center.py（用于发送升级通知）
grep -n "send\|notify\|alert\|escalate\|webhook" \
  dragon-senate-saas-v2/notification_center.py 2>/dev/null | head -20

# 3. 检查 approval_gate.py（是否可用于 escalation 流程）
grep -n "pending\|approve\|reject\|human\|review" \
  dragon-senate-saas-v2/approval_gate.py 2>/dev/null | head -20

# 4. 检查 task_state_machine.py 是否有失败状态处理
grep -n "failed\|error\|escalate\|retry\|state" \
  dragon-senate-saas-v2/task_state_machine.py 2>/dev/null | head -20
```

**冲突解决原则**：
- 若已有 retry：在其基础上增加 escalation 通知，不重建
- escalation 通知复用现有 `notification_center.py`，不新建通知渠道
- 若 `approval_gate.py` 已有 pending 机制：直接复用

---

## 一、任务目标

实现 AntFarm Retry & Escalate 完整链路，消灭静默失败：
1. **Retry**：任务失败时，按指数退避自动重试 N 次（与 G03 expects 验收失败重试协同）
2. **Escalate**：重试耗尽后，向人工发送升级通知（微信/飞书/钉钉/Telegram）
3. **Human Loop**：升级后任务进入 `pending_human_review` 状态，等待人工决策（继续/跳过/修改后重试）
4. **零静默失败**：所有失败路径必须有明确的通知和状态记录

---

## 二、实施方案

### 2.1 新建 escalation_manager.py

**目标文件**：`dragon-senate-saas-v2/escalation_manager.py`（新建）

```python
"""
EscalationManager — 任务失败升级管理器
借鉴 AntFarm Retry & Escalate 机制

工作流：
  龙虾执行失败 → max_retries 耗尽 → escalate()
    → 生成升级事件 → 发送通知（微信/飞书/钉钉/Telegram）
    → 任务状态 = "pending_human_review"
    → 等待人工决策（API: POST /api/v1/escalations/{id}/resolve）
"""
from __future__ import annotations

import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("escalation_manager")

_DB_PATH = "./data/escalations.sqlite"


def _get_db() -> sqlite3.Connection:
    db_path = Path(_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def ensure_escalation_schema() -> None:
    conn = _get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS escalations (
                id            TEXT PRIMARY KEY,
                tenant_id     TEXT NOT NULL DEFAULT 'tenant_main',
                task_id       TEXT,
                lobster_id    TEXT NOT NULL,
                error_summary TEXT NOT NULL,
                retry_count   INTEGER DEFAULT 0,
                status        TEXT NOT NULL DEFAULT 'pending',
                -- status: pending | resolved_continue | resolved_skip | resolved_retry
                resolution_note TEXT,
                resolved_by   TEXT,
                created_at    TEXT NOT NULL,
                resolved_at   TEXT,
                notified_channels TEXT DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_esc_status ON escalations(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_esc_tenant ON escalations(tenant_id, created_at);
        """)
        conn.commit()
    finally:
        conn.close()


@dataclass
class EscalationEvent:
    escalation_id: str
    tenant_id: str
    task_id: str | None
    lobster_id: str
    error_summary: str
    retry_count: int
    status: str = "pending"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "escalation_id": self.escalation_id,
            "tenant_id": self.tenant_id,
            "task_id": self.task_id,
            "lobster_id": self.lobster_id,
            "error_summary": self.error_summary,
            "retry_count": self.retry_count,
            "status": self.status,
            "created_at": self.created_at,
        }


async def escalate(
    *,
    tenant_id: str = "tenant_main",
    task_id: str | None = None,
    lobster_id: str,
    error_summary: str,
    retry_count: int = 0,
    context: dict[str, Any] | None = None,
) -> EscalationEvent:
    """
    发起升级：
    1. 持久化升级事件到 SQLite
    2. 发送通知到已配置的渠道
    3. 返回 EscalationEvent（供调用方更新任务状态）
    """
    ensure_escalation_schema()
    escalation_id = f"esc_{uuid.uuid4().hex[:12]}"
    event = EscalationEvent(
        escalation_id=escalation_id,
        tenant_id=tenant_id,
        task_id=task_id,
        lobster_id=lobster_id,
        error_summary=error_summary,
        retry_count=retry_count,
    )
    # 持久化
    conn = _get_db()
    try:
        conn.execute(
            """INSERT INTO escalations
               (id, tenant_id, task_id, lobster_id, error_summary, retry_count, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (escalation_id, tenant_id, task_id, lobster_id, error_summary, retry_count, event.created_at),
        )
        conn.commit()
    finally:
        conn.close()

    # 发送通知
    notified = await _send_escalation_notifications(event, context or {})
    logger.warning(
        "[Escalation] %s: lobster=%s retries=%d notified=%s",
        escalation_id, lobster_id, retry_count, notified,
    )
    return event


async def _send_escalation_notifications(
    event: EscalationEvent,
    context: dict[str, Any],
) -> list[str]:
    """尝试向所有已配置渠道发送升级通知"""
    notified: list[str] = []
    message = _build_escalation_message(event, context)

    # 复用现有 notification_center.py
    try:
        from notification_center import send_notification
        await send_notification(
            tenant_id=event.tenant_id,
            message=message,
            level="warning",
            category="escalation",
        )
        notified.append("notification_center")
    except Exception as e:
        logger.warning("[Escalation] notification_center failed: %s", e)

    # 直接尝试 Telegram（如已配置）
    try:
        from telegram_bot import send_alert
        await send_alert(message, level="warning")
        notified.append("telegram")
    except Exception:
        pass

    # 飞书
    try:
        from feishu_channel import send_feishu_message
        await send_feishu_message(message)
        notified.append("feishu")
    except Exception:
        pass

    return notified


def _build_escalation_message(event: EscalationEvent, context: dict) -> str:
    return (
        f"⚠️ **龙虾任务升级通知**\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🦞 龙虾：{event.lobster_id}\n"
        f"📋 任务ID：{event.task_id or 'N/A'}\n"
        f"❌ 失败原因：{event.error_summary[:200]}\n"
        f"🔄 已重试：{event.retry_count} 次\n"
        f"⏰ 时间：{event.created_at}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔗 处理链接：/escalations/{event.escalation_id}\n"
        f"请选择：[继续] [跳过] [修改后重试]"
    )


def resolve_escalation(
    escalation_id: str,
    *,
    resolution: str,  # "continue" | "skip" | "retry"
    note: str = "",
    resolved_by: str = "human",
) -> dict[str, Any]:
    """人工解决升级事件"""
    conn = _get_db()
    try:
        conn.execute(
            """UPDATE escalations
               SET status = ?, resolution_note = ?, resolved_by = ?,
                   resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE id = ?""",
            (f"resolved_{resolution}", note, resolved_by, escalation_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM escalations WHERE id = ?", (escalation_id,)).fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()


def list_escalations(
    tenant_id: str = "tenant_main",
    status: str | None = "pending",
    limit: int = 50,
) -> list[dict[str, Any]]:
    """查询升级事件列表（供前端展示）"""
    conn = _get_db()
    try:
        query = "SELECT * FROM escalations WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

---

### 2.2 在 LobsterRunner 中集成 Escalation

**目标文件**：`dragon-senate-saas-v2/lobster_runner.py`  
**修改位置**：`_run_with_expects()` 的失败分支（承接 G03 的 expects 失败）

```python
# 在 _run_with_expects() 失败返回前，调用 escalation

if retry_count >= spec.max_retries:
    # 重试耗尽
    result.expects_passed = False
    result.stop_reason = "expects_failed"
    result.error = f"Validation failed after {retry_count+1} attempts: {reason}"

    # 🆕 触发 escalation（异步，不阻塞返回）
    if spec.meta and spec.meta.get("escalate_on_failure", True):
        try:
            from escalation_manager import escalate
            import asyncio
            asyncio.create_task(escalate(
                tenant_id=str(spec.meta.get("tenant_id", "tenant_main")),
                task_id=str(spec.meta.get("task_id", "")),
                lobster_id=spec.role_id,
                error_summary=result.error,
                retry_count=retry_count,
                context=dict(spec.meta or {}),
            ))
        except Exception as esc_err:
            logger.warning("[Escalation] Failed to escalate: %s", esc_err)

    return result
```

---

### 2.3 新增 API 端点

**目标文件**：`dragon-senate-saas-v2/app.py`  
**新增端点**：

```python
# GET /api/v1/escalations — 查询升级事件列表
# POST /api/v1/escalations/{id}/resolve — 人工处理升级

@app.get("/api/v1/escalations")
async def list_escalations_api(
    tenant_id: str = "tenant_main",
    status: str = "pending",
    limit: int = 50,
):
    from escalation_manager import list_escalations
    return list_escalations(tenant_id=tenant_id, status=status, limit=limit)


@app.post("/api/v1/escalations/{escalation_id}/resolve")
async def resolve_escalation_api(
    escalation_id: str,
    body: dict,  # {"resolution": "continue|skip|retry", "note": "..."}
):
    from escalation_manager import resolve_escalation
    return resolve_escalation(
        escalation_id,
        resolution=body.get("resolution", "skip"),
        note=body.get("note", ""),
        resolved_by=body.get("resolved_by", "human"),
    )
```

---

## 三、前端工程师对接说明

### 新增"升级待处理"徽章

```typescript
// 在运维首页 /dashboard 顶部显示待处理升级数量
interface EscalationBadge {
  pending_count: number;    // 待处理数量（红色徽章）
  link: "/escalations";
}

// GET /api/v1/escalations?status=pending 获取数量
```

### 升级事件列表页 /escalations

```typescript
interface EscalationItem {
  escalation_id: string;
  lobster_id: string;        // 哪只龙虾失败了
  task_id: string | null;
  error_summary: string;     // 失败原因
  retry_count: number;       // 已重试次数
  status: "pending" | "resolved_continue" | "resolved_skip" | "resolved_retry";
  created_at: string;
}

// 操作按钮：
// [继续] → POST /api/v1/escalations/{id}/resolve {"resolution": "continue"}
// [跳过] → POST /api/v1/escalations/{id}/resolve {"resolution": "skip"}
// [重试] → POST /api/v1/escalations/{id}/resolve {"resolution": "retry"}
```

### 龙虾任务卡片显示升级标记

```typescript
// 当 stop_reason = "expects_failed" 且 escalation 已发起时：
// 显示 🆙 "已升级，等待人工处理" 标签（链接到 /escalations/{id}）
```

---

## 四、验收标准

- [ ] `escalation_manager.py` 正常导入
- [ ] `await escalate(lobster_id="radar", error_summary="test fail", retry_count=2)` 持久化到 SQLite
- [ ] `list_escalations(status="pending")` 返回未处理事件列表
- [ ] `resolve_escalation(id, resolution="skip")` 更新 status 并记录 resolved_at
- [ ] 龙虾 max_retries 耗尽后自动触发 escalation（不阻塞返回）
- [ ] GET /api/v1/escalations 返回正确列表
- [ ] POST /api/v1/escalations/{id}/resolve 正常处理
- [ ] 至少1个通知渠道成功发送（notification_center / telegram / feishu）
- [ ] 现有龙虾任务不受影响（`escalate_on_failure` 默认开启但异步不阻塞）

---

## 五、实施顺序

```
上午（3小时）：
  ① 冲突检查（4条 grep）
  ② 新建 escalation_manager.py（见 2.1，含 SQLite schema）
  ③ 在 lobster_runner.py 的 _run_with_expects() 失败分支加入 escalation 调用（见 2.2）

下午（2小时）：
  ④ 在 app.py 新增 2 个 escalation API 端点（见 2.3）
  ⑤ 验证：触发一次 expects 失败，确认升级事件创建 + 通知发出

收尾（1小时）：
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_ANTFARM_RETRY_ESCALATE 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G04*
