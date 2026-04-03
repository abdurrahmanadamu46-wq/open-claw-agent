'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Clock3, GitBranch, ShieldCheck, TrendingUp } from 'lucide-react';
import { fetchLeadConversionHistory, fetchLeadConversionStatus } from '@/services/endpoints/ai-subservice';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

const FUNNEL_STEPS = ['unknown', 'aware', 'interested', 'considering', 'decided', 'converted', 'lost'] as const;

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusTone(status: string): string {
  switch (status) {
    case 'converted':
      return 'bg-emerald-500/15 text-emerald-200';
    case 'decided':
      return 'bg-cyan-500/10 text-cyan-100';
    case 'considering':
      return 'bg-amber-500/15 text-amber-200';
    case 'interested':
      return 'bg-violet-500/15 text-violet-200';
    case 'aware':
      return 'bg-slate-700 text-slate-300';
    case 'lost':
      return 'bg-rose-500/15 text-rose-200';
    default:
      return 'bg-slate-700 text-slate-300';
  }
}

function confidenceLabel(value?: number) {
  const score = Math.round((value || 0) * 100);
  if (score >= 85) return `高 (${score}%)`;
  if (score >= 60) return `中 (${score}%)`;
  return `低 (${score}%)`;
}

export default function CrmLeadConversionPage() {
  const [tenantId, setTenantId] = useState('tenant_main');
  const [leadIdInput, setLeadIdInput] = useState('');
  const [activeLeadId, setActiveLeadId] = useState('');

  const statusQuery = useQuery({
    queryKey: ['crm-lead-conversion', tenantId, activeLeadId, 'status'],
    queryFn: () => fetchLeadConversionStatus(tenantId.trim(), activeLeadId.trim()),
    enabled: Boolean(tenantId.trim() && activeLeadId.trim()),
  });

  const historyQuery = useQuery({
    queryKey: ['crm-lead-conversion', tenantId, activeLeadId, 'history'],
    queryFn: () => fetchLeadConversionHistory(tenantId.trim(), activeLeadId.trim(), 20),
    enabled: Boolean(tenantId.trim() && activeLeadId.trim()),
  });

  const current = statusQuery.data?.data;
  const timeline = useMemo(() => historyQuery.data?.data ?? [], [historyQuery.data?.data]);
  const activeStepIndex = Math.max(0, FUNNEL_STEPS.indexOf((current?.status || 'unknown') as (typeof FUNNEL_STEPS)[number]));

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="leads"
        step="CRM · Lead Conversion"
        title="线索转化状态机"
        description="按单条 lead 查看当前转化状态、置信度和完整迁移历史，帮助运营和销售判断现在该继续推进、人工接手，还是回看前序链路。"
        previous={{ href: '/operations/leads', label: '回到线索总览' }}
        next={{ href: '/operations/autopilot/trace', label: '去 Trace 复盘' }}
        actions={
          <button
            type="button"
            onClick={() => {
              if (leadIdInput.trim()) setActiveLeadId(leadIdInput.trim());
            }}
            className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
          >
            查询线索
          </button>
        }
      />

      <section className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <input
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            placeholder="tenant_main"
          />
          <input
            value={leadIdInput}
            onChange={(event) => setLeadIdInput(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            placeholder="输入 lead_id 后查询 conversion 状态"
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="当前状态" value={current?.status || '-'} accent={statusTone(current?.status || '')} />
        <MetricCard label="置信度" value={current ? confidenceLabel(current.confidence) : '-'} />
        <MetricCard label="触发来源" value={current?.trigger || '-'} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard label="最后更新" value={formatDateTime(current?.updated_at)} icon={<Clock3 className="h-4 w-4" />} />
      </section>

      <section className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Funnel Progress</div>
        <div className="mt-4 grid gap-2 md:grid-cols-7">
          {FUNNEL_STEPS.map((step, index) => {
            const active = index === activeStepIndex;
            const completed = index < activeStepIndex && current?.status !== 'lost';
            return (
              <div
                key={step}
                className={`rounded-2xl border px-3 py-3 text-center text-sm ${
                  active
                    ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-100'
                    : completed
                      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-400'
                }`}
              >
                {step}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
            <ArrowRightLeft className="h-4 w-4" />
            当前状态详情
          </div>
          {statusQuery.isLoading ? (
            <EmptyState text="正在加载当前状态..." />
          ) : current ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-200">
              <Row label="Lead ID" value={current.lead_id} mono />
              <Row label="Tenant" value={current.tenant_id} />
              <Row label="Status" value={current.status} />
              <Row label="Trigger" value={current.trigger || '-'} />
              <Row label="Triggered By" value={current.triggered_by || '-'} />
              <Row label="Evidence" value={current.evidence || '-'} />
            </div>
          ) : (
            <EmptyState text={activeLeadId ? '当前线索没有 conversion 数据。' : '请输入 lead_id 后开始查询。'} />
          )}
        </div>

        <div className="rounded-[28px] border p-5" style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
            <GitBranch className="h-4 w-4" />
            状态迁移历史
          </div>
          {historyQuery.isLoading ? (
            <EmptyState text="正在加载迁移历史..." />
          ) : timeline.length > 0 ? (
            <div className="mt-4 space-y-3">
              {timeline.map((item, index) => (
                <div key={item.transition_id || `${item.lead_id}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs ${statusTone(item.to_status)}`}>{item.to_status}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(item.transitioned_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-white">
                    <GitBranch className="h-4 w-4 text-cyan-300" />
                    {item.from_status} → {item.to_status}
                  </div>
                  <div className="mt-2 text-sm text-slate-300">trigger: {item.trigger || '-'}</div>
                  <div className="mt-1 text-sm text-slate-300">confidence: {confidenceLabel(item.confidence)}</div>
                  {item.evidence ? <div className="mt-2 text-sm text-slate-400">{item.evidence}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text={activeLeadId ? '当前线索还没有历史迁移记录。' : '查询后这里会显示 conversion timeline。'} />
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
      <div className="text-slate-500">{label}</div>
      <div className={`${mono ? 'font-mono break-all' : ''} text-slate-100`}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}
