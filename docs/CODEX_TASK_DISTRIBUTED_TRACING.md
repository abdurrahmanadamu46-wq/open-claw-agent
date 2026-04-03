# CODEX TASK: 分布式链路追踪 — 复用 Langfuse Trace/Span 实现跨龙虾追踪

**优先级：P1**  
**来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#3（SigNoz OTel Traces）**

---

## 背景

工作流执行涉及多个龙虾串/并行调用，目前每次执行只有一条运行记录，无法看到：哪个龙虾耗时最长、LLM调用占比多少、跨边缘节点的链路。借鉴 SigNoz Traces 的思路，**复用已落地的 Langfuse**（llm_call_logger.py 已集成）实现 Trace/Span 层级追踪，无需引入额外基础设施。

---

## 一、Trace 层级设计

```
工作流执行 Trace（父级）
  ├── Commander 编排 Span
  │     ├── Strategist 分析 Span
  │     │     └── LLM Call Span（Claude-3.5 / 380ms / 312 tokens）
  │     ├── InkWriter 写作 Span
  │     │     ├── LLM Call Span（Claude-3.5 / 580ms / 846 tokens）
  │     │     └── Quality Judge Span（40ms / score: 8.3）
  │     └── Dispatcher 调度 Span（80ms）
  └── 工作流总耗时：1200ms | 总 Token：1158 | 质量分：8.3
```

---

## 二、LangfuseTracer（核心封装）

```python
# dragon-senate-saas-v2/langfuse_tracer.py

from langfuse import Langfuse
from contextlib import contextmanager
from typing import Optional
import time
import os

_langfuse = Langfuse(
    public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
    secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
    host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
)

class LangfuseTracer:
    """统一封装 Langfuse Trace/Span，供龙虾执行链路使用"""

    @staticmethod
    def start_workflow_trace(
        workflow_id: str,
        workflow_name: str,
        tenant_id: str,
        input_summary: dict,
        metadata: Optional[dict] = None,
    ):
        """创建工作流父级 Trace"""
        trace = _langfuse.trace(
            id=workflow_id,
            name=f"workflow:{workflow_name}",
            input=input_summary,
            metadata={
                "tenant_id": tenant_id,
                "workflow_name": workflow_name,
                **(metadata or {}),
            },
            tags=["workflow", tenant_id],
        )
        return trace

    @staticmethod
    def start_lobster_span(
        trace,
        lobster_name: str,
        skill_name: str,
        lobster_id: str,
        input_data: dict,
        edge_node_id: Optional[str] = None,
    ):
        """在 Trace 下创建龙虾执行 Span"""
        span = trace.span(
            name=f"{lobster_name}:{skill_name}",
            input=input_data,
            metadata={
                "lobster_id": lobster_id,
                "lobster_name": lobster_name,
                "skill_name": skill_name,
                "edge_node_id": edge_node_id or "cloud",
            },
        )
        return span

    @staticmethod
    def end_lobster_span(span, output: dict, quality_score: Optional[float] = None, error: Optional[str] = None):
        """结束龙虾 Span，记录输出和评分"""
        span.end(
            output=output,
            level="ERROR" if error else "DEFAULT",
            status_message=error,
            metadata={"quality_score": quality_score} if quality_score else {},
        )

    @staticmethod
    def record_llm_generation(
        span,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        duration_ms: int,
        input_prompt: str,
        output_text: str,
        quality_score: Optional[float] = None,
    ):
        """在 Span 下记录 LLM 调用（Generation）"""
        generation = span.generation(
            name="llm_call",
            model=model,
            input=input_prompt,
            output=output_text,
            usage={
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "totalTokens": prompt_tokens + completion_tokens,
            },
            metadata={
                "duration_ms": duration_ms,
                "quality_score": quality_score,
            },
        )
        return generation
```

---

## 三、集成到龙虾执行流程

