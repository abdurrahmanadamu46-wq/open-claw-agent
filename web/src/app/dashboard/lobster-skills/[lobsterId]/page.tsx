'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bot, ShieldCheck, Workflow } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchAiSkillsPoolOverview,
  type AgentExtensionNode,
  type AgentExtensionProfile,
  type AgentExtensionSkill,
  type AgentRunContract,
} from '@/services/endpoints/ai-subservice';
import { getLobsterRoleMeta, OUTPUT_FORMATS } from '@/lib/lobster-skills';

type SkillsPoolOverview = Awaited<ReturnType<typeof fetchAiSkillsPoolOverview>>['overview'];

export default function LobsterSkillDetailPage() {
  const params = useParams<{ lobsterId: string }>();
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const agentId = String(params?.lobsterId || 'commander');

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'lobster-skills', 'detail', tenantId],
    queryFn: () => fetchAiSkillsPoolOverview(tenantId),
    staleTime: 60_000,
  });

  const overview = overviewQuery.data?.overview;

  const profile = useMemo(() => {
    return overview?.agent_profiles?.find((item) => item.agent_id === agentId);
  }, [agentId, overview?.agent_profiles]);

  const profileSummary = useMemo(() => {
    return overview?.profiles?.find((item) => item.agent_id === agentId);
  }, [agentId, overview?.profiles]);

  const binding = useMemo(() => {
    return overview?.llm_bindings?.find((item) => item.agent_id === agentId);
  }, [agentId, overview?.llm_bindings]);

  const ragPackSummary = useMemo(() => {
    return overview?.agent_rag_pack_summary?.find((item) => item.agent_id === agentId);
  }, [agentId, overview?.agent_rag_pack_summary]);

  const meta = getLobsterRoleMeta(agentId);

  if (overviewQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-400">正在加载龙虾详情...</div>;
  }

  if (overviewQuery.isError || !overview) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-100">
          龙虾详情加载失败。请确认控制面链路正常后重试。
        </div>
      </div>
    );
  }

  const skills = profile?.skills || [];
  const nodes = profile?.nodes || [];
  const runContract = profile?.run_contract;
  const collaboration = profile?.collaboration_contract;
  const enabled = profileSummary?.enabled ?? profile?.enabled ?? false;
  const runtimeMode = profileSummary?.runtime_mode ?? profile?.runtime_mode ?? 'hybrid';

  return (
    <div className="space-y-6 bg-slate-950 p-6 text-slate-100">
      <section className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_30%),rgba(255,255,255,0.04)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Lobster Skill Detail</div>
            <div className="mt-3 flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.06] text-4xl">
                {meta.icon}
              </div>
              <div>
                <h1 className="text-4xl font-semibold text-white">{meta.zhName}</h1>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-100">{meta.stageIndex} {meta.stageLabel}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-slate-300">{runtimeMode}</span>
                  <span
                    className={`rounded-full px-3 py-1 ${
                      enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {enabled ? '已启用' : '未启用'}
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-7 text-slate-300">{meta.summary}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/lobster-skills"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              返回总览
            </Link>
            <Link
              href="/operations/skills-pool"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950"
            >
              编辑当前角色
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="技能数" value={String(profileSummary?.skills_count ?? skills.length)} />
        <MetricCard label="节点数" value={String(profileSummary?.nodes_count ?? nodes.length)} />
        <MetricCard label="知识包" value={String(ragPackSummary?.pack_count ?? 0)} />
        <MetricCard label="模型绑定" value={binding?.model_name || '-'} helper={binding ? `${binding.provider_id} / ${binding.task_type}` : undefined} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">角色闭环位置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <InfoTile label="核心工件" value={meta.artifact} />
              <InfoTile label="标准输出" value={OUTPUT_FORMATS.join(' / ')} />
              <InfoTile label="上游依赖" value={formatIds(meta.upstreamIds)} />
              <InfoTile label="下游交接" value={formatIds(meta.downstreamIds)} />
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Workflow className="h-4 w-4 text-cyan-300" />
                协作约束
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ListBlock title="Decision Scope" items={stringList(collaboration?.decision_scope)} emptyLabel="未填写" />
                <ListBlock title="Deliverables" items={stringList(collaboration?.deliverables)} emptyLabel="未填写" />
                <ListBlock title="Must Sync With" items={stringList(collaboration?.must_sync_with)} emptyLabel="未填写" />
                <ListBlock title="Forbidden Actions" items={stringList(collaboration?.forbidden_actions)} emptyLabel="未填写" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">运行契约</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ShieldCheck className="h-4 w-4 text-cyan-300" />
                Run Contract
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ListBlock title="Activation When" items={stringList(runContract?.activation_when)} emptyLabel="未填写" />
                <ListBlock title="Escalate When" items={stringList(runContract?.escalate_when)} emptyLabel="未填写" />
                <ListBlock title="Approval Needed" items={stringList(runContract?.approval_needed_for)} emptyLabel="未填写" />
                <ListBlock title="Forbidden Actions" items={stringList(runContract?.forbidden_actions)} emptyLabel="未填写" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <BudgetTile label="软时限" value={budgetLabel(runContract, 'soft')} />
              <BudgetTile label="硬时限" value={budgetLabel(runContract, 'hard')} />
              <BudgetTile label="最大模型层级" value={String(runContract?.cost_budget?.max_model_tier || '-')} />
              <BudgetTile label="最大工具调用" value={String(runContract?.cost_budget?.max_tool_calls ?? '-')} />
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="border-white/10 bg-white/[0.04] shadow-none">
        <CardHeader>
          <CardTitle className="text-white">Role Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm leading-7 text-slate-300">
            {profile?.role_prompt?.trim() ? profile.role_prompt : '当前未在控制面中配置 role prompt。'}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">技能清单</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {skills.length > 0 ? (
              skills.map((skill) => <SkillCard key={skill.skill_id || skill.name} skill={skill} />)
            ) : (
              <EmptyState title="暂无技能条目" description="当前角色在这个租户下还没有录入技能定义。" />
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.04] shadow-none">
          <CardHeader>
            <CardTitle className="text-white">节点清单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nodes.length > 0 ? (
              nodes.map((node) => <NodeCard key={node.node_id || node.title} node={node} />)
            ) : (
              <EmptyState title="暂无节点条目" description="当前角色在这个租户下还没有定义运行节点。" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function formatIds(ids: string[]): string {
  if (!ids.length) return '无';
  return ids.map((id) => getLobsterRoleMeta(id).zhName).join(' / ');
}

function budgetLabel(contract: AgentRunContract | undefined, kind: 'soft' | 'hard'): string {
  if (kind === 'soft') {
    return contract?.latency_budget?.soft_limit_sec ? `${contract.latency_budget.soft_limit_sec}s` : '-';
  }
  return contract?.latency_budget?.hard_limit_sec ? `${contract.latency_budget.hard_limit_sec}s` : '-';
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      {helper ? <div className="mt-2 text-sm text-slate-300">{helper}</div> : null}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function BudgetTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function ListBlock({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <span key={item} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
              {item}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: AgentExtensionSkill }) {
  const configKeys = Object.keys(skill.config || {});

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-white">{skill.name || skill.skill_id || '未命名技能'}</div>
          <div className="mt-1 text-xs text-slate-500">{skill.skill_id || 'no-skill-id'}</div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            skill.enabled === false ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500/15 text-emerald-200'
          }`}
        >
          {skill.enabled === false ? '已停用' : '启用中'}
        </span>
      </div>

      <p className="mt-3 text-sm leading-7 text-slate-300">{skill.description || skill.capability || '暂无描述。'}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoTile label="Capability" value={skill.capability || '-'} />
        <InfoTile label="Node" value={skill.node_id || '-'} />
        <InfoTile label="Runtime" value={skill.runtime || '-'} />
        <InfoTile label="Entrypoint" value={skill.entrypoint || '-'} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
          {skill.required ? 'required' : 'optional'}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
          config {configKeys.length}
        </span>
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: AgentExtensionNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-white">{node.title || node.node_id || '未命名节点'}</div>
          <div className="mt-1 text-xs text-slate-500">{node.node_id || 'no-node-id'}</div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            node.enabled === false ? 'bg-slate-800 text-slate-400' : 'bg-cyan-500/15 text-cyan-100'
          }`}
        >
          {node.enabled === false ? '已停用' : '启用中'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoTile label="Type" value={node.type || '-'} />
        <InfoTile label="Timeout" value={node.timeout_sec ? `${node.timeout_sec}s` : '-'} />
        <InfoTile label="Retry" value={String(node.retry_limit ?? '-')} />
        <InfoTile label="Config Keys" value={String(Object.keys(node.config || {}).length)} />
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
      <div className="flex items-center gap-2 font-medium text-slate-200">
        <Bot className="h-4 w-4" />
        {title}
      </div>
      <p className="mt-2 leading-7">{description}</p>
    </div>
  );
}
