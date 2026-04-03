# CODEX TASK: 幂等执行（Idempotency Keys）— 防止工作流重复触发

**优先级：P1**  
**来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#2（Trigger.dev Idempotency Keys）**

---

## 背景

Webhook 触发器和手动执行均面临重复触发风险：外部系统超时重试、用户重复点击、定时任务调度器重启均可能导致同一工作流被执行多次 → 重复计费、重复发布、LLM 重复调用。借鉴 Trigger.dev Idempotency Keys，相同 key 的执行请求只处理一次。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/workflow_idempotency.py

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class WorkflowIdempotencyRecord:
    """幂等执行记录"""
    idempotency_key: str      # 唯一幂等键
    tenant_id: str
    workflow_id: str
    execution_id: str         # 关联的执行 ID
    status: str               # "pending" | "running" | "completed" | "failed"
    result_summary: Optional[dict]  # 执行结果摘要（返回给重复请求）
    created_at: datetime
    expires_at: datetime      # 幂等记录过期时间（默认24小时）
    
    # 索引：(tenant_id, workflow_id, idempotency_key) 唯一
```

---

## 二、幂等中间件

```python
# dragon-senate-saas-v2/idempotency_middleware.py

import hashlib
from datetime import datetime, timedelta
from typing import Optional

class IdempotencyService:
    """幂等执行服务"""

    IDEMPOTENCY_TTL_HOURS = 24  # 幂等记录保留 24 小时

    def __init__(self, db):
        self.db = db

    def check_or_reserve(
        self,
        tenant_id: str,
        workflow_id: str,
        idempotency_key: str,
        execution_id: str,
    ) -> tuple[bool, Optional[dict]]:
        """
        检查幂等键，返回 (is_new, existing_result)
        is_new=True：首次执行，已预占 key
        is_new=False：重复请求，返回已有结果
        """
        existing = self.db.query(WorkflowIdempotencyRecord).filter(
            WorkflowIdempotencyRecord.tenant_id == tenant_id,
            WorkflowIdempotencyRecord.workflow_id == workflow_id,
            WorkflowIdempotencyRecord.idempotency_key == idempotency_key,
            WorkflowIdempotencyRecord.expires_at > datetime.utcnow(),
        ).first()

        if existing:
            # 重复请求 → 返回已有结果
            return False, {
                "execution_id": existing.execution_id,
                "status": existing.status,
                "result": existing.result_summary,
                "is_duplicate": True,
            }

        # 首次请求 → 创建幂等记录
        record = WorkflowIdempotencyRecord(
            idempotency_key=idempotency_key,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            status="pending",
            result_summary=None,
            created_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=self.IDEMPOTENCY_TTL_HOURS),
        )
        self.db.add(record)
        self.db.commit()
        return True, None

    def update_result(
        self,
        tenant_id: str,
        idempotency_key: str,
        status: str,
        result_summary: Optional[dict] = None,
    ):
        """执行完成后更新幂等记录状态"""
        record = self.db.query(WorkflowIdempotencyRecord).filter(
            WorkflowIdempotencyRecord.tenant_id == tenant_id,
            WorkflowIdempotencyRecord.idempotency_key == idempotency_key,
        ).first()
        if record:
            record.status = status
            record.result_summary = result_summary
            self.db.commit()

    @staticmethod
    def generate_key(source: str, business_id: str, extra: str = "") -> str:
        """生成标准幂等键"""
        raw = f"{source}:{business_id}:{extra}"
        return hashlib.sha256(raw.encode()).hexdigest()[:32]
```

---

## 三、集成到触发入口

```python
# dragon-senate-saas-v2/api_workflow_trigger.py

idempotency_svc = IdempotencyService(db)

