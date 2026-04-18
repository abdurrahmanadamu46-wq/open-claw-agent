'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BrainCircuit,
  Database,
  Network,
  Shield,
  Sparkles,
} from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfacePill,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { fetchLatestReleaseGate } from '@/lib/release-gate-client';
import { fetchSkillImprovementOverview } from '@/services/endpoints/skill-improvements';
import { fetchTenantCockpitOverview } from '@/services/endpoints/tenant-cockpit';
import type { SkillImprovementCommercialOverview } from '@/types/skill-improvements';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatTaskLabel(item: unknown, index: number) {
  const row = asRecord(item);
  return String(row.title ?? row.task ?? row.task_id ?? row.id ?? `task-${index + 1}`);
}

function formatActivityLabel(item: unknown, index: number) {
  const row = asRecord(item);
  return String(row.title ?? row.summary ?? row.type ?? row.id ?? `activity-${index + 1}`);
}

function formatCounts(counts?: Record<string, number>): string {
  const entries = Object.entries(counts || {}).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return '-';
  return entries.map(([key, value]) => `${key}:${value}`).join(' / ');
}

function learningReadinessTone(status?: string): 'ok' | 'warn' | 'neutral' {
  if (status === 'learning_loop_active') return 'ok';
  if (
    status === 'needs_operator_review' ||
    status === 'waiting_for_signals' ||
    status === 'needs_rollback_review' ||
    status === 'has_blocked_proposals'
  ) {
    return 'warn';
  }
  return 'neutral';
}

function learningReadinessText(status?: string): string {
  if (status === 'needs_rollback_review') return '建议回滚复核';
  if (status === 'has_blocked_proposals') return '存在阻断提案';
  if (status === 'needs_operator_review') return '待人工审核';
  if (status === 'learning_loop_active') return '学习闭环运行中';
  if (status === 'waiting_for_signals') return '等待真实信号';
  return status || '-';
}

function resolveLearningLoop(overview?: SkillImprovementCommercialOverview | null) {
  return (
    overview?.summary ?? {
      proposal_total: 0,
      signal_total: 0,
      effect_event_total: 0,
      pending_review: 0,
      ready_to_apply: 0,
      applied: 0,
      rolled_back: 0,
      recommend_rollback: 0,
      readiness_status: 'loading',
    }
  );
}

function LearningOverviewCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'emerald' | 'amber' | 'rose' | 'cyan';
}) {
  const toneClass = {
    emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-500/10 text-rose-100',
    cyan: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.16em] opacity-70">{title}</div>
      <div className="mt-2 text-lg font-semibold">{value || '-'}</div>
      <div className="mt-2 text-xs opacity-80">{detail || '-'}</div>
    </div>
  );
}

