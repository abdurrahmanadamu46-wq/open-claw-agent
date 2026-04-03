'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, LibraryBig, Radar, Settings2, Sparkles, Workflow } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { fetchAiSkillsPoolOverview } from '@/services/endpoints/ai-subservice';
import { fetchIntegrations } from '@/services/endpoints/integrations';

const ENTRY_LINKS = [
  {
    href: '/ai-brain/content',
    title: '内容资产中心',
    desc: '查看内容模板、对象存储和媒体资产是否已经就绪。',
    icon: <LibraryBig className="h-5 w-5 text-cyan-300" />,
  },
  {
    href: '/ai-brain/radar',
    title: '竞品雷达',
    desc: '把外部信号、竞品动作和选题变化收拢到策略前置区。',
    icon: <Radar className="h-5 w-5 text-amber-300" />,
  },
  {
    href: '/operations/skills-pool',
    title: '技能池',
    desc: '查看岗位技能、节点能力和可调用工作流模板。',
    icon: <Sparkles className="h-5 w-5 text-fuchsia-300" />,
  },
  {
    href: '/settings/model-providers',
    title: '模型与服务商',
    desc: '统一管理模型供应、路由方式和龙虾岗位绑定。',
    icon: <Bot className="h-5 w-5 text-emerald-300" />,
  },
];

export default function CreationStudioPage() {
  const { currentTenantId } = useTenant();
  const overviewQuery = useQuery({
    queryKey: ['ai-studio', 'skills-overview', currentTenantId],
    queryFn: () => fetchAiSkillsPoolOverview(currentTenantId),
  });
  const integrationsQuery = useQuery({
    queryKey: ['ai-studio', 'integrations'],
    queryFn: fetchIntegrations,
  });

  const summary = overviewQuery.data?.overview.summary;
  const workflowTemplates = overviewQuery.data?.overview.workflow_templates ?? [];
  const templatesByIndustry = useMemo(
    () => Object.entries(overviewQuery.data?.overview.workflow_templates_by_industry ?? {}),
    [overviewQuery.data?.overview.workflow_templates_by_industry],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              AI 中台
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">把技能、知识、模板和模型组织成一个中台</h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
              这里不再是旧式入口列表，而是你判断“当前租户的 AI 创作能力够不够支撑真实交付”的总入口。
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            当前租户：{currentTenantId}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StudioCard
          icon={<Bot className="h-5 w-5 text-cyan-300" />}
          label="启用岗位"
          value={summary ? `${summary.agents_enabled}/${summary.agents_total}` : '-'}
          subtitle="当前启用的龙虾岗位数"
        />
        <StudioCard
          icon={<Workflow className="h-5 w-5 text-emerald-300" />}
          label="工作流模板"
          value={summary ? String(summary.workflow_templates_total) : '-'}
          subtitle="租户当前可复用的执行模板"
        />
        <StudioCard
          icon={<LibraryBig className="h-5 w-5 text-amber-300" />}
          label="知识配置"
          value={summary ? String(summary.kb_profiles_total) : '-'}
          subtitle="已挂载的知识配置档"
        />
        <StudioCard
          icon={<Settings2 className="h-5 w-5 text-fuchsia-300" />}
          label="对象存储"
          value={integrationsQuery.data?.storage?.provider ? '已配置' : '缺失'}
          subtitle="内容资产是否具备稳定落盘条件"
        />
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 text-lg font-semibold text-white">关键入口</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ENTRY_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition hover:border-cyan-400/30 hover:bg-slate-950/60"
            >
              <div className="flex items-center gap-2 text-slate-100">
                {item.icon}
                <span className="font-medium">{item.title}</span>
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-300">{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 text-lg font-semibold text-white">模板活跃度</div>
          {workflowTemplates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
              当前租户还没有可用的在线模板。
            </div>
          ) : (
            <div className="space-y-3">
              {workflowTemplates.slice(0, 8).map((item, index) => {
                const row = item as Record<string, unknown>;
                const title = String(row.template_name ?? row.name ?? `template-${index + 1}`);
                const industry = String(row.industry_tag ?? row.industry ?? 'general');
                return (
                  <div key={`${title}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4 text-sm">
                    <div className="font-medium text-slate-100">{title}</div>
                    <div className="mt-1 text-xs text-slate-400">行业标签：{industry}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 text-lg font-semibold text-white">行业覆盖</div>
          {templatesByIndustry.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
              当前还没有行业模板统计数据。
            </div>
          ) : (
            <div className="space-y-3">
              {templatesByIndustry.map(([industry, count]) => (
                <div key={industry} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4 text-sm">
                  <span className="text-slate-100">{industry}</span>
                  <span className="text-slate-300">{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StudioCard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}
