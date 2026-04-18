'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useLeads } from '@/hooks/queries/useLeads';
import { useRevealLead } from '@/hooks/mutations/useRevealLead';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import type { LeadListItem } from '@/services/endpoints/lead';
import { MainlineStageHeader } from './MainlineStageHeader';

type DetailState = {
  open: boolean;
  lead: LeadListItem | null;
};

function intentLevel(score: number): 'high' | 'mid' | 'low' {
  if (score >= 90) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

function IntentBadge({ score }: { score: number }) {
  const level = intentLevel(score);
  if (level === 'high') {
    return <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-xs text-rose-300">高意向 {score}</span>;
  }
  if (level === 'mid') {
    return <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300">中意向 {score}</span>;
  }
  return <span className="rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-xs text-slate-300">低意向 {score}</span>;
}

export function LeadsWorkspace() {
  const [page, setPage] = useState(1);
  const [intentMin, setIntentMin] = useState<number | undefined>(80);
  const [detail, setDetail] = useState<DetailState>({ open: false, lead: null });
  const { data, isLoading, isError } = useLeads(page, intentMin);
  const reveal = useRevealLead();

  const rows = useMemo(() => data?.list ?? [], [data?.list]);
  const stats = useMemo(() => {
    const total = data?.total ?? 0;
    const high = rows.filter((item) => item.intent_score >= 90).length;
    const mid = rows.filter((item) => item.intent_score >= 60 && item.intent_score < 90).length;
    const success = rows.filter((item) => item.webhook_status === 'SUCCESS').length;
    return {
      total,
      high,
      mid,
      webhookRate: rows.length > 0 ? `${Math.round((success / rows.length) * 100)}%` : '0%',
    };
  }, [data?.total, rows]);

  const header = (
    <MainlineStageHeader
      currentKey="leads"
      step="主线第 4 步 · 线索"
      title="把结果集中收拢，再决定谁该跟进"
      description="线索页只回答一个问题：今天收到的线索里，哪些值得优先跟进，哪些应该回看任务链继续优化。"
      previous={{ href: '/campaigns', label: '回到任务列表' }}
      next={{ href: '/operations/autopilot/trace', label: '前往 Trace 复盘' }}
      actions={
        <>
          <Link href="/campaigns" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]">
            查看任务
          </Link>
          <Link href="/client-center" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15">
            打开客户工作台
          </Link>
        </>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <SkeletonTable rows={8} cols={7} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">加载线索失败。</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="总线索" value={String(stats.total)} helper="当前筛选范围内全部线索" icon={<Users className="h-4 w-4" />} />
        <SummaryCard label="高意向" value={String(stats.high)} helper="优先安排销售或人工回访" icon={<CheckCircle2 className="h-4 w-4" />} accent="text-rose-300" />
        <SummaryCard label="中意向" value={String(stats.mid)} helper="适合继续培育和内容触达" icon={<ShieldCheck className="h-4 w-4" />} accent="text-amber-300" />
        <SummaryCard label="Webhook 成功率" value={stats.webhookRate} helper="线索回流是否顺畅" icon={<Wallet className="h-4 w-4" />} accent="text-emerald-300" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="text-lg font-semibold text-white">今日线索判断</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DecisionCard title="优先跟进" value={String(stats.high)} helper="高意向线索优先进入人工或销售跟进。" />
            <DecisionCard title="继续培育" value={String(stats.mid)} helper="中意向线索适合继续内容触达和节奏培养。" />
            <DecisionCard title="回看任务链" value={stats.total > 0 ? '建议同步' : '等待数据'} helper="如果质量不稳，就回到任务或 Trace 继续压策略。" />
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="text-lg font-semibold text-white">当前筛选</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoPanel label="最低意向分" value={intentMin ? String(intentMin) : '全部'} />
            <InfoPanel label="当前页码" value={`第 ${page} 页`} />
            <InfoPanel label="下一步" value="跟进线索 / 去 Trace" />
            <InfoPanel label="主路径" value="任务 → 线索 → 复盘" />
          </div>
        </article>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-white">当前线索池</div>
            <div className="mt-1 text-sm text-slate-400">先筛出今天最值得处理的一批，再决定跟进顺序。</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">最低意向分</span>
            <select
              className="rounded-2xl border border-slate-600 bg-slate-900/70 px-3 py-2 text-slate-100"
              value={intentMin ?? ''}
              onChange={(e) => setIntentMin(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">全部</option>
              <option value="90">90+</option>
              <option value="80">80+</option>
              <option value="60">60+</option>
            </select>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
          <table data-testid="leads-table" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-black/20 text-slate-400">
                <th className="px-4 py-3">线索 ID</th>
                <th className="px-4 py-3">来源平台</th>
                <th className="px-4 py-3">意向</th>
                <th className="px-4 py-3">联系方式</th>
                <th className="px-4 py-3">采集时间</th>
                <th className="px-4 py-3">回流状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lead_id} className="border-b border-slate-800/70 text-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{row.lead_id}</td>
                  <td className="px-4 py-3">{row.source_platform}</td>
                  <td className="px-4 py-3">
                    <IntentBadge score={row.intent_score} />
                  </td>
                  <td className="px-4 py-3 text-slate-300">{row.contact_info}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{new Date(row.captured_at).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{row.webhook_status}</td>
                  <td className="px-4 py-3">
                    <Button data-testid={`lead-detail-${row.lead_id}`} variant="ghost" onClick={() => setDetail({ open: true, lead: row })}>
                      查看详情
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex justify-between text-sm text-slate-400">
        <span>第 {page} 页</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      </section>

      {detail.open && detail.lead && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div data-testid="lead-detail-sheet" className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">线索详情</h3>
              <button
                type="button"
                onClick={() => setDetail({ open: false, lead: null })}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                关闭
              </button>
            </div>

            <div className="space-y-2 text-sm text-slate-200">
              <p><span className="text-slate-400">线索 ID：</span>{detail.lead.lead_id}</p>
              <p><span className="text-slate-400">平台：</span>{detail.lead.source_platform}</p>
              <p><span className="text-slate-400">意向：</span>{detail.lead.intent_score}</p>
              <p><span className="text-slate-400">留言：</span>{detail.lead.user_message || '（空）'}</p>
              <p><span className="text-slate-400">原始联系方式：</span>{detail.lead.contact_info}</p>
            </div>

            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
              {!reveal.data ? (
                <Button data-testid="lead-reveal-button" onClick={() => detail.lead && reveal.mutate(detail.lead.lead_id)} disabled={reveal.isPending}>
                  {reveal.isPending ? '解密中...' : '解密联系方式（审计留痕）'}
                </Button>
              ) : (
                <p>
                  <span className="text-slate-400">解密结果：</span>
                  <span className="ml-2 font-mono text-emerald-300">{reveal.data.contact_info}</span>
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/client-center" className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm text-white">
                去客户工作台
              </Link>
              <Link href="/operations/autopilot/trace" className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100">
                去 Trace 复盘
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  icon,
  accent = 'text-white',
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-3 text-3xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

function DecisionCard({ title, value, helper }: { title: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-cyan-100">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{helper}</div>
    </div>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
