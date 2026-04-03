# CODEX TASK: 执行历史调试回放（Execution Replay）

**优先级：P1**  
**来源：N8N_BORROWING_ANALYSIS.md P1-#3（n8n Execution History）**

---

## 背景

当前工作流执行只记录单条最终结果，无法：查看每个步骤的中间输出、用原始输入重新执行、从某步骤断点续跑。借鉴 n8n Execution History，实现步骤级快照 + 一键重新执行。

---

## 一、执行快照数据模型

```python
# dragon-senate-saas-v2/workflow_execution_snapshot.py

from dataclasses import dataclass, field
from typing import Optional, List, Literal
from datetime import datetime

@dataclass
class StepSnapshot:
    """单步执行快照"""
    step_id: str
    lobster_id: str
    skill_name: str
    status: Literal["success", "error", "skipped"]
    started_at: datetime
    finished_at: Optional[datetime]
    duration_ms: Optional[int]
    input_data: dict          # 步骤实际输入（含变量解析后的值）
    output_data: dict         # 步骤实际输出
    quality_score: Optional[float]
    error_message: Optional[str]
    token_count: Optional[int]
    model: Optional[str]

@dataclass
class WorkflowExecutionRecord:
    """工作流执行完整快照"""
    execution_id: str
    workflow_id: str
    workflow_name: str
    tenant_id: str
    status: Literal["running", "success", "error", "cancelled"]
    trigger_type: Literal["manual", "cron", "webhook", "error_compensation"]
    original_input: dict       # 触发时的原始输入（用于 Replay）
    step_snapshots: List[StepSnapshot] = field(default_factory=list)
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    total_duration_ms: Optional[int] = None
    total_tokens: Optional[int] = None
    avg_quality_score: Optional[float] = None
    source_execution_id: Optional[str] = None  # Replay 来源
    replay_from_step_id: Optional[str] = None  # 从哪步开始重跑
```

---

## 二、执行引擎集成快照写入

```python
# dragon-senate-saas-v2/lobster_runner.py — 集成快照

class LobsterRunner:

    async def run_workflow(self, workflow, input_data, tenant_id,
                           replay_from_step_id=None, source_execution_id=None):
        execution_id = str(uuid.uuid4())
        record = WorkflowExecutionRecord(
            execution_id=execution_id,
            workflow_id=workflow.workflow_id,
            workflow_name=workflow.name,
            tenant_id=tenant_id,
            status="running",
            trigger_type="manual",
            original_input=input_data,
            source_execution_id=source_execution_id,
            replay_from_step_id=replay_from_step_id,
        )
        db.add(record)
        db.commit()

        results = {}
        for step in workflow.steps:
            step_start = datetime.utcnow()

            # Replay 模式：跳过已成功的步骤（直接用上次输出）
            if replay_from_step_id and source_execution_id:
                prev = _get_step_snapshot(source_execution_id, step.step_id)
                if prev and prev.status == "success":
                    results[step.output_key] = prev.output_data.get("output")
                    record.step_snapshots.append(dataclasses.replace(prev, status="skipped"))
                    continue  # 跳过，用历史输出
                elif step.step_id != replay_from_step_id and not results:
                    continue  # 还没到 replay_from_step_id，继续跳

            # 正常执行步骤
            step_input = _resolve_step_input(step, results, input_data)
            try:
                result = await self._run_step(step, step_input, tenant_id)
                snapshot = StepSnapshot(
                    step_id=step.step_id,
                    lobster_id=step.lobster_id,
                    skill_name=step.skill_name,
                    status="success",
                    started_at=step_start,
                    finished_at=datetime.utcnow(),
                    duration_ms=int((datetime.utcnow() - step_start).total_seconds() * 1000),
                    input_data=step_input,
                    output_data={"output": result.output},
                    quality_score=result.quality_score,
                    token_count=result.token_count,
                    model=result.model,
                    error_message=None,
                )
                results[step.output_key] = result.output

            except Exception as e:
                snapshot = StepSnapshot(
                    step_id=step.step_id, lobster_id=step.lobster_id,
                    skill_name=step.skill_name, status="error",
                    started_at=step_start, finished_at=datetime.utcnow(),
                    duration_ms=int((datetime.utcnow() - step_start).total_seconds() * 1000),
                    input_data=step_input, output_data={},
                    quality_score=None, error_message=str(e),
                    token_count=None, model=None,
                )
                record.step_snapshots.append(snapshot)
                record.status = "error"
                db.commit()
                raise

            record.step_snapshots.append(snapshot)
            db.commit()

        record.status = "success"
        record.finished_at = datetime.utcnow()
        db.commit()
        return results

    def _get_step_snapshot(self, execution_id: str, step_id: str) -> Optional[StepSnapshot]:
        record = db.query(WorkflowExecutionRecord).filter_by(execution_id=execution_id).first()
        if not record:
            return None
        return next((s for s in record.step_snapshots if s.step_id == step_id), None)
```

---

## 三、Replay API