export default function TenantCockpitPage() {
  const { currentTenantId, currentTenant } = useTenant();
  const tenantId = currentTenantId || 'tenant_demo';

  const cockpitQuery = useQuery({
    queryKey: ['tenant-cockpit', tenantId],
    queryFn: () => fetchTenantCockpitOverview({ tenant_id: tenantId }),
    retry: false,
    staleTime: 60 * 1000,
  });
  const learningLoopQuery = useQuery({
    queryKey: ['tenant-cockpit', 'skill-improvement-overview', tenantId],
    queryFn: () => fetchSkillImprovementOverview({ tenant_id: tenantId }),
    retry: false,
    staleTime: 60 * 1000,
  });
  const releaseGateQuery = useQuery({
    queryKey: ['tenant-cockpit', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60 * 1000,
  });

  if (cockpitQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载租户 Cockpit"
          description="这里不是链路 A 的主入口，而是把租户 schema、治理预览和商业化验收摘要收口成一个辅助视图。"
        />
      </div>
    );
  }

  if (cockpitQuery.isError || !cockpitQuery.data) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="租户 Cockpit 加载失败"
          description="请先检查 `/api/v1/tenant/cockpit` 的 tenant scope 和服务可达性。"
          actionHref="/"
          actionLabel="回首页"
        />
      </div>
    );
  }

  const cockpit = cockpitQuery.data;
  const learningLoop = learningLoopQuery.data;
  const learningSummary = resolveLearningLoop(learningLoop);
  const learningRecommendation = learningLoop?.global_effect_summary?.recommendation;
  const latestReleaseGate = releaseGateQuery.data?.summary;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="辅助页 / Tenant Cockpit"
        title="这里保留为 schema 详情、治理辅助和商业化验收总览，不再承接链路 A 主入口"
        description="链路 A 现在只认 `/` 作为唯一主入口。tenant-cockpit 的职责是把租户 schema、治理预览、学习闭环和能力摘要聚合成一张辅助总览页。"
        actions={
          <>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              返回首页
            </Link>
            <Link
              href="/governance/capability-routes"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              <Shield className="h-4 w-4" />
              能力路由预览
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.projectCloseout.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
            >
              项目总收口页
            </Link>
          </>
        }
        aside={
          <>
            <SurfacePill label="租户" value={currentTenant?.name || tenantId} />
            <SurfacePill label="生成时间" value={cockpit.generated_at} tone={cockpit.partial ? 'warn' : 'ok'} />
            <SurfacePill label="页面语义" value="schema / 治理 / 验收" />
            <SurfacePill
              label="学习闭环"
              value={learningReadinessText(learningSummary.readiness_status)}
              tone={learningReadinessTone(learningSummary.readiness_status)}
            />
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="策略级别"
          value={String(cockpit.summary.strategy_level)}
          helper={cockpit.summary.strategy_name || '-'}
          icon={<Sparkles className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="任务总数"
          value={String(cockpit.summary.total_tasks)}
          helper={`运行 ${cockpit.summary.running_tasks} / 待处理 ${cockpit.summary.pending_tasks}`}
          icon={<Activity className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="图谱规模"
          value={`${cockpit.summary.graph_nodes}/${cockpit.summary.graph_edges}`}
          helper="nodes / edges"
          icon={<Network className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="能力启用"
          value={String(cockpit.summary.enabled_capabilities)}
          helper={`warnings ${cockpit.summary.warnings_count}`}
          icon={<Shield className="h-4 w-4" />}
        />
      </section>

      <SurfaceSection
        title="Latest release gate"
        description="tenant-cockpit 不直接执行验收，但会把最近一次自动验收结果挂出来，方便从 schema、治理和商业化视角继续判断是否可以收口。"
        actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
        actionLabel="打开收尾清单"
      >
        {releaseGateQuery.isLoading ? (
          <SurfaceStateCard
            kind="loading"
            title="正在读取最近一次 release gate"
            description="这里会把 UI smoke 和本地真实数据 evidence 的合并结果作为治理辅助输入显示出来。"
          />
        ) : releaseGateQuery.isError || !latestReleaseGate ? (
          <SurfaceStateCard
            kind="warn"
            title="最近一次 release gate 暂不可用"
            description="说明最近还没有跑一键验收，或者当前没有可读取的 gate 结果。"
            actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
            actionLabel="去收尾清单查看"
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <LearningOverviewCard
              title="Gate verdict"
              value={latestReleaseGate.ok ? 'pass' : 'needs attention'}
              detail={`ui ${latestReleaseGate.ui_smoke?.metrics?.passed_routes ?? 0}/${latestReleaseGate.ui_smoke?.metrics?.total_routes ?? 0} / data ${latestReleaseGate.data_evidence?.metrics?.required_passed ?? 0}/${latestReleaseGate.data_evidence?.metrics?.required_total ?? 0}`}
              tone={latestReleaseGate.ok ? 'emerald' : 'rose'}
            />
            <LearningOverviewCard
              title="Runtime mode"
              value={String(latestReleaseGate.data_evidence?.runtime_mode || '-')}
              detail={String(latestReleaseGate.data_evidence?.dragon_url || '-')}
              tone="cyan"
            />
            <LearningOverviewCard
              title="Generated"
              value={String(latestReleaseGate.generated_at || '-')}
              detail={releaseGateQuery.data?.artifact_dir || '-'}
              tone="amber"
            />
          </div>
        )}
      </SurfaceSection>

      <SurfaceSection
        title="商业化学习闭环总览"
        description="把双轨记忆、真实信号、Skill 提案、apply/rollback 和效果建议聚合到租户 Cockpit，方便老板和 QA 做一眼验收。"
      >
        {learningLoopQuery.isError ? (
          <SurfaceStateCard
            kind="error"
            title="学习闭环总览加载失败"
            description="请检查 `/api/v1/ai/skills/improvement-overview` 是否可用。主链路不受影响，但商业化验收面板暂时缺少学习闭环聚合。"
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SurfaceMetric
                label="闭环状态"
                value={learningReadinessText(learningSummary.readiness_status)}
                helper={`signals ${learningSummary.signal_total} / proposals ${learningSummary.proposal_total}`}
                icon={<BrainCircuit className="h-4 w-4" />}
              />
              <SurfaceMetric
                label="审核队列"
                value={`${learningSummary.pending_review}/${learningSummary.ready_to_apply}`}
                helper="待复核 / 可应用"
                icon={<Shield className="h-4 w-4" />}
              />
              <SurfaceMetric
                label="上线恢复"
                value={`${learningSummary.applied}/${learningSummary.rolled_back}`}
                helper="已应用 / 已回滚"
                icon={<Sparkles className="h-4 w-4" />}
              />
              <SurfaceMetric
                label="双轨记忆"
                value={`${learningLoop?.dual_track_memory?.resident_count ?? 0}/${learningLoop?.dual_track_memory?.history_count ?? 0}`}
                helper="常驻 / 历史"
                icon={<Database className="h-4 w-4" />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <LearningOverviewCard
                title="效果建议"
                value={
                  learningSummary.recommend_rollback > 0
                    ? `${learningSummary.recommend_rollback} 个建议回滚`
                    : '暂无回滚建议'
                }
                detail={learningRecommendation?.reason || '等待更多 post-apply 观测后再生成建议。'}
                tone={learningSummary.recommend_rollback > 0 ? 'rose' : 'emerald'}
              />
              <LearningOverviewCard
                title="Signal health"
                value={formatCounts(learningLoop?.signal_reason_counts)}
                detail="真实运行、人工反馈和边缘遥测都会在这里汇总 created / skipped 原因。"
                tone="cyan"
              />
              <LearningOverviewCard
                title="Proposal gate"
                value={formatCounts(learningLoop?.proposal_status_counts)}
                detail={`scan ${formatCounts(learningLoop?.scan_status_counts)}`}
                tone={
                  learningSummary.pending_review || learningSummary.ready_to_apply
                    ? 'amber'
                    : 'emerald'
                }
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href={LEARNING_LOOP_ROUTES.skillsImprovements.href}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
              >
                打开 Skill 进化闭环
              </Link>
              <Link
                href={LEARNING_LOOP_ROUTES.memory.href}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100"
              >
                查看双轨记忆
              </Link>
              <Link
                href={LEARNING_LOOP_ROUTES.report.href}
                className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
              >
                打开老板汇报页
              </Link>
            </div>
          </div>
        )}
      </SurfaceSection>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SurfaceSection
          title="治理辅助预览"
          description="tenant-cockpit 继续负责把 capability routes 和 platform feedback 作为治理辅助视图挂出来。"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <SurfaceLinkCard
              href="/governance/capability-routes"
              title="能力路由预览"
              description={`当前预览 ${cockpit.summary.capability_routes_preview} 条。进入后可按 audit record 核对主管能力路由决策。`}
              compact
            />
            <SurfaceLinkCard
              href="/governance/platform-feedback"
              title="平台反馈预览"
              description={`当前预览 ${cockpit.summary.platform_feedback_preview} 条。进入后可按 feedback record 核对平台级经验候选。`}
              compact
            />
          </div>
        </SurfaceSection>

        <SurfaceSection
          title="partial / warning 状态"
          description="cockpit 允许聚合部分失败，但必须显式说明。"
        >
          {cockpit.warnings.length > 0 ? (
            <div className="space-y-2">
              {cockpit.warnings.map((warning) => (
                <div key={warning} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <SurfaceStateCard
              kind="empty"
              title="当前没有 cockpit warning"
              description="这说明 schema 聚合是完整的，适合继续拿来做治理和验收辅助。"
            />
          )}
        </SurfaceSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <SurfaceSection
          title="任务与活动样本"
          description="这里继续展示 schema 返回的样本，用于联调时快速核对数据是否正常。"
        >
          <div className="space-y-3">
            {(cockpit.tasks.items ?? []).slice(0, 5).map((item, index) => (
              <div key={`task-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                <div className="font-medium text-white">{formatTaskLabel(item, index)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  status: {String(asRecord(item).status ?? 'unknown')}
                </div>
              </div>
            ))}
            {(cockpit.tasks.items ?? []).length === 0 ? (
              <SurfaceStateCard
                kind="empty"
                title="当前没有任务样本"
                description="schema 已返回，但当前租户没有任务样本可展示。"
              />
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {(cockpit.activities.items ?? []).slice(0, 3).map((item, index) => (
              <div key={`activity-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                <div className="font-medium text-white">{formatActivityLabel(item, index)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {String(asRecord(item).created_at ?? asRecord(item).updated_at ?? '-')}
                </div>
              </div>
            ))}
          </div>
        </SurfaceSection>

        <SurfaceSection
          title="能力摘要"
          description="tenant-cockpit 继续保留能力与租户 tier 的 schema 可视化能力。"
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <SurfacePill label="tenant tier" value={cockpit.capabilities.tenant_tier || '-'} />
            <SurfacePill
              label="enabled"
              value={`${cockpit.capabilities.enabled_count}/${cockpit.capabilities.total_count}`}
              tone="ok"
            />
          </div>
          <div className="space-y-3">
            {cockpit.capabilities.items.map((item) => (
              <div key={item.key} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-white">{item.key}</div>
                  <div className={item.enabled ? 'text-emerald-200' : 'text-slate-400'}>
                    {item.enabled ? 'enabled' : 'disabled'}
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-400">{item.reason || item.upgrade_required || '-'}</div>
              </div>
            ))}
          </div>
        </SurfaceSection>
      </div>

      <SurfaceSection
        title="继续查看"
        description="如果这页已经说明了租户当前状态，下一步通常会继续走向老板汇报、学习闭环验收或项目总收口。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.report.href}
            title="老板汇报页"
            description="适合一屏讲清当前学习闭环状态、风险、建议和下一步。"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.acceptance.href}
            title="学习闭环验收说明"
            description="适合 QA、项目总控和 AI 员工按步骤执行验收。"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.projectCloseout.href}
            title="项目总收口页"
            description="适合从租户层面继续上升到整个项目层面的最终收口状态。"
            compact
          />
        </div>
      </SurfaceSection>
    </div>
  );
}
