'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, ScanSearch, Sparkles, XCircle } from 'lucide-react';
import {
  SurfaceHero,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import {
  applySkillImprovementProposal,
  createSkillImprovementProposal,
  decideSkillImprovementProposal,
  fetchSkillImprovementEffects,
  fetchSkillImprovementOverview,
  fetchSkillImprovementSignals,
  fetchSkillImprovementProposals,
  rollbackSkillImprovementProposal,
  scanSkillImprovementProposal,
  triggerSkillImprovementProposal,
} from '@/services/endpoints/skill-improvements';
import type { SkillImprovementCreatePayload, SkillImprovementProposal } from '@/types/skill-improvements';

const STATUS_OPTIONS = ['', 'draft', 'scanned', 'review', 'approved', 'rejected', 'applied', 'rolled_back'];

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function proposalTone(status?: string): string {
  if (status === 'approved') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
  if (status === 'rolled_back') return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
  if (status === 'rejected') return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
  if (status === 'scanned' || status === 'review') return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
  return 'border-white/10 bg-white/[0.04] text-slate-200';
}

function recommendationTone(action?: string): string {
  if (action === 'recommend_rollback') return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
  if (action === 'keep_applied') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
  return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
}

function recommendationLabel(action?: string): string {
  if (action === 'recommend_rollback') return 'Recommend rollback';
  if (action === 'keep_applied') return 'Keep applied';
  return 'Continue observing';
}

export default function SkillImprovementsPage() {
  const queryClient = useQueryClient();
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<SkillImprovementCreatePayload>({
    tenant_id: tenantId,
    lobster_id: 'inkwriter',
    skill_id: 'inkwriter_copy_generate',
    trigger_type: 'repeated_human_revision',
    evidence_refs: [
      {
        source_type: 'manual',
        source_id: 'demo-evidence',
        summary: 'Operator repeatedly revised overpromising copy; propose tightening gotchas and manifest metadata.',
        confidence: 0.7,
      },
    ],
  });
  const [decisionReason, setDecisionReason] = useState('');
  const [triggerNotice, setTriggerNotice] = useState('');

  const proposalsQuery = useQuery({
    queryKey: ['skill-improvements', tenantId, status],
    queryFn: () => fetchSkillImprovementProposals({ tenant_id: tenantId, status: status || undefined, limit: 100 }),
    retry: false,
  });
  const overviewQuery = useQuery({
    queryKey: ['skill-improvement-overview', tenantId],
    queryFn: () => fetchSkillImprovementOverview({ tenant_id: tenantId }),
    retry: false,
  });
  const signalsQuery = useQuery({
    queryKey: ['skill-improvement-signals', tenantId],
    queryFn: () => fetchSkillImprovementSignals({ tenant_id: tenantId, limit: 20 }),
    retry: false,
  });
  const effectsQuery = useQuery({
    queryKey: ['skill-improvement-effects', tenantId, selectedId],
    queryFn: () => fetchSkillImprovementEffects({
      tenant_id: tenantId,
      proposal_id: selectedId || undefined,
      limit: 40,
    }),
    retry: false,
  });

  const proposals = useMemo<SkillImprovementProposal[]>(
    () => proposalsQuery.data?.items ?? [],
    [proposalsQuery.data?.items],
  );
  const signals = signalsQuery.data?.items ?? [];
  const effectEvents = effectsQuery.data?.items ?? [];
  const effectSummary = effectsQuery.data?.summary;
  const overview = overviewQuery.data;
  const selected = useMemo(
    () => proposals.find((item) => item.proposal_id === selectedId) ?? proposals[0] ?? null,
    [proposals, selectedId],
  );

  const createMutation = useMutation({
    mutationFn: async () => createSkillImprovementProposal({ ...draft, tenant_id: tenantId }),
    onSuccess: async (result) => {
      setSelectedId(result.proposal.proposal_id);
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async () => triggerSkillImprovementProposal({
      tenant_id: tenantId,
      lobster_id: draft.lobster_id,
      skill_id: draft.skill_id,
      signal_type: draft.trigger_type,
      source_id: draft.evidence_refs?.[0]?.source_id || `manual-signal-${Date.now()}`,
      summary: draft.evidence_refs?.[0]?.summary || 'Manual signal crossed the improvement trigger threshold.',
      confidence: draft.evidence_refs?.[0]?.confidence ?? 0.82,
      auto_scan: true,
    }),
    onSuccess: async (result) => {
      if (result.proposal) setSelectedId(result.proposal.proposal_id);
      setTriggerNotice(result.created ? '触发信号已生成，并自动扫描出一条提案。' : `触发被跳过：${result.reason}`);
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-improvement-signals'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-improvement-effects'] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (proposalId: string) => scanSkillImprovementProposal(proposalId),
    onSuccess: async (result) => {
      setSelectedId(result.proposal.proposal_id);
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
    },
  });

  const decideMutation = useMutation({
    mutationFn: async (input: { proposalId: string; decision: 'approved' | 'rejected' | 'review' }) =>
      decideSkillImprovementProposal(input.proposalId, {
        decision: input.decision,
        reason: decisionReason.trim() || undefined,
      }),
    onSuccess: async (result) => {
      setSelectedId(result.proposal.proposal_id);
      setDecisionReason('');
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (proposalId: string) =>
      applySkillImprovementProposal(proposalId, {
        reason: decisionReason.trim() || 'operator approved apply',
      }),
    onSuccess: async (result) => {
      setSelectedId(result.proposal.proposal_id);
      setDecisionReason('');
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-improvement-signals'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-improvement-effects'] });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (proposalId: string) =>
      rollbackSkillImprovementProposal(proposalId, {
        reason: decisionReason.trim() || 'operator requested rollback',
      }),
    onSuccess: async (result) => {
      setSelectedId(result.proposal.proposal_id);
      setDecisionReason('');
      await queryClient.invalidateQueries({ queryKey: ['skill-improvements'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-improvement-signals'] });
    },
  });

  const counts = useMemo(() => ({
    total: proposals.length,
    draft: proposals.filter((item) => item.status === 'draft').length,
    scanned: proposals.filter((item) => item.status === 'scanned').length,
    approved: proposals.filter((item) => item.status === 'approved').length,
  }), [proposals]);

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="安全学习闭环"
        title="技能改进提案先进入审批队列，不能直接改线上 Skill"
        description="这页展示 OpenClaw 的自学习收口方式：系统可以基于证据生成技能补丁草案，扫描风险，等待管理员或 Commander 审批，然后才允许应用。应用后也要持续观察效果，并保留回滚入口。"
        actions={
          <button
            type="button"
            onClick={() => void proposalsQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white"
          >
            <RefreshCw className={`h-4 w-4 ${proposalsQuery.isFetching ? 'animate-spin' : ''}`} />
            刷新提案
          </button>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <SurfaceMetric label="提案总数" value={String(counts.total)} helper="当前筛选条件下的改进提案" icon={<Sparkles className="h-4 w-4" />} />
        <SurfaceMetric label="草稿" value={String(counts.draft)} helper="已生成但尚未扫描" />
        <SurfaceMetric label="已扫描" value={String(counts.scanned)} helper="扫描器已经产出报告" />
        <SurfaceMetric label="已批准" value={String(counts.approved)} helper="具备进入应用流程的资格" />
      </section>

      <SurfaceSection
        title="Commercial closure overview"
        description="One contract for QA and operators: memory base, trigger volume, proposal gate, apply/rollback state, and post-apply recommendations."
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Mini label="Readiness" value={overview?.summary.readiness_status || 'loading'} />
          <Mini label="Signals / Proposals" value={`${overview?.summary.signal_total ?? 0} / ${overview?.summary.proposal_total ?? 0}`} />
          <Mini label="Apply / Rollback" value={`${overview?.summary.applied ?? 0} / ${overview?.summary.rolled_back ?? 0}`} />
          <Mini label="Resident / History" value={`${overview?.dual_track_memory.resident_count ?? 0} / ${overview?.dual_track_memory.history_count ?? 0}`} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <OverviewCard
            title="Review gate"
            value={`${overview?.summary.pending_review ?? 0} pending · ${overview?.summary.ready_to_apply ?? 0} approved`}
            detail={`scan: ${formatCounts(overview?.scan_status_counts)}`}
            tone={(overview?.summary.pending_review || overview?.summary.ready_to_apply) ? 'amber' : 'emerald'}
          />
          <OverviewCard
            title="Effect recommendation"
            value={`${overview?.summary.recommend_rollback ?? 0} rollback review`}
            detail={`recommendations: ${formatCounts(overview?.recommendation_counts)}`}
            tone={overview?.summary.recommend_rollback ? 'rose' : 'emerald'}
          />
          <OverviewCard
            title="Signal health"
            value={formatCounts(overview?.signal_reason_counts) || 'no signals'}
            detail={`effects ${overview?.summary.effect_event_total ?? 0}`}
            tone="cyan"
          />
        </div>
      </SurfaceSection>

      <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <SurfaceSection title="创建改进提案" description="当前支持人工触发，同时 payload 已按后续自动触发的结构组织。">
          <div className="space-y-3">
            <Field label="主管角色" value={draft.lobster_id} onChange={(value) => setDraft((prev) => ({ ...prev, lobster_id: value }))} />
            <Field label="技能 ID" value={draft.skill_id} onChange={(value) => setDraft((prev) => ({ ...prev, skill_id: value }))} />
            <Field label="触发原因" value={draft.trigger_type} onChange={(value) => setDraft((prev) => ({ ...prev, trigger_type: value }))} />
            <label className="block text-sm text-slate-300">
              证据摘要
              <textarea
                value={draft.evidence_refs?.[0]?.summary ?? ''}
                onChange={(event) => {
                  const summary = event.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    evidence_refs: [{
                      source_type: prev.evidence_refs?.[0]?.source_type || 'manual',
                      source_id: prev.evidence_refs?.[0]?.source_id || 'manual',
                      summary,
                      confidence: prev.evidence_refs?.[0]?.confidence ?? 0.7,
                    }],
                  }));
                }}
                rows={5}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-60"
            >
              {createMutation.isPending ? '创建中...' : '创建提案'}
            </button>
            <button
              type="button"
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
              className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-100 disabled:opacity-60"
            >
              {triggerMutation.isPending ? '触发中...' : '模拟自动触发'}
            </button>
            {triggerNotice ? (
              <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-3 text-sm text-cyan-100">
                {triggerNotice}
              </div>
            ) : null}
            {createMutation.isError ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                创建失败。
              </div>
            ) : null}
            {triggerMutation.isError ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                触发失败。
              </div>
            ) : null}
          </div>
        </SurfaceSection>

        <SurfaceSection
          title="提案队列"
          description="这里的每一条都是建议，不是线上 Skill 变更。扫描、审批、应用和回滚都必须显式发生。"
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
            >
              {STATUS_OPTIONS.map((item) => (
                <option key={item || 'all'} value={item}>{item || 'all'}</option>
              ))}
            </select>
          </div>

          {proposalsQuery.isLoading ? (
            <SurfaceStateCard kind="loading" title="正在读取提案" description="从控制面读取技能改进提案。" />
          ) : proposals.length === 0 ? (
            <SurfaceStateCard kind="empty" title="暂无提案" description="可以手动创建一条，后续再接入自动触发。" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
              <div className="space-y-3">
                {proposals.map((item) => (
                  <button
                    key={item.proposal_id}
                    type="button"
                    onClick={() => setSelectedId(item.proposal_id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${selected?.proposal_id === item.proposal_id ? 'border-cyan-400/45 bg-cyan-400/10' : 'border-white/10 bg-slate-950/35 hover:bg-white/[0.03]'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-xs text-slate-400">{item.proposal_id}</div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${proposalTone(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-white">{item.skill_id}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.lobster_id} / {item.trigger_type}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatTime(item.updated_at)}</div>
                  </button>
                ))}
              </div>
              <ProposalDetail
                proposal={selected}
                decisionReason={decisionReason}
                setDecisionReason={setDecisionReason}
                onScan={(id) => scanMutation.mutate(id)}
                onDecision={(proposalId, decision) => decideMutation.mutate({ proposalId, decision })}
                onApply={(proposalId) => applyMutation.mutate(proposalId)}
                onRollback={(proposalId) => rollbackMutation.mutate(proposalId)}
                busy={scanMutation.isPending || decideMutation.isPending || applyMutation.isPending || rollbackMutation.isPending}
              />
            </div>
          )}
        </SurfaceSection>
      </section>

      <SurfaceSection
        title="应用后的效果追踪"
        description="提案应用后，运行质量、人工反馈和边缘遥测会继续挂回当前提案，避免只改不验。"
      >
        <div className={`mb-4 rounded-2xl border p-4 ${recommendationTone(effectSummary?.recommendation?.action)}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{recommendationLabel(effectSummary?.recommendation?.action)}</div>
              <div className="mt-1 text-xs opacity-80">
                {effectSummary?.recommendation?.reason || '暂无效果建议。先应用提案并收集观测数据。'}
              </div>
            </div>
            <div className="rounded-full border border-current/20 px-3 py-1 text-xs">
              优先级 {effectSummary?.recommendation?.priority || 'low'}
            </div>
          </div>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Mini label="事件数" value={String(effectSummary?.event_count ?? 0)} />
          <Mini label="观察数" value={String(effectSummary?.observation_count ?? 0)} />
          <Mini label="平均变化" value={effectSummary?.avg_delta == null ? '-' : effectSummary.avg_delta.toFixed(3)} />
          <Mini label="正向 / 负向" value={`${effectSummary?.positive_observations ?? 0} / ${effectSummary?.negative_observations ?? 0}`} />
        </div>
        {effectEvents.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {effectEvents.map((item) => (
              <div key={item.event_id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-500">{item.event_id}</div>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100">{item.event_type}</span>
                </div>
                <div className="mt-3 text-sm font-semibold text-white">{item.metric_name || item.source_type || 'lifecycle'}</div>
                <div className="mt-1 text-xs text-slate-400">{item.lobster_id} / {item.skill_id}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{item.summary || item.source_id}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>value {item.metric_value == null ? '-' : item.metric_value.toFixed(3)}</span>
                  <span>baseline {item.baseline_value == null ? '-' : item.baseline_value.toFixed(3)}</span>
                  <span>delta {item.delta == null ? '-' : item.delta.toFixed(3)}</span>
                  <span>source {item.source_type}:{item.source_id || '-'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <SurfaceStateCard kind="empty" title="暂无效果事件" description="应用提案后，再跑任务或接收反馈 / 边缘遥测，才会开始衡量改动效果。" />
        )}
      </SurfaceSection>

      <SurfaceSection
        title="自动触发信号"
        description="运行失败、人工反复修改、低质量评分和边缘重试激增都会沉淀为信号；即便被阈值或去重跳过，也要留下原因。"
      >
        {signals.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {signals.map((item) => (
              <div key={item.event_id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-500">{item.event_id}</div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${item.created ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'}`}>
                    {item.created ? 'created' : item.reason || 'skipped'}
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold text-white">{item.signal_type}</div>
                <div className="mt-1 text-xs text-slate-400">{item.lobster_id} / {item.skill_id || '-'}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{item.summary || item.source_id}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>confidence {(item.confidence * 100).toFixed(0)}%</span>
                  <span>source {item.source_id || '-'}</span>
                  <span>proposal {item.proposal_id || '-'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <SurfaceStateCard kind="empty" title="暂无触发信号" description="当运行失败、人工修订、质量低分或边缘重试峰值被路由后，会出现在这里。" />
        )}
      </SurfaceSection>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function ProposalDetail({
  proposal,
  decisionReason,
  setDecisionReason,
  onScan,
  onDecision,
  onApply,
  onRollback,
  busy,
}: {
  proposal: SkillImprovementProposal | null;
  decisionReason: string;
  setDecisionReason: (value: string) => void;
  onScan: (proposalId: string) => void;
  onDecision: (proposalId: string, decision: 'approved' | 'rejected' | 'review') => void;
  onApply: (proposalId: string) => void;
  onRollback: (proposalId: string) => void;
  busy: boolean;
}) {
  if (!proposal) {
    return <SurfaceStateCard kind="empty" title="未选择提案" description="选择一条提案后，可以查看证据、补丁草案和扫描报告。" />;
  }

  const patch = proposal.patches[0];
  const issues = proposal.scan_report?.issues ?? [];
  const diffRows = patch ? buildPatchDiffRows(patch.before, patch.after) : [];

  return (
    <div className="space-y-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-slate-500">{proposal.proposal_id}</div>
          <div className="mt-2 text-xl font-semibold text-white">{proposal.skill_id}</div>
          <div className="mt-1 text-sm text-slate-400">{proposal.lobster_id} / {proposal.trigger_type}</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${proposalTone(proposal.status)}`}>{proposal.status}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Mini label="扫描状态" value={proposal.scan_status || 'not_scanned'} />
        <Mini label="补丁数" value={String(proposal.patches.length)} />
        <Mini label="证据数" value={String(proposal.evidence_refs.length)} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold text-white">证据</div>
        <div className="mt-3 space-y-2">
          {proposal.evidence_refs.map((item) => (
            <div key={`${item.source_type}:${item.source_id}:${item.summary}`} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
              <div className="text-xs text-slate-500">{item.source_type} / {item.source_id || '-'}</div>
              <div className="mt-1">{item.summary}</div>
            </div>
          ))}
        </div>
      </div>

      {patch ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-white">补丁草案</div>
          <div className="mt-2 text-xs text-slate-400">{patch.target_file}</div>
          <div className="mt-3 text-sm text-slate-300">{patch.summary}</div>
          {diffRows.length ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
              <div className="grid grid-cols-[0.8fr_1fr_1fr] bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
                <div>字段</div>
                <div>修改前</div>
                <div>修改后</div>
              </div>
              {diffRows.slice(0, 8).map((row) => (
                <div key={row.key} className="grid grid-cols-[0.8fr_1fr_1fr] gap-2 border-t border-white/8 px-3 py-2 text-xs">
                  <div className="font-mono text-cyan-200">{row.key}</div>
                  <div className="break-all text-slate-400">{row.before}</div>
                  <div className="break-all text-emerald-200">{row.after}</div>
                </div>
              ))}
            </div>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-cyan-100">查看修改后的 payload</summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/8 bg-slate-950/70 p-3 text-xs text-slate-300">
              {JSON.stringify(patch.after, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold text-white">扫描报告</div>
        {issues.length ? (
          <div className="mt-3 space-y-2">
            {issues.map((issue) => (
              <div key={issue} className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{issue}</div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-400">暂无扫描问题。</div>
        )}
      </div>

      <textarea
        value={decisionReason}
        onChange={(event) => setDecisionReason(event.target.value)}
        rows={3}
        placeholder="可选：审批 / 应用 / 回滚理由"
        className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onScan(proposal.proposal_id)}
          className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 disabled:opacity-60"
        >
          <ScanSearch className="h-4 w-4" />
          扫描
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(proposal.proposal_id, 'approved')}
          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          批准
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(proposal.proposal_id, 'rejected')}
          className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 disabled:opacity-60"
        >
          <XCircle className="h-4 w-4" />
          拒绝
        </button>
        <button
          type="button"
          disabled={busy || proposal.status !== 'approved'}
          onClick={() => onApply(proposal.proposal_id)}
          className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-2 text-sm text-fuchsia-100 disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          应用已批准补丁
        </button>
        <button
          type="button"
          disabled={busy || proposal.status !== 'applied'}
          onClick={() => onRollback(proposal.proposal_id)}
          className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          回滚已应用补丁
        </button>
      </div>
    </div>
  );
}

function buildPatchDiffRows(before: unknown, after: unknown): Array<{ key: string; before: string; after: string }> {
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      key,
      before: stringifyPatchValue(before[key]),
      after: stringifyPatchValue(after[key]),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringifyPatchValue(value: unknown): string {
  if (value === undefined) return '-';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '""';
  return JSON.stringify(value);
}

function formatCounts(counts?: Record<string, number>): string {
  const entries = Object.entries(counts || {}).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return '';
  return entries.map(([key, value]) => `${key}:${value}`).join(' · ');
}

function OverviewCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'emerald' | 'amber' | 'rose' | 'cyan';
}) {
  const toneClass = {
    emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-500/10 text-rose-100',
    cyan: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100',
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.16em] opacity-70">{title}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      <div className="mt-2 text-xs opacity-80">{detail || '-'}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
