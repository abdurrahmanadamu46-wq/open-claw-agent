'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, FolderKanban, Network, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchAiSkillsPoolOverview,
  type AgentExtensionProfile,
  type LlmAgentBindingRow,
} from '@/services/endpoints/ai-subservice';
import {
  getLobsterRoleMeta,
  LOBSTER_PIPELINE_STAGES,
  orderAgentIds,
  OUTPUT_FORMATS,
} from '@/lib/lobster-skills';

type SkillsPoolOverview = Awaited<ReturnType<typeof fetchAiSkillsPoolOverview>>['overview'];

export default function LobsterSkillsDashboardPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'lobster-skills', tenantId],
    queryFn: () => fetchAiSkillsPoolOverview(tenantId),
    staleTime: 60_000,
  });

  const overview = overviewQuery.data?.overview;

  const profileByAgent = useMemo(() => {
    const map = new Map<string, AgentExtensionProfile>();
    (overview?.agent_profiles || []).forEach((profile) => {
      map.set(profile.agent_id, profile);
    });
    return map;
  }, [overview?.agent_profiles]);

  const profileSummaryByAgent = useMemo(() => {
    const map = new Map<string, SkillsPoolOverview['profiles'][number]>();
    (overview?.profiles || []).forEach((row) => {
      map.set(row.agent_id, row);
    });
    return map;
  }, [overview?.profiles]);

  const bindingByAgent = useMemo(() => {
    const map = new Map<string, LlmAgentBindingRow>();
    (overview?.llm_bindings || []).forEach((binding) => {
      map.set(binding.agent_id, binding);
    });
    return map;
  }, [overview?.llm_bindings]);

  const ragPackCountByAgent = useMemo(() => {
    const map = new Map<string, number>();
    (overview?.agent_rag_pack_summary || []).forEach((item) => {
      map.set(item.agent_id, item.pack_count || 0);
    });
    return map;
  }, [overview?.agent_rag_pack_summary]);

  const orderedAgentIds = useMemo(() => {
    return orderAgentIds((overview?.agent_profiles || []).map((item) => item.agent_id));
  }, [overview?.agent_profiles]);

  if (overviewQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-400">正在加载龙虾技能总览...</div>;
  }

  if (overviewQuery.isError || !overview) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-100">
          龙虾技能总览加载失败。请确认 `backend` 与 `ai-subservice` 已启动，或检查当前租户是否具备访问权限。
        </div>
      </div>
    );
  }

  const summary = overview.summary;

  return (
    <div className="space-y-6 bg-slate-950 p-6 text-slate-100">
      <section className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(251,191,36,0.18),transparent_24%),rgba(255,255,255,0.04)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Skills</div>
            <h1 className="mt-3 text-4xl font-semibold text-white">让总控看清每只龙虾会什么、正在怎么跑</h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              这一页不做复杂配置，而是把 Commander + 9 只业务龙虾的技能、运行模式、模型绑定、知识包与闭环位置放进同一张前端地图里。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/operations/skills-pool"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100"
            >
              打开配置面板
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard/lobster-pool"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white"
            >
              查看运行池
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="角色总数"
          value={String(summary.agents_total)}
          helper={`已启用 ${summary.agents_enabled} 个，停用 ${Math.max(0, summary.agents_total - summary.agents_enabled)} 个`}
        />
        <MetricCard
          label="技能总数"
          value={String(summary.skills_total)}
          helper={`平均每角色 ${(summary.skills_total / Math.max(summary.agents_total, 1)).toFixed(1)} 个`}
        />
        <MetricCard
          label="节点总数"
          value={String(summary.nodes_total)}
          helper={`RAG 包 ${summary.rag_packs_total}，行业知识配置 ${summary.kb_profiles_total}`}
        />
        <MetricCard
          label="工作流模板"
          value={String(summary.workflow_templates_total)}
          helper={`${Object.keys(overview.workflow_templates_by_industry || {}).length} 个行业已挂模板`}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">业务闭环 7 阶段</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {LOBSTER_PIPELINE_STAGES.map((stage) => {
              const owners = stage.ownerIds.map((agentId) => {
                const meta = getLobsterRoleMeta(agentId);
                const summaryRow = profileSummaryByAgent.get(agentId);
                return {
                  meta,
                  enabled: summaryRow?.enabled !== false,
                  skillsCount: summaryRow?.skills_count ?? profileByAgent.get(agentId)?.skills?.length ?? 0,
                };
              });

              const enabledOwners = owners.filter((owner) => owner.enabled).length;
              const totalSkills = owners.reduce((sum, owner) => sum + owner.skillsCount, 0);

              return (
                <div key={stage.key} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">{stage.label}</div>
                      <div className="mt-2 text-base font-semibold text-white">
                        {owners.map((owner) => owner.meta.zhName).join(' / ')}
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-300">
                      在线角色 {enabledOwners}/{owners.length}
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-300">{stage.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {owners.map((owner) => (
                      <span
                        key={owner.meta.id}
                        className={`rounded-full px-3 py-1 text-xs ${
                          owner.enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {owner.meta.icon} {owner.meta.zhName}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MiniMetric label="当前技能数" value={String(totalSkills)} />
                    <MiniMetric label="标准输出" value={String(OUTPUT_FORMATS.length)} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">前端接力重点</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-7 text-slate-300">
            <ActionCallout
              icon={<BrainCircuit className="h-4 w-4" />}
              title="先把前台真相源建立起来"
              description="把技能、角色、模板、模型和运行契约放进统一页面，减少“看配置页猜系统状态”。"
            />
            <ActionCallout
              icon={<FolderKanban className="h-4 w-4" />}
              title="详情页承接到配置页"
              description="运营先看懂当前角色，再跳去配置面板改 role prompt、skills 和 nodes。"
            />
            <ActionCallout
              icon={<Network className="h-4 w-4" />}
              title="后续可继续补 Agent OS 面板"
              description="下一轮适合把 SOUL / AGENTS / HEARTBEAT / WORKING 以抽屉形式接进单龙虾详情页。"
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {orderedAgentIds.map((agentId) => {
          const meta = getLobsterRoleMeta(agentId);
          const profile = profileByAgent.get(agentId);
          const profileSummary = profileSummaryByAgent.get(agentId);
          const binding = bindingByAgent.get(agentId);
          const ragPackCount = ragPackCountByAgent.get(agentId) ?? 0;

          return (
            <RoleOverviewCard
              key={agentId}
              agentId={agentId}
              meta={meta}
              profile={profile}
              profileSummary={profileSummary}
              binding={binding}
              ragPackCount={ragPackCount}
            />
          );
        })}
      </section>
    </div>
  );
}

function RoleOverviewCard({
  agentId,
  meta,
  profile,
  profileSummary,
  binding,
  ragPackCount,
}: {
  agentId: string;
  meta: ReturnType<typeof getLobsterRoleMeta>;
  profile?: AgentExtensionProfile;
  profileSummary?: SkillsPoolOverview['profiles'][number];
  binding?: LlmAgentBindingRow;
  ragPackCount: number;
}) {
  const skillsCount = profileSummary?.skills_count ?? profile?.skills?.length ?? 0;
  const nodesCount = profileSummary?.nodes_count ?? profile?.nodes?.length ?? 0;
  const enabled = profileSummary?.enabled ?? profile?.enabled ?? false;
  const runtimeMode = profileSummary?.runtime_mode ?? profile?.runtime_mode ?? 'hybrid';

  return (
    <Card className="border-white/10 bg-white/[0.04] shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-2xl">
              {meta.icon}
            </div>
            <div>
              <CardTitle className="text-white">{meta.zhName}</CardTitle>
              <div className="mt-1 text-sm text-slate-400">{meta.enName}</div>
            </div>
          </div>

          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {enabled ? '已启用' : '未启用'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-100">{meta.stageIndex} {meta.stageLabel}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-slate-300">{meta.artifact}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-slate-300">{runtimeMode}</span>
        </div>

        <p className="text-sm leading-7 text-slate-300">{meta.summary}</p>

        <div className="grid grid-cols-2 gap-3">
          <MiniMetric label="技能" value={String(skillsCount)} />
          <MiniMetric label="节点" value={String(nodesCount)} />
          <MiniMetric label="知识包" value={String(ragPackCount)} />
          <MiniMetric label="绑定模型" value={binding?.model_name || '-'} />
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">代表技能</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(profile?.skills?.slice(0, 3).map((item) => item.name || item.skill_id) || meta.representativeSkills).map((skill) => (
              <span key={skill} className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-slate-200">
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">标准输出</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {OUTPUT_FORMATS.map((format) => (
              <span key={format} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                {format}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href={`/dashboard/lobster-skills/${encodeURIComponent(agentId)}`}
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
          >
            查看详情
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/operations/skills-pool"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white"
          >
            编辑配置
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{helper}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ActionCallout({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <span className="text-cyan-300">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm leading-7 text-slate-300">{description}</p>
    </div>
  );
}
