# CODEX TASK: 工作流实时执行日志流（SSE 步骤进度推送）

**优先级：P1**  
**来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#1（Trigger.dev Realtime Stream）**

---

## 背景

工作流执行目前是黑盒：用户触发后一片黑暗，等待1-2分钟才知道结果。借鉴 Trigger.dev Realtime（SSE），每步开始/完成时实时推送状态，前端渲染实时进度，工作流从黑盒变透明。与已落地的 CODEX_TASK_WORKFLOW_EXECUTION_REPLAY 互补：Replay=历史可追溯，实时流=当前可观测。

---

## 一、后端 SSE 推送实现

```python
# dragon-senate-saas-v2/api_workflow_realtime.py

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
import asyncio, json, time
from typing import AsyncGenerator

realtime_router = APIRouter(prefix="/v1/executions", tags=["realtime"])

# 内存中的事件总线（生产可换 Redis Pub/Sub）
_execution_channels: dict[str, asyncio.Queue] = {}

def get_or_create_channel(execution_id: str) -> asyncio.Queue:
    if execution_id not in _execution_channels:
        _execution_channels[execution_id] = asyncio.Queue(maxsize=100)
    return _execution_channels[execution_id]

async def publish_step_event(execution_id: str, event: dict):
    """LobsterRunner 每步执行时调用此函数推送事件"""
    channel = get_or_create_channel(execution_id)
    try:
        channel.put_nowait(event)
    except asyncio.QueueFull:
        pass  # 无订阅者时丢弃

async def _sse_generator(execution_id: str, request: Request) -> AsyncGenerator[str, None]:
    """SSE 生成器：监听 execution channel，格式化为 SSE"""
    channel = get_or_create_channel(execution_id)
    
    # 先推送心跳，告知连接成功
    yield f"data: {json.dumps({'type': 'connected', 'execution_id': execution_id})}\n\n"
    
    try:
        while True:
            # 检测客户端断开
            if await request.is_disconnected():
                break
            
            try:
                event = await asyncio.wait_for(channel.get(), timeout=30.0)
                yield f"data: {json.dumps(event)}\n\n"
                
                # 执行完成，关闭 SSE 连接
                if event.get("type") in ("execution_completed", "execution_failed"):
                    break
            except asyncio.TimeoutError:
                # 每30秒发送心跳保活
                yield f"data: {json.dumps({'type': 'heartbeat', 'ts': time.time()})}\n\n"
    finally:
        # 清理 channel（执行完且无人监听时）
        if execution_id in _execution_channels:
            if channel.empty():
                del _execution_channels[execution_id]

@realtime_router.get("/{execution_id}/stream")
async def stream_execution(
    execution_id: str,
    request: Request,
    tenant_context=Depends(get_tenant_context),
):
    """SSE 端点：实时订阅工作流执行进度"""
    # 验证执行属于当前租户
    record = db.query(WorkflowExecutionRecord).filter_by(execution_id=execution_id).first()
    if not record or record.tenant_id != tenant_context.tenant_id:
        raise HTTPException(404)
    
    return StreamingResponse(
        _sse_generator(execution_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁止 Nginx 缓冲
        },
    )
```

---

## 二、LobsterRunner 集成推送

