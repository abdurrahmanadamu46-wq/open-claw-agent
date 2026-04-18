'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  KeyRound,
  Network,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useTenant, type NodeWorkflowStepId } from '@/contexts/TenantContext';

type Step = {
  id: NodeWorkflowStepId;
  title: string;
  summary: string;
  actionLabel: string;
  href: string;
  owner: string;
};

const STEPS: Step[] = [
  {
    id: 'S1',
    title: '接入边缘龙虾节点',
    summary: '生成租户激活码并连接客户端，确认执行节点在线。',
    actionLabel: '立刻接入节点',
    href: '/fleet?openAddNode=1',
    owner: '边缘执行层',
  },
  {
    id: 'S2',
    title: '绑定网络与指纹策略',
    summary: '配置代理池和设备指纹，降低平台风控触发概率。',
    actionLabel: '配置网络与指纹',
    href: '/fleet/proxies',
    owner: '边缘执行层',
  },
  {
    id: 'S3',
    title: '配置元老院 RAG 脑库',
    summary: '为云端 9 个岗位龙虾和元老院总脑配置知识包，提高推理与决策能力。',
    actionLabel: '进入元老院脑库',
    href: '/ai-brain/prompt-lab?focus=brain',
    owner: '云端大脑层',
  },
  {
    id: 'S4',
    title: '下发边缘人设面具',
    summary: '把角色面具通过 OTA 分发到边缘节点，控制执行端的人设与行为风格。',
    actionLabel: '进入人设面具 OTA',
    href: '/ai-brain/prompt-lab?focus=edge',
    owner: '边缘执行层',
  },
  {
    id: 'S5',
    title: '灰度发布 + Trace 排障',
    summary: '先小范围放量，再通过 Trace 闭环定位问题，稳定后再全量扩展。',
    actionLabel: '打开 Trace 排障',
    href: '/operations/autopilot/trace',
    owner: '调度与运维层',
  },
];

function StepIcon({ id }: { id: NodeWorkflowStepId }) {
  if (id === 'S1') return <KeyRound className="h-4 w-4 text-amber-300" />;
  if (id === 'S2') return <Network className="h-4 w-4 text-sky-300" />;
  if (id === 'S3') return <BrainCircuit className="h-4 w-4 text-violet-300" />;
  if (id === 'S4') return <ShieldCheck className="h-4 w-4 text-emerald-300" />;
  return <BookOpen className="h-4 w-4 text-rose-300" />;
}

export default function NodesWorkflowPage() {
  const {
    currentTenantId,
    setCurrentTenantId,
    tenants,
    currentTenant,
    getTenantWorkflowProgress,
    setTenantWorkflowStep,
    resetTenantWorkflowProgress,
  } = useTenant();

  const selectableTenants = useMemo(() => tenants.filter((tenant) => !tenant.inactive), [tenants]);
  const progress = getTenantWorkflowProgress(currentTenantId);
  const completed = useMemo(() => STEPS.filter((step) => progress[step.id]).length, [progress]);
  const percent = Math.round((completed / STEPS.length) * 100);

  return (
    <div className="relative text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.12),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative space-y-5 p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
                <Network className="h-4 w-4" />
                节点流程：把接入、知识、面具和灰度发布做成可见流程
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">节点接入可视化向导</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                这页的价值不是展示一条漂亮流程图，而是让团队清楚知道：当前租户的节点接入进度走到哪一步，下一步应该去哪里处理，以及哪些准备工作还没完成。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={currentTenantId}
                onChange={(e) => setCurrentTenantId(e.target.value)}
                className="rounded-2xl border border-slate-600 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none"
                aria-label="切换租户"
              >
                {selectableTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => resetTenantWorkflowProgress(currentTenantId)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-600 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                重置进度
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/8 bg-slate-950/40 p-5">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">当前租户：{currentTenant?.name ?? currentTenantId}</span>
              <span className="font-medium text-slate-100">
                {completed}/{STEPS.length}（{percent}%）
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700/60">
              <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {STEPS.map((step) => {
            const done = progress[step.id];
            return (
              <article key={step.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">{step.id}</span>
                  <StepIcon id={step.id} />
                </div>
                <h2 className="text-sm font-semibold text-slate-100">{step.title}</h2>
                <p className="mt-2 text-xs leading-6 text-slate-400">{step.summary}</p>
                <div className="mt-3 text-[11px] text-slate-500">归属：{step.owner}</div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTenantWorkflowStep(currentTenantId, step.id, !done)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
                      done
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-600 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {done ? '已完成' : '标记完成'}
                  </button>
                  <Link
                    href={step.href}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
                  >
                    去执行
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
