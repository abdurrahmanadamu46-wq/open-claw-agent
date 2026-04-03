'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClipboardList, PauseCircle, PlayCircle, Users, Waypoints } from 'lucide-react';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { useCampaigns } from '@/hooks/queries/useCampaigns';
import { useTerminateCampaign } from '@/hooks/mutations/useTerminateCampaign';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { CampaignStatusBadge } from '@/components/business/CampaignStatusBadge';
import { Button } from '@/components/ui/Button';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

export default function CampaignsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useCampaigns(page, status);
  const terminate = useTerminateCampaign();

  const rows = useMemo(() => data?.list ?? [], [data?.list]);
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.campaign_id, row.industry_template_id, row.status].join(' ').toLowerCase().includes(keyword),
    );
  }, [rows, search]);
  const stats = useMemo(() => {
    const total = data?.total ?? 0;
    const running = rows.filter((row) => ['PUBLISHING', 'RUNNING'].includes(row.status)).length;
    const pending = rows.filter((row) => row.status === 'PENDING' || row.status === 'DRAFT').length;
    const leads = rows.reduce((sum, row) => sum + row.leads_collected, 0);
    return { total, running, pending, leads };
  }, [data?.total, rows]);

  const header = (
    <MainlineStageHeader
      currentKey="campaigns"
      step="主线第 3 步 · 任务"
      title="把今天真正要推进的任务挑出来"
      description="任务页不再只是表格。这里要帮你决定：哪些任务继续推、哪些先暂停、哪些该把结果回收到线索池。"
      previous={{ href: '/operations/strategy', label: '回到策略工作台' }}
      next={{ href: '/operations/leads', label: '前往线索池' }}
      actions={
        <>
          <Link href="/campaigns/new" className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950">
            创建任务
          </Link>
          <Link href="/operations/autopilot/trace" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100">
            打开 Trace
          </Link>
        </>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <SkeletonTable rows={6} cols={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">加载任务列表失败。</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="总任务数" value={String(stats.total)} helper="当前筛选范围内全部任务" icon={<ClipboardList className="h-4 w-4" />} />
        <SummaryCard label="运行中" value={String(stats.running)} helper="仍在执行链路中的任务" icon={<PlayCircle className="h-4 w-4" />} accent="text-emerald-300" />
        <SummaryCard label="待推进" value={String(stats.pending)} helper="适合今天继续推动的任务" icon={<PauseCircle className="h-4 w-4" />} accent="text-amber-300" />
        <SummaryCard label="累计线索" value={String(stats.leads)} helper="这些任务已经回收的线索量" icon={<Users className="h-4 w-4" />} accent="text-cyan-300" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="text-lg font-semibold text-white">今日任务判断</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DecisionCard title="先推进" value={String(stats.running)} helper="这些任务已经进入执行链，优先看状态和回执。" />
            <DecisionCard title="可补充" value={String(stats.pending)} helper="适合今天继续加素材、加动作或拉起执行。" />
            <DecisionCard title="去复盘" value={stats.running > 0 ? '有必要' : '可稍后'} helper="如果链路有异常，直接回到 Trace 查原因。" />
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <Waypoints className="h-4 w-4 text-cyan-300" />
            当前视角
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoPanel label="筛选状态" value={status || '全部状态'} />
            <InfoPanel label="当前页码" value={`第 ${page} 页`} />
            <InfoPanel label="下一步" value="看线索 / 去复盘" />
            <InfoPanel label="主路径" value="策略 → 任务 → 线索 → 复盘" />
          </div>
        </article>
      </section>

      <EntityListPage
        title="当前任务池"
        description="参照 shadcn table-01 骨架，把搜索、筛选和任务表格统一在同一张列表页里。"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="搜索任务 ID / 模板 / 状态"
        filters={
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">状态筛选</span>
            <select
              className="rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:outline-none"
              value={status ?? ''}
              onChange={(e) => setStatus(e.target.value || undefined)}
            >
              <option value="">全部状态</option>
              <option value="PUBLISHING">发布中</option>
              <option value="PENDING">待执行</option>
              <option value="COMPLETED">已完成</option>
              <option value="TERMINATED">已终止</option>
            </select>
          </div>
        }
      >
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.02] shadow-[0_24px_80px_-40px_rgba(2,6,23,0.7)]">
          <table data-testid="campaigns-table" className="min-w-full">
            <thead className="border-b border-white/8 bg-black/20">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">任务 ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">模板</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">日限额</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">线索数</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">创建时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.campaign_id} className="border-b border-white/6 last:border-0">
                  <td className="px-4 py-3 text-sm text-slate-100">{row.campaign_id}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{row.industry_template_id}</td>
                  <td className="px-4 py-3">
                    <CampaignStatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">{row.daily_publish_limit}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{row.leads_collected}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-3">
                    {!['COMPLETED', 'TERMINATED'].includes(row.status) && (
                      <Button variant="danger" onClick={() => terminate.mutate(row.campaign_id)} disabled={terminate.isPending}>
                        终止
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                    当前筛选条件下没有任务。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </EntityListPage>

      <section className="flex justify-between text-sm text-slate-400">
        <span>共 {data?.total ?? 0} 条任务</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            上一页
          </Button>
          <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      </section>
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