```python
# dragon-senate-saas-v2/lobster_runner.py — 添加 Trace 集成

from .langfuse_tracer import LangfuseTracer

class LobsterRunner:
    async def run_workflow(self, workflow: Workflow, input_data: dict, tenant_id: str):
        # 1. 创建工作流父级 Trace
        trace = LangfuseTracer.start_workflow_trace(
            workflow_id=f"wf_{workflow.id}_{int(time.time())}",
            workflow_name=workflow.name,
            tenant_id=tenant_id,
            input_summary={"step_count": len(workflow.steps), "input_keys": list(input_data.keys())},
        )

        results = {}
        for step in workflow.steps:
            lobster = self.pool.get(step.lobster_id)
            skill = step.skill_name

            # 2. 为每个步骤创建 Lobster Span
            span = LangfuseTracer.start_lobster_span(
                trace=trace,
                lobster_name=lobster.display_name,
                skill_name=skill,
                lobster_id=lobster.id,
                input_data=step.resolve_input(results),
                edge_node_id=step.edge_node_id,
            )

            try:
                result = await lobster.execute(skill, step.resolve_input(results))

                # 3. 如果有 LLM 调用，记录 Generation
                if result.llm_call:
                    LangfuseTracer.record_llm_generation(
                        span=span,
                        model=result.llm_call.model,
                        prompt_tokens=result.llm_call.prompt_tokens,
                        completion_tokens=result.llm_call.completion_tokens,
                        duration_ms=result.llm_call.duration_ms,
                        input_prompt=result.llm_call.prompt[:500],  # 截断保护
                        output_text=result.output[:500],
                        quality_score=result.quality_score,
                    )

                LangfuseTracer.end_lobster_span(
                    span, output={"output": result.output, "quality_score": result.quality_score}
                )
                results[step.output_key] = result.output

            except Exception as e:
                LangfuseTracer.end_lobster_span(span, output={}, error=str(e))
                raise

        # 4. 更新 Trace 汇总
        trace.update(
            output={"result": results.get("final_output"), "steps_completed": len(results)},
            metadata={
                "total_quality_score": sum(r.quality_score for r in results.values() if hasattr(r, 'quality_score')) / len(results) if results else None,
            },
        )
        return results
```

---

## 四、前端链路追踪查看页

```typescript
// web/src/app/operations/traces/page.tsx
// 工作流执行 Trace 列表（从 Langfuse API 或我们的 observability_api 中读取）

// web/src/components/traces/WorkflowTraceViewer.tsx
// Gantt 图可视化（简化版）

interface TraceSpan {
  name: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  quality_score?: number;
  children?: TraceSpan[];
}

export function WorkflowTraceViewer({ spans, totalMs }: { spans: TraceSpan[], totalMs: number }) {
  return (
    <div className="space-y-1 font-mono text-xs">
      {spans.map((span, i) => {
        const leftPct = (span.startMs / totalMs) * 100;
        const widthPct = Math.max((span.durationMs / totalMs) * 100, 2);
        return (
          <div key={i} className="flex items-center gap-2 h-7">
            <span className="w-48 truncate text-right text-muted-foreground">{span.name}</span>
            <div className="flex-1 relative h-5 bg-muted/30 rounded">
              <div
                className={cn(
                  "absolute h-full rounded",
                  span.status === 'error' ? 'bg-destructive/70' : 'bg-primary/60'
                )}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              />
            </div>
            <span className="w-16 text-right">{span.durationMs}ms</span>
            {span.quality_score && (
              <span className={cn("w-8 text-right", span.quality_score < 7 ? 'text-destructive' : 'text-green-600')}>
                {span.quality_score.toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## 五、Trace ID 透传（边缘节点）

```python
# edge-runtime/task_schema.py — 确保 trace_id 随任务传递

@dataclass
class LobsterTask:
    task_id: str
    lobster_id: str
    skill_name: str
    tenant_id: str
    input_data: dict
    trace_id: Optional[str] = None    # ← 新增：工作流 Trace ID
    parent_span_id: Optional[str] = None  # ← 新增：父 Span ID

# edge-runtime/marionette_executor.py
# 边缘执行完毕后，将 trace_id 写入遥测事件（与 EdgeTelemetryBuffer 联动）
```

---

## 验收标准

- [ ] `LangfuseTracer` 封装类（start_workflow_trace / start_lobster_span / end_lobster_span / record_llm_generation）
- [ ] `LobsterRunner.run_workflow()` 集成 Trace：每个工作流步骤一个 Span
- [ ] LLM 调用时自动记录 Generation（model / tokens / duration / quality_score）
- [ ] 错误时 Span 标记 ERROR + status_message
- [ ] 边缘任务 `LobsterTask` 携带 `trace_id` 字段透传
- [ ] 前端 Trace 列表页（`/operations/traces`）：从 observability_api 读取最近 50 个 Trace
- [ ] `WorkflowTraceViewer` Gantt 图（各 Span 时间轴可视化）
- [ ] Trace 列表支持按工作流/租户/时间范围过滤
- [ ] 点击 Trace 展开查看各 Span 详情（含 LLM 输入/输出/Token）

---

*Codex Task | 来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