```python
# dragon-senate-saas-v2/lobster_runner.py — 新增推送调用

from .api_workflow_realtime import publish_step_event

class LobsterRunner:

    async def run_workflow(self, workflow, input_data, tenant_id, ...):
        execution_id = str(uuid.uuid4())
        
        # 推送：工作流开始
        await publish_step_event(execution_id, {
            "type": "execution_started",
            "execution_id": execution_id,
            "workflow_name": workflow.name,
            "total_steps": len(workflow.steps),
            "ts": time.time(),
        })

        results = {}
        for i, step in enumerate(workflow.steps):
            step_start = time.time()
            
            # 推送：步骤开始
            await publish_step_event(execution_id, {
                "type": "step_started",
                "step_index": i,
                "step_id": step.step_id,
                "lobster_name": step.lobster_id,
                "skill_name": step.skill_name,
                "ts": step_start,
            })

            try:
                result = await self._run_step_with_retry(step, results, tenant_id)
                duration_ms = int((time.time() - step_start) * 1000)
                
                # 推送：步骤成功
                await publish_step_event(execution_id, {
                    "type": "step_completed",
                    "step_index": i,
                    "step_id": step.step_id,
                    "status": "success",
                    "duration_ms": duration_ms,
                    "quality_score": getattr(result, "quality_score", None),
                    "token_count": getattr(result, "token_count", None),
                    "ts": time.time(),
                })
                results[step.output_key] = result.output

            except Exception as e:
                # 推送：步骤失败
                await publish_step_event(execution_id, {
                    "type": "step_failed",
                    "step_index": i,
                    "step_id": step.step_id,
                    "status": "error",
                    "error": str(e),
                    "duration_ms": int((time.time() - step_start) * 1000),
                    "ts": time.time(),
                })
                # 推送：执行失败
                await publish_step_event(execution_id, {
                    "type": "execution_failed",
                    "execution_id": execution_id,
                    "failed_step": step.step_id,
                    "ts": time.time(),
                })
                raise

        # 推送：执行完成
        await publish_step_event(execution_id, {
            "type": "execution_completed",
            "execution_id": execution_id,
            "total_steps": len(workflow.steps),
            "ts": time.time(),
        })
        return results
```

---

## 三、前端实时进度组件

```typescript
// web/src/hooks/useExecutionStream.ts
// SSE 订阅 Hook

export type StepStreamEvent = {
  type: 'execution_started' | 'step_started' | 'step_completed' | 'step_failed' | 'execution_completed' | 'execution_failed' | 'heartbeat';
  step_index?: number;
  step_id?: string;
  lobster_name?: string;
  skill_name?: string;
  status?: 'success' | 'error';
  duration_ms?: number;
  quality_score?: number;
  error?: string;
  ts: number;
};

export function useExecutionStream(executionId: string | null) {
  const [events, setEvents] = useState<StepStreamEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!executionId) return;
    
    const evtSource = new EventSource(`/api/v1/executions/${executionId}/stream`, {
      withCredentials: true,
    });
    
    evtSource.onmessage = (e) => {
      const event: StepStreamEvent = JSON.parse(e.data);
      if (event.type === 'heartbeat') return;
      
      setEvents(prev => [...prev, event]);
      if (event.type === 'execution_completed' || event.type === 'execution_failed') {
        setIsComplete(true);
        evtSource.close();
      }
    };
    
    evtSource.onerror = () => evtSource.close();
    return () => evtSource.close();
  }, [executionId]);

  return { events, isComplete };
}
```

