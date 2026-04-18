'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Link2,
  MessageSquare,
  Puzzle,
  ShieldCheck,
} from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { FrontendCloseoutVerificationSection } from '@/components/operations/FrontendCloseoutVerificationSection';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { fetchLatestReleaseGate, resolveLatestFrontendCloseout } from '@/lib/release-gate-client';
import {
  fetchAiSkillsPoolOverview,
  fetchCommercialReadiness,
  fetchKnowledgeBases,
} from '@/services/endpoints/ai-subservice';
import { fetchAdminResources } from '@/services/endpoints/admin-control-panel';
import { fetchGroupCollabContract, fetchGroupCollabSummary } from '@/services/endpoints/group-collab';
import { fetchTenantCockpitOverview } from '@/services/endpoints/tenant-cockpit';

const ENTRY_DECISIONS = [
  {
    title: '链路 A 唯一主入口',
    detail: `从现在起链路 A 只认 \`${LEARNING_LOOP_ROUTES.home.href}\`，产品口径统一叫“${LEARNING_LOOP_ROUTES.home.title}”。`,
  },
  {
    title: `${LEARNING_LOOP_ROUTES.tenantCockpit.title} 的语义`,
    detail: `\`${LEARNING_LOOP_ROUTES.tenantCockpit.href}\` 继续保留为 schema 详情、治理辅助和学习闭环总览页，不再作为链路 A 主入口。`,
  },
  {
    title: 'control-panel 的语义',
    detail: '`/operations/control-panel` 只保留为后台资源 CRUD 和平台控制辅助页，不再承担主入口职责。',
  },
  {
    title: '升级规则',
    detail: '以后任何人想把链路 A 入口挂回 operations，都必须先升级给 AI 收尾总指挥，不能直接改。',
  },
] as const;

const QA_CHECKLIST = [
  {
    page: LEARNING_LOOP_ROUTES.home.href,
    owner: '前端工程师',
    check: `首页文案、导航入口和 QA 起点都必须统一叫“${LEARNING_LOOP_ROUTES.home.title}”。`,
    importance: '高',
    canDefer: '不可后置',
  },
  {
    page: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    owner: 'AI 前端补位',
    check: '只表达 schema 详情、治理辅助和学习闭环总览，不再承接主入口叙事。',
    importance: '中',
    canDefer: '不建议后置',
  },
  {
    page: '/operations/control-panel',
    owner: 'AI 前端补位',
    check: '只表达后台资源和平台控制，不再承接租户总控或演示主入口口径。',
    importance: '中',
    canDefer: '不建议后置',
  },
  {
    page: '/collab',
    owner: 'AI 前端补位 + AI 群协作集成工程师',
    check: '总览必须读取统一 group-collab contract，不允许页面内自造群协作对象模型。',
    importance: '高',
    canDefer: '不可后置',
  },
  {
    page: '/collab/reports',
    owner: 'AI 前端补位 + 后端工程师',
    check: '播报记录必须包含 record、receipt、trace 信息，空态和错误态不能空白。',
    importance: '高',
    canDefer: '不可后置',
  },
  {
    page: '/collab/approvals',
    owner: 'AI 前端补位 + AI 群协作集成工程师',
    check: '待确认项必须来自 pendingItems，并能表达 approval、confirmation、reminder 三类状态。',
    importance: '高',
    canDefer: '不可后置',
  },
  {
    page: '/lobsters/strategist/capabilities',
    owner: 'AI 前端补位',
    check: '能力树必须能看出“主管 -> 细化岗位”，并且有加载态、空态和错误态。',
    importance: '高',
    canDefer: '不可后置',
  },
] as const;