```python
# dragon-senate-saas-v2/api_workflow_executions.py

@router.get("/workflows/{workflow_id}/executions")
async def list_executions(
    workflow_id: str,
    page: int = 1, page_size: int = 20,
    status: Optional[str] = None,
    tenant_context=Depends(get_tenant_context),
):
    """工作流执行历史列表"""
    query = db.query(WorkflowExecutionRecord).filter(
        WorkflowExecutionRecord.workflow_id == workflow_id,
        WorkflowExecutionRecord.tenant_id == tenant_context.tenant_id,
    ).order_by(WorkflowExecutionRecord.started_at.desc())
    if status:
        query = query.filter(WorkflowExecutionRecord.status == status)
    records = query.offset((page - 1) * page_size).limit(page_size).all()
    return {"executions": [asdict(r) for r in records], "page": page}

@router.get("/executions/{execution_id}")
async def get_execution_detail(execution_id: str, tenant_context=Depends(get_tenant_context)):
    """获取单次执行详情（含步骤快照）"""
    record = db.query(WorkflowExecutionRecord).filter_by(execution_id=execution_id).first()
    if not record or record.tenant_id != tenant_context.tenant_id:
        raise HTTPException(404)
    return asdict(record)

@router.post("/executions/{execution_id}/replay")
async def replay_execution(
    execution_id: str,
    body: ReplayBody,  # { from_step_id: Optional[str] }
    tenant_context=Depends(get_tenant_context),
):
    """用原始输入重新执行（可选从指定步骤开始）"""
    record = db.query(WorkflowExecutionRecord).filter_by(execution_id=execution_id).first()
    if not record:
        raise HTTPException(404)
    
    workflow = get_workflow(record.workflow_id)
    new_execution_id = await runner.run_workflow(
        workflow=workflow,
        input_data=record.original_input,
        tenant_id=tenant_context.tenant_id,
        replay_from_step_id=body.from_step_id,
        source_execution_id=execution_id,
    )
    return {"new_execution_id": new_execution_id, "replayed_from": execution_id}
```

---

## 四、前端执行历史 + 步骤详情 UI

```typescript
// web/src/app/workflows/[id]/executions/page.tsx — 执行历史列表

export function ExecutionHistoryPage({ workflowId }) {
  return (
    <DataTable
      columns={[
        { header: "状态", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "触发方式", accessor: "trigger_type" },
        { header: "开始时间", cell: (row) => formatTime(row.started_at) },
        { header: "耗时", cell: (row) => `${row.total_duration_ms}ms` },
        { header: "质量分", cell: (row) => row.avg_quality_score?.toFixed(1) ?? '-' },
        { header: "操作", cell: (row) => (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => openDetail(row.execution_id)}>
              查看详情
            </Button>
            <Button size="sm" variant="outline" onClick={() => replay(row.execution_id)}>
              ↺ 重新执行
            </Button>
          </div>
        )},
      ]}
      queryFn={() => api.get(`/v1/workflows/${workflowId}/executions`)}
    />
  );
}

// web/src/components/executions/ExecutionDetailDrawer.tsx
// 右侧抽屉：显示步骤快照 + 重新执行按钮

export function ExecutionDetailDrawer({ executionId, open, onClose }) {
  const { data: execution } = useQuery({
    queryFn: () => api.get(`/v1/executions/${executionId}`),
    enabled: open,
  });

  const replayFrom = async (stepId?: string) => {
    const res = await api.post(`/v1/executions/${executionId}/replay`, { from_step_id: stepId });
    toast({ title: "已创建重放执行", description: `执行ID: ${res.data.new_execution_id}` });
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>执行详情</SheetTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => replayFrom()}>↺ 用相同输入重新执行</Button>
          </div>
        </SheetHeader>

        <div className="space-y-3 mt-4">
          {execution?.step_snapshots.map((snap, i) => (
            <div key={snap.step_id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
                  <span className="font-medium text-sm">{snap.skill_name}</span>
                  <StatusBadge status={snap.status} />
                  {snap.status === "skipped" && (
                    <span className="text-xs text-muted-foreground">（使用历史输出）</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{snap.duration_ms}ms</span>
                  {snap.quality_score && (
                    <span className={cn("text-xs font-medium", snap.quality_score < 7 ? "text-destructive" : "text-green-600")}>
                      {snap.quality_score.toFixed(1)}分
                    </span>
                  )}
                  {snap.status !== "skipped" && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs"
                      onClick={() => replayFrom(snap.step_id)}>
                      从此步重跑
                    </Button>
                  )}
                </div>
              </div>

              {/* 步骤 I/O 折叠显示 */}
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
                  查看输入/输出 ▾
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="text-xs font-medium mb-1">输入</p>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                        {JSON.stringify(snap.input_data, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-medium mb-1">输出</p>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                        {snap.error_message || JSON.stringify(snap.output_data, null, 2)}
                      </pre>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

---

## 验收标准

- [ ] `StepSnapshot` + `WorkflowExecutionRecord` 数据模型
- [ ] 执行引擎每步完成后写入 `StepSnapshot`（input/output/duration/quality_score）
- [ ] `replay_from_step_id` 支持：跳过已成功步骤，直接从指定步骤重新执行
- [ ] 跳过的步骤标记 `status="skipped"` + 复用历史输出
- [ ] `GET /workflows/{id}/executions` — 历史列表（含分页/状态过滤）
- [ ] `GET /executions/{id}` — 完整快照（含所有步骤 I/O）
- [ ] `POST /executions/{id}/replay` — 重放（可选 `from_step_id`）
- [ ] 前端执行历史列表页（`/workflows/[id]/executions`）
- [ ] `ExecutionDetailDrawer`：步骤卡片列表 + 折叠 I/O + "从此步重跑"按钮
- [ ] "用相同输入重新执行"：一键重放整个工作流
- [ ] 重放的执行记录中 `source_execution_id` 指向原始执行

---

*Codex Task | 来源：N8N_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
