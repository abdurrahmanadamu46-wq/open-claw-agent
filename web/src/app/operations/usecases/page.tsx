'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Filter, Sparkles } from 'lucide-react';
import {
  fetchUsecaseCategories,
  fetchUsecases,
  type UsecaseTemplate,
} from '@/services/endpoints/ai-subservice';
import { getLobsterRoleMeta } from '@/lib/lobster-skills';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
};

const CATEGORY_LABELS: Record<string, string> = {
  content_creation: '内容创作',
  social_media: '社交媒体',
  customer_service: '客户服务',
  competitive_intel: '竞品情报',
  ecommerce: '电商',
  lead_gen: '线索增长',
  analytics: '分析复盘',
  devops: '运维自动化',
};

function difficultyTone(difficulty: string): string {
  if (difficulty === 'advanced') return 'bg-rose-500/15 text-rose-200';
  if (difficulty === 'intermediate') return 'bg-amber-400/15 text-amber-200';
  return 'bg-emerald-500/15 text-emerald-200';
}

export default function UsecasesPage() {
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('');

  const categoriesQuery = useQuery({
    queryKey: ['usecases', 'categories'],
    queryFn: fetchUsecaseCategories,
    staleTime: 60_000,
  });

  const usecasesQuery = useQuery({
    queryKey: ['usecases', category, difficulty],
    queryFn: () => fetchUsecases({ category: category || undefined, difficulty: difficulty || undefined }),
    staleTime: 60_000,
  });

  const usecases = usecasesQuery.data?.usecases || [];
  const categories = categoriesQuery.data?.categories || [];
  const summary = {
    total: usecasesQuery.data?.count ?? usecases.length,
    categories: categories.length,
    scheduled: usecases.filter((item) => item.scheduler_config?.kind).length,
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Usecases</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">场景模板市场</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                技能告诉用户龙虾“会做什么”，用例模板告诉用户“该怎么把它用起来”。这里预置的是可直接照着落地的端到端方案。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="模板数" value={String(summary.total)} />
              <Metric label="分类数" value={String(summary.categories)} />
              <Metric label="可联动定时" value={String(summary.scheduled)} />
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              <Filter className="h-4 w-4" />
              筛选器
            </div>

            <div className="mt-5">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">分类</div>
              <div className="mt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => setCategory('')}
                  className={`w-full rounded-2xl px-3 py-2 text-left text-sm ${!category ? 'bg-cyan-500/15 text-cyan-100' : 'bg-slate-950/40 text-slate-300'}`}
                >
                  全部分类
                </button>
                {categories.map((item) => (
                  <button
                    key={item.category}
                    type="button"
                    onClick={() => setCategory(item.category)}
                    className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm ${
                      category === item.category ? 'bg-cyan-500/15 text-cyan-100' : 'bg-slate-950/40 text-slate-300'
                    }`}
                  >
                    <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                    <span className="text-xs text-slate-400">{item.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">难度</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {['', 'beginner', 'intermediate', 'advanced'].map((item) => (
                  <button
                    key={item || 'all'}
                    type="button"
                    onClick={() => setDifficulty(item)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      difficulty === item ? 'bg-white text-slate-950' : 'bg-slate-950/40 text-slate-300'
                    }`}
                  >
                    {item ? DIFFICULTY_LABELS[item] : '全部'}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="space-y-4">
            {usecasesQuery.isLoading ? (
              <StateCard text="正在加载用例模板..." />
            ) : usecasesQuery.isError ? (
              <StateCard text="用例模板加载失败，请检查 ai-subservice 与 Python API。" tone="error" />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {usecases.map((usecase) => (
                  <UsecaseCard key={usecase.id} usecase={usecase} />
                ))}
              </div>
            )}

            {!usecasesQuery.isLoading && !usecasesQuery.isError && !usecases.length ? (
              <StateCard text="当前筛选条件下没有模板。" />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function UsecaseCard({ usecase }: { usecase: UsecaseTemplate }) {
  return (
    <article
      className="rounded-[28px] border p-5"
      style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
          {CATEGORY_LABELS[usecase.category] || usecase.category}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs ${difficultyTone(usecase.difficulty)}`}>
          {DIFFICULTY_LABELS[usecase.difficulty] || usecase.difficulty}
        </span>
        {usecase.scheduler_config?.kind ? (
          <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
            支持定时调度
          </span>
        ) : null}
      </div>

      <div className="mt-4 text-xl font-semibold text-white">{usecase.name}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{usecase.description}</div>
      <div className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
        痛点：{usecase.pain_point || '未填写'}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {usecase.lobsters.map((lobsterId) => {
          const meta = getLobsterRoleMeta(lobsterId);
          return (
            <span key={lobsterId} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">
              {meta.icon} {meta.zhName}
            </span>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
        <span>步骤数 {usecase.setup_steps.length}</span>
        <span>渠道 {usecase.channels?.join(' / ') || '-'}</span>
        <span>成本 {usecase.estimated_cost_per_run || '-'}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={`/operations/usecases/${encodeURIComponent(usecase.id)}`}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
        >
          查看详情
          <ArrowRight className="h-4 w-4" />
        </Link>
        {usecase.scheduler_config?.kind ? (
          <Link
            href={`/operations/usecases/${encodeURIComponent(usecase.id)}#apply`}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
          >
            <Sparkles className="h-4 w-4" />
            一键配置
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-center">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function StateCard({ text, tone = 'default' }: { text: string; tone?: 'default' | 'error' }) {
  return (
    <div
      className={`rounded-[28px] border px-6 py-10 text-center text-sm ${
        tone === 'error'
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
          : 'border-slate-700/70 bg-slate-950/40 text-slate-300'
      }`}
    >
      {text}
    </div>
  );
}