```typescript
// web/src/components/workflow/WorkflowRunMonitor.tsx
// 实时执行监控组件

export function WorkflowRunMonitor({
  executionId,
  workflowSteps,
}: {
  executionId: string;
  workflowSteps: WorkflowStep[];
}) {
  const { events, isComplete } = useExecutionStream(executionId);

  // 从事件流构建步骤状态
  const stepStates = useMemo(() => {
    const states: Record<string, { status: 'pending' | 'running' | 'success' | 'error'; duration_ms?: number; quality_score?: number; error?: string }> = {};
    workflowSteps.forEach(s => { states[s.step_id] = { status: 'pending' }; });
    
    for (const event of events) {
      if (event.step_id) {
        if (event.type === 'step_started') states[event.step_id] = { status: 'running' };
        if (event.type === 'step_completed') states[event.step_id] = {
          status: 'success',
          duration_ms: event.duration_ms,
          quality_score: event.quality_score,
        };
        if (event.type === 'step_failed') states[event.step_id] = {
          status: 'error',
          error: event.error,
          duration_ms: event.duration_ms,
        };
      }
    }
    return states;
  }, [events, workflowSteps]);

  const completedCount = Object.values(stepStates).filter(s => s.status === 'success').count;

  return (
    <div className="space-y-4">
      {/* 总体进度条 */}
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {isComplete ? '执行完成' : '执行中...'}
          </span>
          <span className="font-medium">{completedCount} / {workflowSteps.length} 步</span>
        </div>
        <Progress value={(completedCount / workflowSteps.length) * 100} className="h-2" />
      </div>

      {/* 步骤列表 */}
      <div className="space-y-1">
        {workflowSteps.map((step, i) => {
          const state = stepStates[step.step_id];
          return (
            <div key={step.step_id} className={cn(
              "flex items-center gap-3 p-2 rounded-md text-sm transition-colors",
              state?.status === 'running' && "bg-blue-50 border border-blue-200",
            )}>
              {/* 状态图标 */}
              <div className="w-5 flex-shrink-0 flex justify-center">
                {state?.status === 'pending' && <Clock className="h-4 w-4 text-muted-foreground/50" />}
                {state?.status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                {state?.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {state?.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
              </div>

              {/* 步骤信息 */}
              <div className="flex-1 min-w-0">
                <span className={cn(
                  "font-medium",
                  state?.status === 'pending' && "text-muted-foreground",
                  state?.status === 'running' && "text-blue-700",
                )}>
                  {step.skill_name}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({step.lobster_id})
                </span>
                {state?.status === 'error' && (
                  <p className="text-xs text-destructive mt-0.5 truncate">{state.error}</p>
                )}
              </div>

              {/* 右侧指标 */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {state?.quality_score && (
                  <span className={cn("text-xs font-medium",
                    state.quality_score >= 8 ? "text-green-600" :
                    state.quality_score >= 6 ? "text-orange-500" : "text-destructive"
                  )}>
                    {state.quality_score.toFixed(1)}分
                  </span>
                )}
                {state?.duration_ms && (
                  <span className="text-xs text-muted-foreground">{state.duration_ms}ms</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

```typescript
// web/src/app/workflows/[id]/run/page.tsx
// 工作流手动触发页（包含实时监控）

export function WorkflowRunPage({ workflowId }) {
  const [executionId, setExecutionId] = useState<string | null>(null);

  const handleRun = async (inputData: Record<string, string>) => {
    const res = await api.post(`/v1/workflows/${workflowId}/trigger`, { input: inputData });
    setExecutionId(res.data.execution_id);
    // 有了 execution_id 后，WorkflowRunMonitor 自动开始 SSE 订阅
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      <WorkflowInputForm onSubmit={handleRun} />
      {executionId && (
        <WorkflowRunMonitor
          executionId={executionId}
          workflowSteps={workflow.steps}
        />
      )}
    </div>
  );
}
```

---

## 验收标准

**后端：**
- [ ] `publish_step_event(execution_id, event)` — 内存 Queue 事件发布
- [ ] `GET /v1/executions/{id}/stream` — SSE 端点（Content-Type: text/event-stream）
- [ ] 事件类型：execution_started / step_started / step_completed / step_failed / execution_completed / execution_failed / heartbeat
- [ ] SSE 心跳：每30秒发送 heartbeat 保活（防止 Nginx 超时断开）
- [ ] 客户端断开检测（`request.is_disconnected()`）并清理 channel
- [ ] 执行完成/失败后自动关闭 SSE 流
- [ ] `LobsterRunner` 每步开始/完成时调用 `publish_step_event`
- [ ] 推送字段：step_index / step_id / lobster_name / skill_name / duration_ms / quality_score / error

**前端：**
- [ ] `useExecutionStream(executionId)` Hook（EventSource + 事件解析）
- [ ] `WorkflowRunMonitor` 组件（步骤列表实时状态 + 总进度条）
- [ ] 步骤状态：pending（灰时钟）/ running（蓝旋转）/ success（绿勾）/ error（红叉）
- [ ] running 步骤高亮背景（蓝色边框）
- [ ] 质量分着色（≥8绿/≥6橙/<6红）+ 耗时显示
- [ ] 工作流触发页（`/workflows/[id]/run`）集成 WorkflowRunMonitor

---

*Codex Task | 来源：TRIGGERDEV_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