const CONTRACT_GAPS = [
  {
    title: '群协作真实通道回执',
    route: '/collab/reports',
    detail:
      '前端已经消费统一 group-collab record、receipt、trace，但真实群通道的 read receipt、thread id、ack actor 仍需要集成工程师和后端工程师确认字段稳定性。',
    next: '优先确认 receipt.providerMessageId、receipt.state、history.actor、route.chatId 是否足够覆盖飞书和微信群回流。',
  },
  {
    title: '群协作 pendingItems 口径',
    route: '/collab/approvals',
    detail:
      '前端已经按 summary.pendingItems 渲染 approval、confirmation、reminder，但 pendingItems 的排序、过期时间和负责人字段还需要继续稳定。',
    next: '建议补齐 owner、assignee、dueAt、priority，或在 metadata 里给出稳定结构。',
  },
  {
    title: '能力树后端自描述',
    route: '/lobsters/strategist/capabilities',
    detail:
      '能力树页面已经能表达主管和细化岗位，但细化岗位结构仍主要来自前端映射配置。',
    next: '后续可把 manages、knowledgeSurfaces、executionSurfaces、collaborationSurfaces、governanceSurfaces 下沉到后端 contract。',
  },
  {
    title: `${LEARNING_LOOP_ROUTES.tenantCockpit.title} 的辅助页边界`,
    route: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    detail:
      '页面语义已经收敛成 schema 详情、治理辅助和学习闭环总览，但 QA 仍需要确认不再把它当作链路 A 起点。',
    next: `QA 脚本只允许从 \`${LEARNING_LOOP_ROUTES.home.href}\` 开始链路 A，${LEARNING_LOOP_ROUTES.tenantCockpit.title} 只作为辅助检查页。`,
  },
] as const;

const NEXT_HANDSHAKE = [
  {
    step: 'QA 先改链路 A 起点',
    detail: `把链路 A 验收脚本起点统一成 \`${LEARNING_LOOP_ROUTES.home.href}\`，tenant-cockpit 和 control-panel 只作为辅助检查页。`,
    importance: '高',
    canDefer: '不可后置',
  },
  {
    step: 'AI 群协作集成工程师确认 pendingItems / receipt / history 字段',
    detail: '这会决定 collab 三页后续是否只替换真实通道，而不再反复改前端渲染模型。',
    importance: '高',
    canDefer: '不可后置',
  },
  {
    step: '后端工程师稳定 tenant-cockpit 和 admin resources 读接口',
    detail: '这两页已经是辅助页，但联调时仍需要可用读接口，避免 QA 误判页面本身坏了。',
    importance: '中',
    canDefer: '可短暂后置',
  },
  {
    step: '能力树 contract 后续下沉',
    detail: '当前页面已经能演示“主管 -> 细化岗位”，后续再把细化岗位语义移动到后端自描述 contract。',
    importance: '中',
    canDefer: '可后置',
  },
] as const;

