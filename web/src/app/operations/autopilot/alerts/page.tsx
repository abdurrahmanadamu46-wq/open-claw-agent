'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { evaluateAutopilotAlerts } from '@/services/endpoints/autopilot';
import { fetchAiKernelAlerts } from '@/services/endpoints/ai-subservice';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

function severityClass(severity: 'P1' | 'P2' | 'P3'): string {
  if (severity === 'P1') return 'text-rose-300';
  if (severity === 'P2') return 'text-amber-300';
  return 'text-emerald-300';
}

export default function AutopilotAlertsPage() {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [sourceQueue, setSourceQueue] = useState('');
  const [emit, setEmit] = useState(false);

  const query = useQuery({
    queryKey: ['autopilot', 'alerts', windowMinutes, sourceQueue, emit],
    queryFn: () =>
      evaluateAutopilotAlerts({
        windowMinutes,
        sourceQueue: sourceQueue.trim() || undefined,
        emit,
      }),
    refetchInterval: 15000,
  });

  const kernelQuery = useQuery({
    queryKey: ['kernel', 'alerts', windowMinutes],
    queryFn: () =>
      fetchAiKernelAlerts({
        granularity: windowMinutes <= 180 ? 'hour' : 'day',
      }),
    refetchInterval: 15000,
  });

  const firedCount = useMemo(
    () => (query.data?.signals ?? []).filter((signal) => signal.state === 'fired').length,
    [query.data],
  );
  const kernelFiredCount = useMemo(
    () => (kernelQuery.data?.signals ?? []).filter((signal) => signal.state === 'fired').length,
    [kernelQuery.data],
  );

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="trace"
        step="主线第 5 步 · 风险判断"
        title="先判断风险，再决定去哪处理"
        description="告警中心不只是看有没有红点，而是帮你判断：问题来自执行链、治理链，还是审批积压。"
        previous={{ href: '/operations/leads', label: '回到线索池' }}
        next={{ href: '/operations/autopilot/trace', label: '前往 Trace 复盘' }}
        actions={
          <>
            <Link href="/operations/autopilot/trace" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]">
              打开 Trace
            </Link>
            <Link href="/operations/autopilot/approvals" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15">
              打开审批中心
            </Link>
          </>
        }
      />

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <FilterField label="回看窗口（分钟）">
            <input
              type="number"
              min={1}
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(Number.parseInt(event.target.value || '60', 10))}
            />
          </FilterField>
          <FilterField label="队列范围">
            <input
              type="text"
              placeholder="例如 content_forge_queue"
              className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
              value={sourceQueue}
              onChange={(event) => setSourceQueue(event.target.value)}
            />
          </FilterField>
          <FilterField label="是否发出状态变更">
            <label className="flex h-[50px] items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
              <input type="checkbox" checked={emit} onChange={(event) => setEmit(event.target.checked)} />
              写入告警状态
            </label>
          </FilterField>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="h-[50px] w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              立即评估
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="执行链告警" value={String(firedCount)} helper="当前命中的 autopilot 规则数" />
        <SummaryCard label="治理链告警" value={String(kernelFiredCount)} helper="当前命中的 kernel risk alerts 数" />
        <SummaryCard
          label="审批积压"
          value={String(kernelQuery.data?.totals.approval_backlog ?? 0)}
          helper="过高时会拖慢高风险动作处理"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            执行链告警
          </div>
          <div className="space-y-3">
            {(query.data?.signals ?? []).map((signal) => (
              <div key={`${signal.ruleKey}:${signal.sourceQueue ?? 'all'}`} className="rounded-2xl border border-white/8 bg-slate-950/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{signal.ruleKey}</div>
                  <div className={`text-xs font-medium ${severityClass(signal.severity)}`}>{signal.severity}</div>
                </div>
                <div className="mt-2 text-sm leading-7 text-slate-300">{signal.message}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <MiniStat label="状态" value={signal.state} />
                  <MiniStat label="数值" value={String(signal.value)} />
                  <MiniStat label="阈值" value={String(signal.threshold)} />
                  <MiniStat label="队列" value={signal.sourceQueue || '全部'} />
                </div>
              </div>
            ))}
            {(query.data?.signals ?? []).length === 0 && (
              <EmptyNotice text="当前没有执行链告警，说明这段时间的 autopilot 规则没有命中异常。" />
            )}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            治理链告警
          </div>
          <div className="space-y-3">
            {(kernelQuery.data?.signals ?? []).map((signal) => (
              <div key={`${signal.rule_key}:${signal.family}`} className="rounded-2xl border border-white/8 bg-slate-950/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{signal.rule_key}</div>
                  <div className={`text-xs font-medium ${severityClass(signal.severity)}`}>{signal.severity}</div>
                </div>
                <div className="mt-2 text-sm leading-7 text-slate-300">{signal.recommended_action}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <MiniStat label="状态" value={signal.state} />
                  <MiniStat label="数值" value={String(signal.value)} />
                  <MiniStat label="阈值" value={String(signal.threshold)} />
                  <MiniStat label="家族" value={signal.family} />
                </div>
              </div>
            ))}
            {(kernelQuery.data?.signals ?? []).length === 0 && (
              <EmptyNotice text="当前没有治理链告警，说明最近一段时间的 risk family 没有触发阈值。" />
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function EmptyNotice({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
      {text}
    </div>
  );
}
