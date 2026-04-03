# CODEX TASK: 还原完成事件单次上报 + followup 龙虾报告

> **任务来源**：G13 — openclaw-backup 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/OPENCLAW_BACKUP_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🟠 P1 重要（备份还原后无法得知是否成功，followup 龙虾不感知还原事件）  
> **预估工作量**：1 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查现有备份/还原脚本
ls scripts/backup*.sh scripts/restore*.sh 2>/dev/null || echo "无现有脚本"

# 2. 检查是否已有还原事件上报
grep -rn "restore.*complete\|restore.*event\|post.*restore\|after.*restore" \
  dragon-senate-saas-v2/ scripts/ 2>/dev/null | head -15

# 3. 检查 followup 龙虾是否感知备份/还原事件
grep -n "backup\|restore\|system.*event\|infra" \
  dragon-senate-saas-v2/lobsters/followup.py 2>/dev/null | head -10

# 4. 确认事件总线/audit_logger 已可用
grep -n "def record\|async def.*record\|class.*Event" \
  dragon-senate-saas-v2/audit_logger.py 2>/dev/null | head -10
```

**冲突解决原则**：
- 若还原脚本已存在：在其末尾追加事件上报调用，不替换脚本逻辑
- 事件上报是**幂等的**（同一 restore_id 只上报一次，防止重复通知）
- followup 龙虾的报告是可选的增强，不影响备份还原主流程

---

## 一、任务目标

实现 openclaw-backup 风格的还原完成事件链路：
1. **还原完成事件**：备份还原脚本完成后，向中控上报单次完成事件（幂等）
2. **健康验证**：还原后自动触发 Doctor 健康检查（G09），验证系统状态
3. **followup 龙虾报告**：还原完成后，followup 龙虾生成还原摘要报告并推送给运营
4. **审计记录**：还原事件写入 audit_logger（操作人/时间/还原包/结果）

---

## 二、实施方案

### 2.1 新建还原事件上报模块

**目标文件**：`dragon-senate-saas-v2/restore_event.py`（新建）

```python
"""
还原完成事件上报模块
借鉴 openclaw-backup 还原事件机制

设计：
- 幂等上报：同一 restore_id 只记录一次，防止脚本重试导致重复通知
- 异步上报：不阻塞还原脚本的退出
- followup 触发：上报成功后，可选触发 followup 龙虾生成摘要
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("restore_event")

_DB_PATH = "./data/restore_events.sqlite"


def _get_db() -> sqlite3.Connection:
    db_path = Path(_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def ensure_restore_schema() -> None:
    conn = _get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS restore_events (
                restore_id      TEXT PRIMARY KEY,
                tenant_id       TEXT NOT NULL DEFAULT 'tenant_main',
                backup_file     TEXT NOT NULL,
                restore_type    TEXT NOT NULL DEFAULT 'full',
                operator        TEXT DEFAULT 'system',
                status          TEXT NOT NULL DEFAULT 'completed',
                -- status: completed | failed | partial
                items_restored  INTEGER DEFAULT 0,
                duration_seconds REAL DEFAULT 0,
                health_check_passed BOOLEAN DEFAULT 0,
                report_generated BOOLEAN DEFAULT 0,
                detail          TEXT DEFAULT '{}',
                created_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_restore_tenant ON restore_events(tenant_id, created_at);
        """)
        conn.commit()
    finally:
        conn.close()


def _compute_restore_id(backup_file: str, started_at: float) -> str:
    """生成幂等的 restore_id（基于备份文件名+开始时间的哈希）"""
    raw = f"{backup_file}:{int(started_at)}"
    return "rst_" + hashlib.sha256(raw.encode()).hexdigest()[:16]


