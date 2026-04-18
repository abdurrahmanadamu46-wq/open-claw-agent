'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Sparkles } from 'lucide-react';
import { fetchUsecaseDetail, type UsecaseTemplate } from '@/services/endpoints/ai-subservice';
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

function buildSchedulerHref(usecase: UsecaseTemplate): string {
  const params = new URLSearchParams();
  params.set('preset', '1');
  params.set('name', usecase.name);
  params.set('lobster_id', usecase.lobsters[0] || 'radar');
  params.set('prompt', `${usecase.description}\n\n痛点：${usecase.pain_point || '未填写'}\n\n关键步骤：${usecase.setup_steps.map((item) => `${item.step}. ${item.action}`).join('；')}`);
  if (usecase.scheduler_config?.kind) params.set('kind', usecase.scheduler_config.kind);
  if (usecase.scheduler_config?.schedule) params.set('schedule', usecase.scheduler_config.schedule);
  if (usecase.scheduler_config?.session_mode) params.set('session_mode', usecase.scheduler_config.session_mode);
  return `/operations/scheduler?${params.toString()}`;
}

export default function UsecaseDetailPage() {
  const params = useParams<{ id: string }>();
  const usecaseId = String(params?.id || '');

  const detailQuery = useQuery({
    queryKey: ['usecases', 'detail', usecaseId],
    queryFn: () => fetchUsecaseDetail(usecaseId),
    enabled: Boolean(usecaseId),
    staleTime: 60_000,
  });

  const usecase = detailQuery.data?.usecase;
  const schedulerHref = useMemo(() => (usecase ? buildSchedulerHref(usecase) : '/operations/scheduler'), [usecase]);

  if (detailQuery.isLoading) {
    return <StateCard text="正在加载用例详情..." />;
  }

  if (detailQuery.isError || !usecase) {
    return <StateCard text="用例详情加载失败，请检查 ai-subservice 与 Python API。" tone="error" />;
  }

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Usecase Detail</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">{usecase.name}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                  {CATEGORY_LABELS[usecase.category] || usecase.category}
                </span>
                <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                  {DIFFICULTY_LABELS[usecase.difficulty] || usecase.difficulty}
                </span>
                {usecase.scheduler_config?.kind ? (
                  <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                    {usecase.scheduler_config.kind} · {usecase.scheduler_config.schedule}
                  </span>
                ) : null}
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">{usecase.description}</p>
              <div className="mt-4 rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                痛点：{usecase.pain_point || '未填写'}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/operations/usecases"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              >
                <ArrowLeft className="h-4 w-4" />
                返回模板市场
              </Link>
              <Link
                href={schedulerHref}
                id="apply"
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
              >
                <Sparkles className="h-4 w-4" />
                一键应用到定时任务
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {usecase.lobsters.map((lobsterId) => {
              const meta = getLobsterRoleMeta(lobsterId);
              return (
                <span key={lobsterId} className="rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {meta.icon} {meta.zhName}
                </span>
              );
            })}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">Setup Wizard</div>
            <div className="mt-2 text-xl font-semibold text-white">配置步骤</div>
            <div className="mt-4 space-y-3">
              {usecase.setup_steps.map((step) => (
                <div key={`${usecase.id}-${step.step}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15 text-sm font-semibold text-cyan-200">
                      {step.step}
                    </div>
                    <div>
                      <div className="text-base font-semibold text-white">{step.action}</div>
                      <div className="text-xs text-slate-400">
                        {step.code_type || 'none'} {step.requires_user_input ? '· 需要用户输入' : '· 可自动完成'}
                      </div>
                    </div>
                  </div>
                  {step.code ? (
                    <pre className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-[#0b1322] p-3 text-sm text-slate-300 whitespace-pre-wrap">
                      {step.code}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div
              className="rounded-[28px] border p-5"
              style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
            >
              <div className="text-xs uppercase tracking-[0.16em] text-fuchsia-300">Template Facts</div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <InfoRow label="技能依赖" value={usecase.skills_required?.join(' / ') || '-'} />
                <InfoRow label="适用渠道" value={usecase.channels?.join(' / ') || '-'} />
                <InfoRow label="预计成本" value={usecase.estimated_cost_per_run || '-'} />
                <InfoRow label="定时模式" value={usecase.scheduler_config?.kind ? `${usecase.scheduler_config.kind} · ${usecase.scheduler_config.schedule}` : '无默认定时'} />
              </div>
            </div>

            <div
              className="rounded-[28px] border p-5"
              style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
            >
              <div className="text-xs uppercase tracking-[0.16em] text-amber-300">实战建议</div>
              <div className="mt-4 space-y-3">
                {(usecase.tips || []).map((tip, index) => (
                  <div key={`${usecase.id}-tip-${index}`} className="flex gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 text-sm text-slate-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{tip}</span>
                  </div>
                ))}
                {!usecase.tips?.length ? <div className="text-sm text-slate-400">暂无补充建议。</div> : null}
              </div>
            </div>

            <div
              className="rounded-[28px] border p-5"
              style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
            >
              <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">下一步</div>
              <div className="mt-3 text-sm leading-7 text-slate-300">
                如果这个模板适合你，优先走“一键应用到定时任务”。如果暂时不需要调度，可以先去技能池或策略面板手动配置。
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={schedulerHref}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
                >
                  <Clock3 className="h-4 w-4" />
                  应用到 Scheduler
                </Link>
                <Link
                  href="/operations/skills-pool"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
                >
                  去技能池查看
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-100">{value}</div>
    </div>
  );
}

function StateCard({ text, tone = 'default' }: { text: string; tone?: 'default' | 'error' }) {
  return (
    <div
      className={`min-h-[calc(100vh-5rem)] p-6 text-sm ${
        tone === 'error' ? 'bg-rose-500/10 text-rose-200' : 'bg-[#07111f] text-slate-300'
      }`}
    >
      {text}
    </div>
  );
}
