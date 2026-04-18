'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchObservabilityTrace, fetchObservabilityTraces } from '@/services/endpoints/ai-subservice';
import type { DispatcherOrlaStageEvent, TraceSpan, WorkflowTrace } from '@/types/distributed-tracing';

export default function TracesPage() {
  const [traces, setTraces] = useState<WorkflowTrace[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [selectedTrace, setSelectedTrace] = useState<WorkflowTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchObservabilityTraces({ limit: 50 });
      setTraces(result.traces || []);
      if (!selectedTraceId && result.traces?.[0]?.trace_id) {
        setSelectedTraceId(result.traces[0].trace_id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载 Trace 失败');
    } finally {
      setLoading(false);
    }
  }, [selectedTraceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTraceId) return;
    void fetchObservabilityTrace(selectedTraceId)
      .then((result) => setSelectedTrace(result))
      .catch((error) => setMessage(error instanceof Error ? error.message : '加载 Trace 详情失败'));
  }, [selectedTraceId]);

  const totalMs = useMemo(
    () => Math.max(1, ...((selectedTrace?.spans ?? []).map((item) => Number(item.latency_ms || 0)))),
    [selectedTrace],
  );

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-white">分布式链路追踪</div>
            <div className="mt-2 text-sm text-slate-400">复用现有 Langfuse 风格 observability store，看清 workflow → lobster → generation 的链路耗时。</div>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100">
            <RefreshCw className="h-4 w-4" />
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        {message ? <div className="mt-3 text-sm text-cyan-200">{message}</div> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 text-sm font-semibold text-white">最近 Trace</div>
          <div className="space-y-2">
            {traces.map((trace) => (
              <button
                key={trace.trace_id}
                type="button"
                onClick={() => setSelectedTraceId(trace.trace_id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedTraceId === trace.trace_id ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}
              >
                <div className="text-sm font-semibold text-white">{trace.workflow_name || trace.trace_id}</div>
                <div className="mt-1 text-xs text-slate-400">{trace.trace_id}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span>{trace.status || 'unknown'}</span>
                  <span>spans {(trace.spans ?? []).length}</span>
                  <span>tokens {trace.total_tokens || 0}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          {!selectedTrace ? (
            <div className="text-sm text-slate-400">请选择左侧 Trace。</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-white">{selectedTrace.workflow_name || selectedTrace.trace_id}</div>
                <div className="mt-1 text-xs text-slate-400">{selectedTrace.trace_id} · {selectedTrace.status || 'unknown'}</div>
              </div>
              {selectedTrace.dispatcher_orla?.event_count ? <DispatcherOrlaPanel stages={selectedTrace.dispatcher_orla.stages} /> : null}
              <WorkflowTraceViewer spans={selectedTrace.spans ?? []} totalMs={totalMs} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DispatcherOrlaPanel({ stages }: { stages: DispatcherOrlaStageEvent[] }) {
  return (
    <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.06] p-4">
      <div className="text-sm font-semibold text-cyan-100">Dispatcher Orla Timeline</div>
      <div className="mt-2 text-xs text-slate-300">
        选中 trace 后，这里展示 dispatcher 的阶段路由、tier 和升档触发，方便判断 pilot 是否真正按阶段做调度。
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((stage, index) => (
          <div key={`${stage.stage_id}-${stage.created_at || index}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">{stage.stage_id || 'unknown'}</span>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">{stage.applied_tier || '-'}</span>
              {stage.promotion_trigger ? (
                <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">{stage.promotion_trigger}</span>
              ) : null}
              {stage.shared_state_hit ? (
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">shared state hit</span>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              reason: <span className="text-slate-200">{stage.reason || '-'}</span>
              {stage.created_at ? <span className="ml-3">{new Date(stage.created_at).toLocaleString('zh-CN', { hour12: false })}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowTraceViewer({ spans, totalMs }: { spans: TraceSpan[]; totalMs: number }) {
  return (
    <div className="space-y-2 text-xs">
      {spans.map((span) => {
        const widthPct = Math.max(((Number(span.latency_ms || 0) || 0) / totalMs) * 100, 3);
        return (
          <div key={span.span_id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-medium text-white">{span.lobster || span.skill || span.span_id}</div>
              <div className="text-slate-400">{span.latency_ms || 0}ms</div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-900/80">
              <div className="h-full rounded-full bg-cyan-400/70" style={{ width: `${widthPct}%` }} />
            </div>
            {(span.generations ?? []).length > 0 ? (
              <div className="mt-3 space-y-2">
                {span.generations?.map((generation) => (
                  <div key={generation.gen_id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-200">{generation.model}</span>
                      <span className="text-slate-500">{generation.latency_ms || 0}ms</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      tokens {(generation.prompt_tokens || 0) + (generation.completion_tokens || 0)} · provider {generation.provider || '-'}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