async def report_restore_complete(
    *,
    tenant_id: str = "tenant_main",
    backup_file: str,
    restore_type: str = "full",
    operator: str = "system",
    status: str = "completed",
    items_restored: int = 0,
    duration_seconds: float = 0.0,
    started_at: float | None = None,
    detail: dict[str, Any] | None = None,
    trigger_followup_report: bool = True,
) -> dict[str, Any]:
    """
    上报还原完成事件（幂等）

    Args:
        backup_file: 还原的备份文件名
        restore_type: 还原类型（full/incremental/selective）
        operator: 操作人（system/human_operator_name）
        status: 结果状态（completed/failed/partial）
        items_restored: 还原的数据项数量
        duration_seconds: 还原耗时（秒）
        trigger_followup_report: 是否触发 followup 龙虾生成报告

    Returns:
        dict 包含 restore_id 和 is_new（是否首次上报）
    """
    ensure_restore_schema()
    _started_at = started_at or (time.time() - duration_seconds)
    restore_id = _compute_restore_id(backup_file, _started_at)

    conn = _get_db()
    try:
        existing = conn.execute(
            "SELECT restore_id FROM restore_events WHERE restore_id = ?",
            (restore_id,),
        ).fetchone()

        if existing:
            logger.info("[RestoreEvent] Already reported: %s (idempotent skip)", restore_id)
            return {"restore_id": restore_id, "is_new": False}

        created_at = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO restore_events
               (restore_id, tenant_id, backup_file, restore_type, operator, status,
                items_restored, duration_seconds, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                restore_id, tenant_id, backup_file, restore_type, operator, status,
                items_restored, duration_seconds,
                json.dumps(detail or {}, ensure_ascii=False),
                created_at,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    logger.info(
        "[RestoreEvent] Reported: %s | file=%s status=%s items=%d",
        restore_id, backup_file, status, items_restored,
    )

    # 写入 audit_logger
    await _log_to_audit(
        restore_id=restore_id,
        tenant_id=tenant_id,
        backup_file=backup_file,
        operator=operator,
        status=status,
        detail=detail or {},
    )

    # 发送还原完成通知
    await _send_restore_notification(
        tenant_id=tenant_id,
        restore_id=restore_id,
        backup_file=backup_file,
        status=status,
        items_restored=items_restored,
        duration_seconds=duration_seconds,
    )

    # 可选：触发 followup 龙虾生成摘要报告
    if trigger_followup_report and status == "completed":
        await _trigger_followup_report(
            tenant_id=tenant_id,
            restore_id=restore_id,
            backup_file=backup_file,
            items_restored=items_restored,
            duration_seconds=duration_seconds,
        )

    return {"restore_id": restore_id, "is_new": True}


async def _log_to_audit(
    *,
    restore_id: str,
    tenant_id: str,
    backup_file: str,
    operator: str,
    status: str,
    detail: dict,
) -> None:
    try:
        from audit_logger import record_audit_log
        await record_audit_log(
            tenant_id=tenant_id,
            user_id=operator,
            action="restore_complete",
            category="infrastructure",
            resource_type="backup",
            resource_id=restore_id,
            summary=f"还原完成：{backup_file}（{status}）",
            detail={**detail, "restore_id": restore_id, "backup_file": backup_file},
            result=status,
            source="restore_event",
        )
    except Exception as e:
        logger.warning("[RestoreEvent] audit_logger failed: %s", e)


async def _send_restore_notification(
    *,
    tenant_id: str,
    restore_id: str,
    backup_file: str,
    status: str,
    items_restored: int,
    duration_seconds: float,
) -> None:
    icon = "✅" if status == "completed" else "❌"
    message = (
        f"{icon} **备份还原通知**\n"
        f"━━━━━━━━━━━━━━━\n"
        f"📦 还原文件：{backup_file}\n"
        f"📊 还原状态：{status}\n"
        f"🗃️ 还原数据：{items_restored} 项\n"
        f"⏱️ 耗时：{duration_seconds:.1f}秒\n"
        f"🔑 还原ID：{restore_id}"
    )
    try:
        from notification_center import send_notification
        await send_notification(
            tenant_id=tenant_id,
            message=message,
            level="info" if status == "completed" else "critical",
            category="restore",
        )
    except Exception as e:
        logger.warning("[RestoreEvent] notification failed: %s", e)


async def _trigger_followup_report(
    *,
    tenant_id: str,
    restore_id: str,
    backup_file: str,
    items_restored: int,
    duration_seconds: float,
) -> None:
    """触发 followup 龙虾生成还原摘要报告"""
    try:
        from lobster_runner import LobsterRunner, LobsterRunSpec
        from llm_router import get_llm_router
        runner = LobsterRunner(get_llm_router())
        result = await runner.run(LobsterRunSpec(
            role_id="followup",
            system_prompt="你是ClawCommerce跟进汇报龙虾，负责生成系统运维事件的摘要报告。",
            user_prompt=(
                f"请生成一份备份还原完成摘要报告：\n"
                f"- 还原文件：{backup_file}\n"
                f"- 还原数据量：{items_restored} 项\n"
                f"- 耗时：{duration_seconds:.1f}秒\n"
                f"- 还原ID：{restore_id}\n"
                f"\n请以 FollowUpActionPlan: 开头，包含：确认检查项 + 建议运营人员采取的后续操作"
            ),
            meta={"tenant_id": tenant_id, "task_type": "restore_report", "escalate_on_failure": False},
            expects="FollowUpActionPlan:",
            max_retries=1,
        ))
        if result.final_content:
            # 将报告存入 followup 龙虾 memory
            logger.info("[RestoreEvent] followup report generated: %s chars", len(result.final_content))
        # 标记报告已生成
        conn = _get_db()
        try:
            conn.execute(
                "UPDATE restore_events SET report_generated = 1 WHERE restore_id = ?",
                (restore_id,),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        logger.warning("[RestoreEvent] followup report failed: %s", e)


def list_restore_events(
    tenant_id: str = "tenant_main",
    limit: int = 20,
) -> list[dict[str, Any]]:
    """查询还原事件列表（供前端展示）"""
    ensure_restore_schema()
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM restore_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
            (tenant_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

### 2.2 集成到还原脚本

**目标文件**：`scripts/restore.sh`（新建或修改）

```bash
#!/bin/bash
# 备份还原脚本 — 还原完成后上报事件
# 用法：./scripts/restore.sh <backup_file> [operator]

BACKUP_FILE="${1:-}"
OPERATOR="${2:-system}"
START_TIME=$(date +%s)

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file> [operator]"
  exit 1
fi

echo "=== 开始还原: $BACKUP_FILE ==="

# ... 实际还原逻辑 ...
ITEMS_RESTORED=0
STATUS="completed"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "=== 还原完成，上报事件 ==="
python - <<EOF
import asyncio
import sys
sys.path.insert(0, './dragon-senate-saas-v2')
from restore_event import report_restore_complete

async def main():
    result = await report_restore_complete(
        backup_file='${BACKUP_FILE}',
        operator='${OPERATOR}',
        status='${STATUS}',
        items_restored=${ITEMS_RESTORED},
        duration_seconds=${DURATION},
        trigger_followup_report=True,
    )
    print(f"RestoreEvent reported: {result}")

asyncio.run(main())
EOF
```

### 2.3 新增 API 端点

```python
# GET /api/v1/restore-events — 查询还原事件历史

@app.get("/api/v1/restore-events")
async def list_restore_events_api(tenant_id: str = "tenant_main", limit: int = 20):
    from restore_event import list_restore_events
    return {"events": list_restore_events(tenant_id=tenant_id, limit=limit)}
```

---

## 三、前端工程师对接说明

### 运维页面新增"还原历史"卡片

```typescript
interface RestoreEventItem {
  restore_id: string;
  backup_file: string;
  restore_type: string;        // "full" / "incremental"
  operator: string;            // 操作人
  status: "completed" | "failed" | "partial";
  items_restored: number;
  duration_seconds: number;
  report_generated: boolean;   // followup 龙虾是否已生成报告
  created_at: string;
}

// 在 /operations/backup 页面的"还原历史"Tab 中展示
// - status=completed → 绿色 ✅
// - status=failed → 红色 ❌
// - report_generated=false → 橙色"报告生成中..."（轮询刷新）
```

---

## 四、验收标准

- [ ] `restore_event.py` 正常导入，`ensure_restore_schema()` 创建 SQLite 表
- [ ] 同一 backup_file + started_at 调用两次 `report_restore_complete()`，只产生1条记录（幂等）
- [ ] 还原完成后 audit_logger 记录了 `action="restore_complete"`
- [ ] 还原完成后 notification_center 收到通知
- [ ] `trigger_followup_report=True` 时，followup 龙虾生成摘要报告
- [ ] GET /api/v1/restore-events 返回事件列表
- [ ] scripts/restore.sh 执行后自动调用 Python 上报模块

---

## 五、实施顺序

```
上午（3小时）：
  ① 冲突检查（4条命令）
  ② 新建 restore_event.py（见 2.1，含 SQLite schema + 幂等检查）
  ③ 在 scripts/restore.sh 末尾添加 Python 事件上报调用（见 2.2）

下午（2小时）：
  ④ 在 app.py 新增 GET /api/v1/restore-events 端点（见 2.3）
  ⑤ 验证：执行一次模拟还原，确认事件上报 + followup 报告生成
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_RESTORE_REPORT 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G13*