@router.post("/workflows/{workflow_id}/trigger")
async def trigger_workflow(
    workflow_id: str,
    body: TriggerWorkflowBody,
    # 支持两种方式提供幂等键：
    x_idempotency_key: Optional[str] = Header(None),  # HTTP Header
    tenant_context=Depends(get_tenant_context),
):
    """触发工作流（支持幂等）"""
    idempotency_key = x_idempotency_key or body.idempotency_key
    execution_id = str(uuid.uuid4())

    if idempotency_key:
        is_new, existing = idempotency_svc.check_or_reserve(
            tenant_id=tenant_context.tenant_id,
            workflow_id=workflow_id,
            idempotency_key=idempotency_key,
            execution_id=execution_id,
        )
        if not is_new:
            # 重复请求：返回已有执行的状态（不重复执行）
            return JSONResponse(
                content={**existing, "message": "重复请求，返回已有执行结果"},
                status_code=200,
                headers={"X-Idempotency-Status": "duplicate"},
            )

    # 正常触发执行
    asyncio.create_task(
        runner.run_workflow(
            workflow=get_workflow(workflow_id),
            input_data=body.input or {},
            tenant_id=tenant_context.tenant_id,
            execution_id=execution_id,
            idempotency_key=idempotency_key,
        )
    )

    return {
        "execution_id": execution_id,
        "status": "triggered",
        "idempotency_key": idempotency_key,
    }


# Webhook 接收端自动生成幂等键
@webhook_router.post("/{webhook_id}")
async def receive_webhook(webhook_id: str, request: Request):
    # 从请求头自动提取幂等键（外部系统可能会提供）
    idempotency_key = (
        request.headers.get("X-Idempotency-Key") or
        request.headers.get("X-Request-ID") or
        # 兜底：用 webhook_id + 时间窗口（5分钟内去重）
        IdempotencyService.generate_key(
            source=f"webhook:{webhook_id}",
            business_id=str(int(time.time() // 300)),  # 5分钟窗口
        )
    )
    # 以幂等键触发
    return await trigger_workflow_internal(
        webhook_id=webhook_id,
        input_data=...,
        idempotency_key=idempotency_key,
    )
```

---

## 四、LobsterRunner 执行完成后更新幂等记录

```python
# dragon-senate-saas-v2/lobster_runner.py

class LobsterRunner:
    async def run_workflow(self, workflow, input_data, tenant_id,
                           execution_id=None, idempotency_key=None, ...):
        try:
            results = await self._do_run(workflow, input_data, tenant_id, execution_id)
            
            # 更新幂等记录为 completed
            if idempotency_key:
                idempotency_svc.update_result(
                    tenant_id=tenant_id,
                    idempotency_key=idempotency_key,
                    status="completed",
                    result_summary={
                        "output_keys": list(results.keys()),
                        "completed_at": datetime.utcnow().isoformat(),
                    },
                )
            return results
            
        except Exception as e:
            if idempotency_key:
                idempotency_svc.update_result(
                    tenant_id=tenant_id,
                    idempotency_key=idempotency_key,
                    status="failed",
                    result_summary={"error": str(e)},
                )
            raise
```

---

## 五、前端触发时自动携带幂等键

```typescript
// web/src/lib/api.ts — 手动触发时自动生成幂等键

export async function triggerWorkflow(workflowId: string, input: Record<string, string>) {
  // 生成客户端幂等键（用户ID + 工作流ID + 当前分钟，同一分钟内重复点击不重复执行）
  const idempotencyKey = `manual:${workflowId}:${Math.floor(Date.now() / 60000)}`;
  
  return api.post(`/v1/workflows/${workflowId}/trigger`, { input }, {
    headers: { 'X-Idempotency-Key': idempotencyKey },
  });
}
```

---

## 验收标准

- [ ] `WorkflowIdempotencyRecord` 数据模型（含 expires_at TTL）
- [ ] `IdempotencyService.check_or_reserve()`：首次返回 True，重复返回 False + 已有结果
- [ ] `IdempotencyService.update_result()`：执行完成/失败后更新记录
- [ ] `IdempotencyService.generate_key()`：标准 SHA-256 幂等键生成
- [ ] 数据库唯一索引：`(tenant_id, workflow_id, idempotency_key)`
- [ ] `POST /workflows/{id}/trigger` 支持 `X-Idempotency-Key` Header + body 字段
- [ ] 重复请求返回 200 + `{"is_duplicate": true}` + 原执行 ID
- [ ] Webhook 接收端自动提取或生成幂等键（5分钟时间窗口）
- [ ] `LobsterRunner` 执行完成后更新幂等记录状态
- [ ] 前端手动触发自动携带幂等键（分钟级时间窗口防重复点击）
- [ ] 定时清理过期幂等记录（`expires_at < now`，每日一次）

---

*Codex Task | 来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
