'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Sparkles } from 'lucide-react';
import { SupervisorCapabilityTree } from '@/components/lobster/SupervisorCapabilityTree';
import {
  getLobsterCapabilityProfile,
  hasLobsterCapabilityProfile,
} from '@/lib/lobster-capability-tree';
import {
  SurfaceHero,
  SurfaceMetric,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { IntegrationHelpCard } from '@/components/operations/IntegrationHelpCard';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { fetchAiSkillsPoolOverview, fetchLobsterEntity } from '@/services/endpoints/ai-subservice';

export default function LobsterCapabilitiesPage() {
  const params = useParams<{ id: string }>();
  const lobsterId = String(params?.id || 'strategist');
  const detailQuery = useQuery({
    queryKey: ['lobster-capabilities', 'entity', lobsterId],
    queryFn: () => fetchLobsterEntity(lobsterId),
    retry: false,
    staleTime: 60 * 1000,
  });
  const overviewQuery = useQuery({
    queryKey: ['lobster-capabilities', 'overview'],
    queryFn: () => fetchAiSkillsPoolOverview(),
    retry: false,
    staleTime: 60 * 1000,
  });

  const profileExists = hasLobsterCapabilityProfile(lobsterId);
  const profile = getLobsterCapabilityProfile(lobsterId);
  const profileSummary = overviewQuery.data?.overview.profiles.find((item) => item.agent_id === lobsterId);
  const ragPackSummary = overviewQuery.data?.overview.agent_rag_pack_summary.find((item) => item.agent_id === lobsterId);

  if (detailQuery.isLoading || overviewQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载主管能力树"
          description="页面会先确认主管详情可用，再补充技能池总览里的能力摘要。"
        />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data?.lobster) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="主管能力树加载失败"
          description="当前没有拿到这个主管的详情数据。请先和后端工程师确认稳定读接口或 mock 代理是否可用。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  if (!profileExists) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="warn"
          title="这个主管还没有能力树配置"
          description="主管详情页存在，但当前前端还没有为该角色补充“主管 -> 细化岗位”的能力树配置。"
          actionHref={`/lobsters/${encodeURIComponent(lobsterId)}`}
          actionLabel="返回主管详情"
        />
      </div>
    );
  }

  if (profile.manages.length === 0) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="empty"
          title="能力树节点为空"
          description="页面框架已经挂好，但这个主管暂时还没有细化岗位节点。"
          actionHref={`/lobsters/${encodeURIComponent(lobsterId)}`}
          actionLabel="返回主管详情"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="龙虾主管区 / 单主管能力树"
        title={`${profile.role.zhName} 不是一个单页实体，而是一位主管和一组细化岗位`}
        description="这页专门解决主管详情页和能力树页关系断裂的问题。主管详情负责看当前状态，这里负责讲清楚这位主管往下管理哪些细化岗位，以及这些岗位如何落到知识面、执行面、协作面和治理面。"
        actions={
          <>
            <Link
              href={`/lobsters/${encodeURIComponent(lobsterId)}`}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              <ArrowLeft className="h-4 w-4" />
              返回主管详情
            </Link>
            <Link
              href="/operations/lobster-config"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开能力配置
              <ChevronRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SurfaceMetric label="细化岗位" value={String(profile.manages.length)} helper="当前这位主管向下管理的岗位节点数" icon={<Sparkles className="h-4 w-4" />} />
        <SurfaceMetric label="技能总数" value={String(profileSummary?.skills_count ?? 0)} helper="来自 skills-pool overview 的角色技能摘要" icon={<Sparkles className="h-4 w-4" />} />
        <SurfaceMetric label="知识包" value={String(ragPackSummary?.pack_count ?? 0)} helper="当前挂到该主管上的知识包数量" icon={<Sparkles className="h-4 w-4" />} />
      </section>

      <IntegrationHelpCard
        description="能力树页如果加载失败，先确认主管详情读接口和 skills overview 是否可达；如果只是某个主管没有细化岗位配置，应显示空态，不算页面报废。"
        modelOwner="AI前端补位"
        readOwner="后端工程师"
        extra="页面关系由主管详情页跳转到能力树页。后续如要把 manages / surfaces 下沉到后端 contract，需要先和项目总控确认范围调整。"
      />

      <SupervisorCapabilityTree profile={profile} />
    </div>
  );
}
