'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Database, LibraryBig, Sparkles } from 'lucide-react';
import { CompositionDepthPanel } from '@/components/operations/CompositionDepthPanel';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfacePill,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchLiveFirstIndustryTaxonomy,
  flattenIndustryTaxonomy,
  formatIndustryDisplayValue,
  LOCAL_INDUSTRY_TAXONOMY_SNAPSHOT,
  resolveIndustryDisplay,
} from '@/lib/live-industry-taxonomy';
import { fetchControlPlaneKnowledgeOverview } from '@/services/endpoints/control-plane-overview';

export default function PlatformIndustriesPage() {
  const { currentTenant, currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';

  const taxonomyQuery = useQuery({
    queryKey: ['knowledge', 'platform-industries', 'taxonomy'],
    queryFn: fetchLiveFirstIndustryTaxonomy,
    placeholderData: LOCAL_INDUSTRY_TAXONOMY_SNAPSHOT,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const overviewQuery = useQuery({
    queryKey: ['knowledge', 'platform-industries', 'overview', tenantId],
    queryFn: () => fetchControlPlaneKnowledgeOverview({ tenant_id: tenantId }),
    staleTime: 60_000,
    retry: false,
  });

  const taxonomy = useMemo(() => taxonomyQuery.data?.taxonomy ?? [], [taxonomyQuery.data?.taxonomy]);
  const taxonomySource = taxonomyQuery.data?.source ?? 'local';
  const allSubIndustries = useMemo(() => flattenIndustryTaxonomy(taxonomy), [taxonomy]);
  const normalizedIndustryTag = String(currentTenant?.industryType || '').trim().toLowerCase();
  const currentIndustry = allSubIndustries.find((row) => row.tag === normalizedIndustryTag) ?? null;
  const currentIndustryDisplay = resolveIndustryDisplay({
    tag: currentTenant?.industryType,
    taxonomy,
    source: taxonomySource,
    fallbackLabel: currentTenant?.industryType,
  });
  const currentIndustryValue = formatIndustryDisplayValue(currentIndustryDisplay, {
    localFallbackLabel: '本地回退',
    rawFallbackLabel: '未映射标签',
    emptyLabel: '待配置',
  });
  const coveredIndustries = useMemo(
    () =>
      Object.entries(
        overviewQuery.data?.skills_pool?.overview?.workflow_templates_by_industry ?? {},
      ),
    [overviewQuery.data?.skills_pool?.overview?.workflow_templates_by_industry],
  );
  const topCategories = useMemo(
    () =>
      taxonomy.map((category) => ({
        ...category,
        templateCount: coveredIndustries
          .filter(([tag]) => category.sub_industries.some((item) => item.tag === tag))
          .reduce((sum, [, count]) => sum + Number(count || 0), 0),
      })),
    [coveredIndustries, taxonomy],
  );

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="知识区 / 平台行业知识"
        title="先把平台行业知识讲清楚，再把它落到每个租户自己的知识资产里"
        description="这页优先消费 live taxonomy contract 和 control-plane knowledge overview。行业目录如果还没切到服务端真相源，页面会明确标出本地回退，避免把本地快照误讲成线上契约。"
        actions={
          <>
            <Link
              href="/operations/knowledge-base"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              <Database className="h-4 w-4" />
              打开租户知识库
            </Link>
            <Link
              href="/ai-brain/prompt-lab"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              <Sparkles className="h-4 w-4" />
              打开 Prompt / 能力包
            </Link>
          </>
        }
        aside={
          <>
            <SurfacePill label="当前租户" value={currentTenant?.name || '未命名租户'} />
            <SurfacePill
              label="当前行业"
              value={currentIndustryValue}
              tone={
                currentIndustryDisplay.source === 'live'
                  ? 'ok'
                  : currentIndustryDisplay.source === 'empty'
                    ? 'neutral'
                    : 'warn'
              }
            />
            <SurfacePill
              label="对象存储"
              value={overviewQuery.data?.summary.storage_provider ? '已配置' : '待联调'}
            />
            <SurfacePill label="平台目录" value={`${allSubIndustries.length} 个子行业`} />
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="行业大类"
          value={String(taxonomy.length)}
          helper="平台级行业目录的一层分类数量"
          icon={<LibraryBig className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="子行业"
          value={String(allSubIndustries.length)}
          helper={
            taxonomySource === 'live'
              ? '来自 live taxonomy contract'
              : '当前仍在本地 taxonomy 回退'
          }
          icon={<BookOpenText className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="模板覆盖"
          value={String(coveredIndustries.length)}
          helper="skills overview 已覆盖的行业标签数量"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="租户知识库"
          value={String(overviewQuery.data?.summary.knowledge_base_count ?? 0)}
          helper="当前租户已经建立的私有知识库数量"
          icon={<Database className="h-4 w-4" />}
        />
      </section>

      <CompositionDepthPanel
        title="Platform Industries Wiring Depth"
        summary="This page is live taxonomy-first. It reads one aggregated knowledge overview contract, and it makes taxonomy fallback explicit instead of silently assembling a local-first view."
        items={[
          {
            label: 'industry taxonomy',
            mode: taxonomySource === 'live' ? 'live' : 'local',
            detail:
              taxonomySource === 'live'
                ? 'Read from the live industry taxonomy contract.'
                : 'Rendered from the local fallback snapshot because the live taxonomy contract is unavailable.',
          },
          {
            label: 'knowledge overview',
            mode: 'live',
            detail: 'Read from one live control-plane knowledge overview contract.',
          },
          {
            label: 'page assembly',
            mode: 'composed',
            detail: 'The page combines platform taxonomy coverage and tenant knowledge state for presentation.',
          },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[0.96fr_1.04fr]">
        <SurfaceSection
          title="当前租户行业镜像"
          description="演示时这里最适合解释：平台行业知识是地基，真正接到租户交付，还要落到租户知识库和 Prompt / 能力包。"
        >
          {currentIndustry ? (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {currentIndustry.category_name}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">{currentIndustry.name}</div>
                <div className="mt-3 text-sm leading-7 text-slate-300">
                  当前行业标签是 `{currentIndustry.tag}`。它会影响 starter kit、行业知识包和后续角色上下文注入。
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <MiniList
                  title="常见痛点"
                  items={currentIndustry.schema.pain_points}
                  emptyLabel="当前目录里还没有写细分痛点。"
                />
                <MiniList
                  title="风险动作"
                  items={currentIndustry.schema.risk_behaviors}
                  emptyLabel="当前目录里还没有写风险动作。"
                />
              </div>
            </div>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="当前租户还没有绑定行业"
              description="没有行业标签时，知识区仍然可以展示平台目录结构，但 starter kit 和知识路由会退回通用模式。"
              actionHref="/onboard"
              actionLabel="去补行业首启"
            />
          )}
        </SurfaceSection>

        <SurfaceSection
          title="平台行业目录"
          description="这里优先听 live taxonomy contract，并叠加 live coverage 统计。"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {topCategories.map((category) => (
              <div key={category.category_tag} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{category.category_name}</div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                    子行业 {category.sub_industries.length}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">模板命中 {category.templateCount}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {category.sub_industries.slice(0, 4).map((item) => (
                    <span key={item.tag} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
                      {item.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SurfaceSection>
      </section>

      <SurfaceSection
        title="从平台知识到租户知识的承接"
        description="平台行业知识负责共性，租户知识库负责私有资产，Prompt / 能力包负责把知识真正挂到角色上。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SurfaceLinkCard
            href="/operations/knowledge-base"
            title="租户知识库"
            description="录入品牌手册、SOP、案例和私有交付资产，让角色运行时能真实检索到租户上下文。"
            icon={<Database className="h-5 w-5" />}
            eyebrow="Tenant Knowledge"
            compact
          />
          <SurfaceLinkCard
            href="/ai-brain/prompt-lab"
            title="Prompt / 能力包"
            description="把行业知识、角色 Prompt 和 RAG 包接到主管角色上，形成真正能工作的能力组合。"
            icon={<Sparkles className="h-5 w-5" />}
            eyebrow="Prompt Packs"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.memory.href}
            title="经验沉淀"
            description="把 L0 / L1 / L2 记忆沉淀接起来，避免每次演示都像从零开始。"
            icon={<LibraryBig className="h-5 w-5" />}
            eyebrow="Memory Layers"
            compact
          />
        </div>
      </SurfaceSection>

      {overviewQuery.isError ? (
        <SurfaceStateCard
          kind="warn"
          title="知识概览暂时不可用"
          description="行业目录仍然可以展示，但租户知识状态和模板覆盖度需要等 control-plane knowledge overview 恢复。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      ) : null}

      {taxonomySource === 'local' ? (
        <SurfaceStateCard
          kind="warn"
          title="平台行业 taxonomy 当前仍在本地回退"
          description="页面展示没有中断，但这也说明平台行业目录此刻还没有完全切到服务端真相源。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      ) : null}
    </div>
  );
}

function MiniList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
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
