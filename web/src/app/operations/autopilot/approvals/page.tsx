'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
  decideApprovalGate,
  fetchApprovalGatePending,
  fetchApprovalGateStatus,
} from '@/services/endpoints/ai-subservice';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

const BORDER = 'rgba(71,85,105,0.4)';

export default function ApprovalGatePage() {
  const queryClient = useQueryClient();
  const [selectedApprovalId, setSelectedApprovalId] = useState('');
  const [decisionReason, setDecisionReason] = useState('');

  const pendingQuery = useQuery({
    queryKey: ['approval-gate', 'pending'],
    queryFn: () => fetchApprovalGatePending({ limit: 50 }),
    refetchInterval: 10000,
  });

  const statusQuery = useQuery({
    queryKey: ['approval-gate', 'status', selectedApprovalId],
    queryFn: () => fetchApprovalGateStatus(selectedApprovalId),
    enabled: selectedApprovalId.trim().length > 0,
    refetchInterval: 5000,
  });

  const decideMutation = useMutation({
    mutationFn: (payload: { approval_id: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      decideApprovalGate(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approval-gate', 'pending'] });
      await queryClient.invalidateQueries({ queryKey: ['approval-gate', 'status', selectedApprovalId] });
      setDecisionReason('');
    },
  });

  const pendingItems = pendingQuery.data?.items ?? [];
  const selectedApproval = statusQuery.data?.approval as Record<string, unknown> | undefined;
  const selectedResult = selectedApproval?.result as Record<string, unknown> | undefined;
  const selectedContext = selectedApproval?.context as Record<string, unknown> | undefined;
  const selectedTimeline = Array.isArray(selectedApproval?.timeline) ? (selectedApproval?.timeline as Array<Record<string, unknown>>) : [];
  const traceId = String(selectedApproval?.trace_id || '');

  const counts = useMemo(
    () => ({ pending: pendingItems.length, selected: selectedApprovalId ? 1 : 0 }),
    [pendingItems.length, selectedApprovalId],
  );

  async function decide(decision: 'approved' | 'rejected') {
    if (!selectedApprovalId) return;
    await decideMutation.mutateAsync({
      approval_id: selectedApprovalId,
      decision,
      reason: decisionReason.trim() || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="trace"
        step="主线第 5 步 · 审批"
        title="在这里做高风险动作的最终判断"
        description="审批中心不是单独工具页，而是线索和复盘之间的判断环节。先确认上下文，再决定批准还是拒绝。"
        previous={{ href: '/operations/leads', label: '回到线索池' }}
        next={{ href: '/operations/autopilot/trace', label: '前往 Trace 复盘' }}
        actions={
          <>
            <Link href="/operations/autopilot/artifacts" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]">
              打开 Artifact Center
            </Link>
            <Link href="/operations/autopilot/trace" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15">
              前往 Trace
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="待审批" value={counts.pending} />
        <MetricCard label="已选中" value={counts.selected} />
        <MetricCard label="刷新状态" value={pendingQuery.isFetching ? '同步中' : '正常'} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
            <ShieldCheck className="h-4 w-4" />
            待审批列表
          </div>
          <div className="space-y-2">
            {pendingItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">当前没有待审批项。</div>
            ) : (
              pendingItems.map((item) => {
                const approvalId = String(item.approval_id || '');
                const active = selectedApprovalId === approvalId;
                return (
                  <button
                    key={approvalId}
                    type="button"
                    onClick={() => setSelectedApprovalId(approvalId)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left ${active ? 'bg-amber-500/10' : 'bg-slate-950/45 hover:bg-white/5'}`}
                    style={{ borderColor: active ? 'rgba(229,169,61,0.6)' : BORDER }}
                  >
                    <div className="text-sm font-medium text-slate-100">{String(item.action_summary || approvalId)}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {approvalId} · 通道 {String(item.approval_channel || '-')} · 状态 {String(item.approval_state || '-')}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="mb-3 text-lg font-semibold text-white">审批详情</div>
          {!selectedApprovalId ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">请选择一条待审批记录。</div>
          ) : statusQuery.isLoading ? (
            <div className="rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">正在加载审批详情...</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
                <div>审批单号：{selectedApprovalId}</div>
                <div className="mt-1">状态：{String(selectedApproval?.approval_state || '-')}</div>
                <div className="mt-1">Agent：{String(selectedApproval?.agent_id || '-')}</div>
                <div className="mt-1">工具：{String(selectedApproval?.tool_id || '-')}</div>
                <div className="mt-1">风险等级：{String(selectedApproval?.risk_level || '-')}</div>
                <div className="mt-1">Trace：{traceId || '-'}</div>
                <div className="mt-1">请求号：{String(selectedApproval?.request_id || '-')}</div>
                <div className="mt-1">用户：{String(selectedApproval?.user_id || '-')}</div>
              </div>

              <label className="block text-xs text-slate-300">
                审批理由
                <textarea
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void decide('approved')}
                  disabled={decideMutation.isPending}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={() => void decide('rejected')}
                  disabled={decideMutation.isPending}
                  className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  拒绝
                </button>
              </div>

              {selectedTimeline.length > 0 && (
                <details className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs text-slate-300" open>
                  <summary className="cursor-pointer text-sm font-medium text-slate-100">审批时间线</summary>
                  <div className="mt-2 space-y-2">
                    {selectedTimeline.map((event, index) => (
                      <div key={`${String(event.ts || '')}-${index}`} className="rounded border border-slate-800 px-3 py-2">
                        <div>{String(event.event || '-')} · {String(event.actor || '-')}</div>
                        <div className="mt-1 text-slate-400">{String(event.ts || '-')}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {selectedResult && (
                <details className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs text-slate-300">
                  <summary className="cursor-pointer text-sm font-medium text-slate-100">结果载荷</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(selectedResult, null, 2)}</pre>
                </details>
              )}

              {selectedContext && (
                <details className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-xs text-slate-300">
                  <summary className="cursor-pointer text-sm font-medium text-slate-100">上下文载荷</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(selectedContext, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}