export default function FrontendGapsPage() {
  const readinessQuery = useQuery({
    queryKey: ['frontend-gaps', 'readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
    staleTime: 60_000,
  });
  const skillsOverviewQuery = useQuery({
    queryKey: ['frontend-gaps', 'skills-overview'],
    queryFn: () => fetchAiSkillsPoolOverview(),
    retry: false,
    staleTime: 60_000,
  });
  const knowledgeBasesQuery = useQuery({
    queryKey: ['frontend-gaps', 'knowledge-bases'],
    queryFn: fetchKnowledgeBases,
    retry: false,
    staleTime: 60_000,
  });
  const collabContractQuery = useQuery({
    queryKey: ['frontend-gaps', 'collab-contract'],
    queryFn: fetchGroupCollabContract,
    retry: false,
    staleTime: 60_000,
  });
  const collabSummaryQuery = useQuery({
    queryKey: ['frontend-gaps', 'collab-summary'],
    queryFn: fetchGroupCollabSummary,
    retry: false,
    staleTime: 60_000,
  });
  const tenantCockpitQuery = useQuery({
    queryKey: ['frontend-gaps', 'tenant-cockpit'],
    queryFn: () => fetchTenantCockpitOverview(),
    retry: false,
    staleTime: 60_000,
  });
  const adminResourcesQuery = useQuery({
    queryKey: ['frontend-gaps', 'admin-resources'],
    queryFn: fetchAdminResources,
    retry: false,
    staleTime: 60_000,
  });
  const releaseGateQuery = useQuery({
    queryKey: ['frontend-gaps', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60_000,
  });
  const frontendCloseout = resolveLatestFrontendCloseout(releaseGateQuery.data);

  const connectedChecks = [
    {
      title: '商业化 readiness',
      ok: !readinessQuery.isError,
      detail: '用于首页、Header、治理中心和辅助页的状态判断。',
    },
    {
      title: 'skills overview',
      ok: !skillsOverviewQuery.isError,
      detail: `当前返回 ${skillsOverviewQuery.data?.overview.summary.agents_total ?? 0} 个角色摘要。`,
    },
    {
      title: '租户知识库',
      ok: !knowledgeBasesQuery.isError,
      detail: `当前知识库数量 ${knowledgeBasesQuery.data?.count ?? 0}。`,
    },
    {
      title: 'group-collab contract',
      ok: !collabContractQuery.isError,
      detail: collabContractQuery.data?.contractVersion
        ? `当前 contract version: ${collabContractQuery.data.contractVersion}`
        : '用于 collab 三页统一对象模型。',
    },
    {
      title: 'group-collab summary',
      ok: !collabSummaryQuery.isError,
      detail: `待审批 ${collabSummaryQuery.data?.pendingApprovals ?? 0} / 待确认 ${collabSummaryQuery.data?.pendingConfirmations ?? 0} / 催办 ${
        collabSummaryQuery.data?.pendingReminders ?? 0
      }`,
    },
    {
      title: 'tenant-cockpit schema',
      ok: !tenantCockpitQuery.isError,
      detail: tenantCockpitQuery.data?.generated_at
        ? `最近生成时间 ${tenantCockpitQuery.data.generated_at}`
        : '用于 schema 详情和治理辅助页。',
    },
    {
      title: '后台资源目录',
      ok: !adminResourcesQuery.isError,
      detail: `当前资源类型 ${adminResourcesQuery.data?.resources.length ?? 0} 个。`,
    },
  ];

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="治理中心 / 前端联调与 QA 清单"
        title="链路 A 已经收口：只认首页，辅助页只做承接"
        description="这页把最新拍板口径、页面 ownership、联调状态和 QA 验收点收在同一处。它不是链路 A 主入口，而是收尾阶段给前端、QA、AI 群协作集成工程师和后端工程师对齐用的辅助总表。"
        actions={
          <>
            <Link
              href={LEARNING_LOOP_ROUTES.home.href}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              返回{LEARNING_LOOP_ROUTES.home.title}
            </Link>
            <Link
              href="/collab"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white"
            >
              <MessageSquare className="h-4 w-4" />
              打开群协作区
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="冻结决议"
          value={String(ENTRY_DECISIONS.length)}
          helper="链路 A 入口和辅助页口径"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="QA 检查项"
          value={String(QA_CHECKLIST.length)}
          helper="页面验收起点和辅助页边界"
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="待稳定契约"
          value={String(CONTRACT_GAPS.length)}
          helper="主要集中在 collab 和能力树"
          icon={<Puzzle className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="当前可达链路"
          value={String(connectedChecks.filter((item) => item.ok).length)}
          helper="实时读接口健康度概览"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </section>

      <FrontendCloseoutVerificationSection
        description="这里直接显示最近一次前端收尾验证结果。前端同学在排 gap 时，不用再切去别的收尾页确认 build、截图验证和扫描是不是刚刚通过。"
        actionHref={LEARNING_LOOP_ROUTES.projectCloseout.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.projectCloseout.title}`}
        latestResult={frontendCloseout}
      />

      <SurfaceSection
        title="已经冻结的入口口径"
        description="这是前端和 QA 后续不能再漂移的验收口径。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {ENTRY_DECISIONS.map((item) => (
            <StatusCard key={item.title} title={item.title} detail={item.detail} ok />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="QA 可直接照着验的页面清单"
        description="每条都说明谁负责、验什么、重要度如何、能不能后置。"
      >
        <div className="space-y-3">
          {QA_CHECKLIST.map((item) => (
            <div key={item.page} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link href={item.page} className="text-sm font-semibold text-cyan-100 hover:text-cyan-50">
                  {item.page}
                </Link>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-slate-300">
                    {item.owner}
                  </span>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                    重要度：{item.importance}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-slate-300">
                    后置：{item.canDefer}
                  </span>
                </div>
              </div>
              <div className="mt-3 text-sm leading-7 text-slate-300">{item.check}</div>
            </div>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="实时读接口健康度"
        description="这些不是最终协议验收，只是告诉 QA 当前联调时是否有稳定数据源。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connectedChecks.map((item) => (
            <StatusCard key={item.title} title={item.title} detail={item.detail} ok={item.ok} />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="仍需对齐的契约风险"
        description="页面已经能走通，但如果这些字段继续变，后续联调会反复改前端。"
      >
        <div className="space-y-3">
          {CONTRACT_GAPS.map((item) => (
            <GapCard
              key={item.title}
              icon={<Link2 className="h-4 w-4" />}
              title={item.title}
              route={item.route}
              detail={item.detail}
              impact={item.next}
            />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="下一轮推荐推进顺序"
        description="按对 QA 和联调阻塞的影响排序。"
      >
        <div className="space-y-3">
          {NEXT_HANDSHAKE.map((item, index) => (
            <div key={item.step} className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-200">
              <div className="font-semibold text-white">
                步骤 {index + 1} / {item.step}
              </div>
              <div className="mt-2 leading-7">{item.detail}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                  重要度：{item.importance}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-slate-300">
                  是否可后置：{item.canDefer}
                </span>
              </div>
            </div>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="继续收口"
        description="联调辅助页只负责把问题说清楚。真正的 QA 勾选、租户复核、验收说明、老板汇报和项目收口，继续顺着下面这些页往下走。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
            title={LEARNING_LOOP_ROUTES.releaseChecklist.title}
            description={LEARNING_LOOP_ROUTES.releaseChecklist.description}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.tenantCockpit.href}
            title={LEARNING_LOOP_ROUTES.tenantCockpit.title}
            description={LEARNING_LOOP_ROUTES.tenantCockpit.description}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.acceptance.href}
            title={LEARNING_LOOP_ROUTES.acceptance.title}
            description={LEARNING_LOOP_ROUTES.acceptance.description}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.report.href}
            title={LEARNING_LOOP_ROUTES.report.title}
            description={LEARNING_LOOP_ROUTES.report.description}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.projectCloseout.href}
            title={LEARNING_LOOP_ROUTES.projectCloseout.title}
            description={LEARNING_LOOP_ROUTES.projectCloseout.description}
            compact
          />
        </div>
      </SurfaceSection>

      {connectedChecks.some((item) => !item.ok) ? (
        <SurfaceStateCard
          kind="warn"
          title="部分读接口当前不可达"
          description="页面本身不会空白，但如果 QA 需要完整联调，请优先找对应负责人确认读接口或 mock 代理。日常 blocker 先同步 AI 收尾总指挥。"
        />
      ) : null}
    </div>
  );
}

function StatusCard({
  title,
  detail,
  ok,
}: {
  title: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
        {title}
      </div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{detail}</div>
    </div>
  );
}

function GapCard({
  icon,
  title,
  detail,
  impact,
  route,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  impact?: string;
  route?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </div>
      {route ? (
        <div className="mt-2">
          <Link href={route} className="text-xs text-cyan-200 hover:text-cyan-100">
            影响页面：{route}
          </Link>
        </div>
      ) : null}
      <div className="mt-2 text-sm leading-7 text-slate-300">{detail}</div>
      {impact ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200">
          {impact}
        </div>
      ) : null}
    </div>
  );
}
