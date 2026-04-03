'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import {
  decideHitl,
  fetchCommercialReadiness,
  fetchHitlPending,
} from '@/services/endpoints/ai-subservice';
import { getCurrentUser } from '@/services/endpoints/user';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

function toneClass(tone: 'ok' | 'warn' | 'hot'): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    case 'warn':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    case 'hot':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
    default:
      return 'border-white/10 bg-slate-900/30 text-slate-200';
  }
}

type MobileCard = {
  title: string;
  value: string;
  desc: string;
  tone: 'ok' | 'warn' | 'hot';
};

function readinessStatusLabel(score?: number, blockers?: number): string {
  if ((blockers ?? 0) > 0) return '存在阻塞';
  if ((score ?? 0) > 0) return '可推进';
  return '待确认';
}

export default function ClientMobilePage() {
  const [busyApprovalId, setBusyApprovalId] = useState('');
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [approvalIdFilter, setApprovalIdFilter] = useState('');

  const currentUserQuery = useQuery({
    queryKey: ['client-mobile', 'current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const readinessQuery = useQuery({
    queryKey: ['client-mobile', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });
  const approvalsQuery = useQuery({
    queryKey: ['client-mobile', 'hitl-pending'],
    queryFn: () => fetchHitlPending(20),
    retry: false,
    refetchInterval: 10_000,
  });

  const pendingItems = useMemo(() => approvalsQuery.data?.items ?? [], [approvalsQuery.data?.items]);
  const readiness = readinessQuery.data?.readiness;
  const currentUser = currentUserQuery.data;
  const filteredPendingItems = useMemo(
    () =>
      approvalIdFilter
        ? pendingItems.filter((item) => String(item.approval_id ?? '').trim() === approvalIdFilter)
        : pendingItems,
    [approvalIdFilter, pendingItems],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = new URLSearchParams(window.location.search).get('approval_id') ?? '';
    setApprovalIdFilter(next.trim());
  }, []);

  const cards = useMemo<MobileCard[]>(
    () => [
      {
        title: '待审批动作',
        value: String(filteredPendingItems.length),
        desc: '高风险动作默认进入 HITL',
        tone: filteredPendingItems.length > 0 ? 'warn' : 'ok',
      },
      {
        title: '上线就绪度',
        value: String(readiness?.score ?? 0),
        desc: `${readinessStatusLabel(readiness?.score, readiness?.blocker_count)} · ${readiness?.blocker_count ?? 0} 个阻塞项`,
        tone: Number(readiness?.blocker_count ?? 0) > 0 ? 'warn' : 'ok',
      },
      {
        title: '审批权限',
        value: currentUser?.isAdmin ? '管理员' : '只读',
        desc: currentUser?.tenantName || currentUser?.tenantId || '未识别租户',
        tone: currentUser?.isAdmin ? 'ok' : 'hot',
      },
    ],
    [currentUser?.isAdmin, currentUser?.tenantId, currentUser?.tenantName, filteredPendingItems.length, readiness?.blocker_count, readiness?.score],
  );

  async function handleDecision(approvalId: string, decision: 'approved' | 'rejected') {
    setBusyApprovalId(approvalId);
    try {
      const result = await decideHitl({
        approval_id: approvalId,
        decision,
        operator: currentUser?.name || currentUser?.id || 'mobile_operator',
        reason: reasonById[approvalId]?.trim() || `${decision} from mobile console`,
      });
      triggerSuccessToast(`审批已${decision === 'approved' ? '通过' : '拒绝'}：${String(result.approval_id)}`);
      await approvalsQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '审批动作失败');
    } finally {
      setBusyApprovalId('');
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4 py-2">
      <header className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-cyan-300" />
          <h1 className="text-lg font-semibold text-white">移动审批环</h1>
        </div>
        <p className="mt-1 text-xs text-slate-300">
          飞书和钉钉可以接收推送，这一页则作为移动端兜底入口，保证审批人在任何时候都能处理高风险动作。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.title} className={`rounded-xl border p-3 ${toneClass(card.tone)}`}>
            <div className="text-[11px] opacity-80">{card.title}</div>
            <div className="mt-1 text-lg font-bold">{card.value}</div>
            <div className="mt-1 text-[11px] opacity-80">{card.desc}</div>
          </article>
        ))}
      </div>

      <article className="rounded-2xl border border-white/10 bg-slate-900/55 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">待处理 HITL 审批</h2>
          <button
            type="button"
            onClick={() => void approvalsQuery.refetch()}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        </div>

        {approvalIdFilter ? (
          <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            深链筛选已启用：当前只展示审批单 <span className="font-semibold">{approvalIdFilter}</span>
          </div>
        ) : null}

        {!currentUser?.isAdmin ? (
          <div className="mt-3 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-3 text-xs text-rose-100">
            只有管理员可以通过或拒绝高风险动作。
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          {filteredPendingItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400">
              {approvalIdFilter ? '没有找到匹配的审批单。' : '当前没有待审批动作。'}
            </div>
          ) : (
            filteredPendingItems.map((item) => {
              const approvalId = String(item.approval_id ?? '');
              const scope = (item.scope as Record<string, unknown> | undefined) ?? {};
              return (
                <div key={approvalId} className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>{approvalId}</span>
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">
                      {String(scope.risk_level ?? 'P?')}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-white">
                    {String(scope.task_description ?? item.task_description ?? '审批任务')}
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    评分 {String(scope.score ?? '-')} · 线索数 {String(scope.lead_count ?? '-')} · 状态 {String(item.status ?? 'pending')}
                  </div>
                  {scope.trace_id ? (
                    <Link
                      href={`/operations/autopilot/trace?traceId=${encodeURIComponent(String(scope.trace_id))}`}
                      className="mt-2 inline-flex rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200"
                    >
                      打开 Trace
                    </Link>
                  ) : null}
                  <textarea
                    rows={2}
                    value={reasonById[approvalId] ?? ''}
                    onChange={(event) =>
                      setReasonById((prev) => ({ ...prev, [approvalId]: event.target.value }))
                    }
                    placeholder="可选：填写审批原因"
                    className="mt-3 w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-400"
                    disabled={!currentUser?.isAdmin}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={!currentUser?.isAdmin || busyApprovalId === approvalId}
                      onClick={() => void handleDecision(approvalId, 'approved')}
                      className="flex-1 rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2 py-1.5 text-xs text-emerald-200 disabled:opacity-50"
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      通过
                    </button>
                    <button
                      type="button"
                      disabled={!currentUser?.isAdmin || busyApprovalId === approvalId}
                      onClick={() => void handleDecision(approvalId, 'rejected')}
                      className="flex-1 rounded-md border border-rose-400/40 bg-rose-500/20 px-2 py-1.5 text-xs text-rose-200 disabled:opacity-50"
                    >
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                      拒绝
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </article>

      <article className="rounded-2xl border border-white/10 bg-slate-900/55 p-4">
        <h2 className="text-sm font-semibold text-white">移动端说明</h2>
        <ul className="mt-3 space-y-2 text-xs text-slate-300">
          <li>1. 审批请求和审批结果现在都可以扇出到 Telegram、Feishu 和 DingTalk。</li>
          <li>2. 当 Bot callback 或卡片交互还没有完全切真时，这一页就是移动端兜底入口。</li>
          <li>3. 高风险动作仍然是 HITL-first，策略脑不会被下放到客户端。</li>
        </ul>
      </article>
    </section>
  );
}
