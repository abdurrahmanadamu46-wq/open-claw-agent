'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Gauge, Sparkles, Wrench } from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import {
  fetchAiSkillsPoolOverview,
  fetchLobsters,
  type LlmAgentBindingRow,
  type LobsterRuntimeRow,
} from '@/services/endpoints/ai-subservice';
import {
  getAllKnownLobsterRoles,
  getLobsterRoleMeta,
  orderAgentIds,
} from '@/lib/lobster-skills';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { useTenant } from '@/contexts/TenantContext';

export default function LobsterOverviewPage() {
  const { currentTenantId } = useTenant();
  const overviewQuery = useQuery({
    queryKey: ['lobsters', 'overview', currentTenantId],
    queryFn: () => fetchAiSkillsPoolOverview(currentTenantId),
    staleTime: 60_000,
  });
  const runtimeQuery = useQuery({
    queryKey: ['lobsters', 'runtime'],
    queryFn: () => fetchLobsters(),
    staleTime: 60_000,
  });

  const summary = overviewQuery.data?.overview.summary;
  const profileRows = overviewQuery.data?.overview.profiles;
  const bindingRows = overviewQuery.data?.overview.llm_bindings;
  const ragPackRows = overviewQuery.data?.overview.agent_rag_pack_summary;
  const runtimeRows = runtimeQuery.data?.items;

  const runtimeMap = useMemo(() => {
    const map = new Map<string, LobsterRuntimeRow>();
    (runtimeRows ?? []).forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [runtimeRows]);

  const bindingMap = useMemo(() => {
    const map = new Map<string, LlmAgentBindingRow>();
    (bindingRows ?? []).forEach((item) => map.set(item.agent_id, item));
    return map;
  }, [bindingRows]);

  const ragPackMap = useMemo(() => {
    const map = new Map<string, number>();
    (ragPackRows ?? []).forEach((item) => map.set(item.agent_id, item.pack_count ?? 0));
    return map;
  }, [ragPackRows]);

  const orderedRoles = useMemo(() => {
    const knownIds = getAllKnownLobsterRoles()
      .filter((role) => role.id !== 'commander')
      .map((role) => role.id);
    const profileIds = (profileRows ?? []).map((row) => row.agent_id);
    return orderAgentIds(Array.from(new Set([...knownIds, ...profileIds]))).filter(
      (id) => id !== 'commander',
    );
  }, [profileRows]);

  if (overviewQuery.isLoading && runtimeQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在装配龙虾主管区"
          description="主管总览、主管详情和能力树会共用同一套角色真相源，避免再退回旧 dashboard 语义。"
        />
      </div>
    );
  }

  if (overviewQuery.isError && runtimeQuery.isError) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="主管区数据加载失败"
          description="能力概览和运行摘目前都没有拿到数据，但主管详情路由和能力树结构仍然已经就位。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="龙虾主管区"
        title="先看主管结构，再钻到单角色详情，而不是在旧菜单里猜角色关系"
        description="主管区现在明确分成三层：主管总览负责看岗位整体，主管详情负责看单角色状态，能力树负责看整条角色闭环。演示时，前端工程师和运营同学都能快速讲清楚每个角色如何协同。"
        actions={
          <>
            <Link
              href="/agents/cabinet"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              <Bot className="h-4 w-4" />
              岗位总览
            </Link>
            <Link
              href="/lobsters/capability-tree"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              <Sparkles className="h-4 w-4" />
              打开能力树
            </Link>
            <Link
              href="/operations/lobster-config"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white"
            >
              <Wrench className="h-4 w-4" />
              能力配置
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="主管角色"
          value={String(orderedRoles.length)}
          helper="当前面向业务的主管角色总数"
          icon={<Bot className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="启用角色"
          value={String(
            summary?.agents_enabled ?? (profileRows ?? []).filter((row) => row.enabled).length,
          )}
          helper="技能总览里已经启用的角色数"
          icon={<Gauge className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="技能总数"
          value={String(summary?.skills_total ?? 0)}
          helper="所有主管角色当前挂载的技能总量"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="知识包"
          value={String(summary?.rag_packs_total ?? 0)}
          helper="当前已经挂到角色上的 RAG 包总数"
          icon={<Wrench className="h-4 w-4" />}
        />
      </section>

      <SurfaceSection
        title="主管区三段式结构"
        description="这三张页面对应本轮交付的完整路径：总览、详情、能力树。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SurfaceLinkCard
            href="/agents/cabinet"
            title="主管总览"
            description="用岗位视角看每个主管的职责、模型绑定和知识包挂载情况。"
            icon={<Bot className="h-5 w-5" />}
            eyebrow="Overview"
            compact
          />
          <SurfaceLinkCard
            href="/lobsters/strategist"
            title="主管详情"
            description="进入单主管详情页，查看运行指标、技能清单、知识内容、配置与反馈。"
            icon={<Gauge className="h-5 w-5" />}
            eyebrow="Detail"
            compact
          />
          <SurfaceLinkCard
            href="/lobsters/capability-tree"
            title="能力树"
            description="按闭环链路而不是旧后台菜单，统一查看角色上下游、标准产物与能力覆盖。"
            icon={<Sparkles className="h-5 w-5" />}
            eyebrow="Capability Tree"
            compact
          />
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="主管详情入口"
        description="以下卡片是单主管详情的直接入口，同时叠加当前能拿到的运行状态、模型绑定和知识包数量。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedRoles.map((agentId) => {
            const meta = getLobsterRoleMeta(agentId);
            const profile = (profileRows ?? []).find((item) => item.agent_id === agentId);
            const runtime = runtimeMap.get(agentId);
            const binding = bindingMap.get(agentId);
            const runtimeStatus = runtime?.status || (profile?.enabled ? 'enabled' : 'pending');
            const displayName = runtime?.display_name || runtime?.name || meta.zhName;
            const quality = typeof runtime?.score === 'number' ? Number(runtime.score).toFixed(1) : '-';

            return (
              <article key={agentId} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {meta.stageIndex}
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">{displayName}</div>
                    <div className="mt-1 text-sm text-slate-400">{meta.artifact}</div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                    {runtimeStatus}
                  </span>
                </div>

                <div className="mt-4 text-sm leading-7 text-slate-300">{meta.summary}</div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniMetric label="技能" value={String(profile?.skills_count ?? 0)} />
                  <MiniMetric label="知识包" value={String(ragPackMap.get(agentId) ?? 0)} />
                  <MiniMetric label="模型" value={binding?.model_name || '-'} />
                  <MiniMetric label="质量" value={quality} />
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/lobsters/${encodeURIComponent(agentId)}`}
                    className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
                  >
                    打开详情
                  </Link>
                  <Link
                    href="/lobsters/capability-tree"
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white"
                  >
                    查看能力树
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </SurfaceSection>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
