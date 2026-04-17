'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BrainCircuit,
  Database,
  GitPullRequestArrow,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { FinalExternalGatesGrid, FinalExternalGatesSection } from '@/components/operations/FinalExternalGatesSection';
import { FrontendCloseoutVerificationSection } from '@/components/operations/FrontendCloseoutVerificationSection';
import { LatestReleaseGateSection } from '@/components/operations/LatestReleaseGateSection';
import {
  KnowledgeEvidenceArtifactsCard,
  KnowledgeEvidenceCommandsGrid,
  KnowledgeEvidenceSummaryCard,
} from '@/components/operations/KnowledgeEvidenceSection';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import {
  KNOWLEDGE_EVIDENCE_COMMAND_ITEMS,
  getKnowledgeEvidenceArtifacts,
} from '@/lib/knowledge-evidence';
import {
  fetchLatestReleaseGate,
  type LatestFrontendCloseoutSnapshot,
  resolveLatestFrontendCloseout,
  resolveLatestKnowledgeEvidence,
  type LatestKnowledgeEvidenceSnapshot,
} from '@/lib/release-gate-client';
import { fetchSkillImprovementOverview } from '@/services/endpoints/skill-improvements';

const FINAL_SIGNOFF_GATES = [
  {
    id: 'A-02',
    title: 'Execution monitor real-environment verification',
    owner: 'QA审核',
    status: 'blocked',
    summary: '本地证据包已齐，但真实 control-plane websocket 仍需 QA 最终签收。',
    evidence: 'docs/qa-evidence/A02_EXECUTION_MONITOR_LOCAL_EVIDENCE_2026-04-14',
  },
  {
    id: 'A-03',
    title: 'Group-collab frozen contract signoff',
    owner: 'QA审核 + AI群协作集成工程师',
    status: 'passed',
    summary: 'frozen contract、追溯字段和本地闭环证据已具备。',
    evidence: 'backend/src/integrations/group-collab/FROZEN_CONTRACT.md',
  },
  {
    id: 'A-04',
    title: 'Demo skills freeze recognition',
    owner: 'Skills负责人 + 项目总控',
    status: 'watch',
    summary: 'freeze 已签字，剩发布流程上的正式认可。',
    evidence: 'packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md',
  },
  {
    id: 'A-05',
    title: 'Knowledge boundary and consumer signoff',
    owner: 'QA审核 + 知识库优化负责人',
    status: 'passed',
    summary: 'tenant-private summaries 已能被知识库页、主管页、任务页消费，QA 与知识库侧已通过。',
    evidence: 'backend/test-results/group-collab-closeout-2026-04-13T15-20-02-463Z',
  },
] as const;

function gateTone(status: 'blocked' | 'watch' | 'passed') {
  if (status === 'passed') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
  if (status === 'watch') return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
}

function readinessText(status?: string): string {
  if (status === 'needs_rollback_review') return '建议回滚复核';
  if (status === 'has_blocked_proposals') return '存在阻断提案';
  if (status === 'needs_operator_review') return '待人工审核';
  if (status === 'learning_loop_active') return '学习闭环运行中';
  if (status === 'waiting_for_signals') return '等待真实信号';
  return status || '待确认';
}

function frontendCloseoutSummary(closeout: LatestFrontendCloseoutSnapshot): {
  label: string;
  detail: string;
  tone: 'ok' | 'warn';
} {
  if (!closeout.available) {
    return {
      label: '前端收尾待刷新',
      detail: '最近还没有可读取的一键前端收尾结果，建议先跑命令再进入正式汇报。',
      tone: 'warn',
    };
  }

  if (closeout.ok) {
    return {
      label: '前端收尾已通过',
      detail: `最近一次前端收尾 ${closeout.passedSteps}/${closeout.totalSteps} 全部通过，当前可以把前端状态视为已完成一轮正式复验。`,
      tone: 'ok',
    };
  }

  return {
    label: '前端收尾待关注',
    detail: `最近一次前端收尾还有 ${closeout.failedSteps} 个失败步骤，建议先看 closeout artifact 再对外汇报。`,
    tone: 'warn',
  };
}

function buildReportMarkdown(input: {
  tenantName: string;
  readiness: string;
  proposalTotal: number;
  signalTotal: number;
  effectEventTotal: number;
  pendingReview: number;
  readyToApply: number;
  applied: number;
  rolledBack: number;
  recommendRollback: number;
  residentCount: number;
  historyCount: number;
  recommendation: string;
  knowledgeEvidence: LatestKnowledgeEvidenceSnapshot;
  frontendCloseout: LatestFrontendCloseoutSnapshot;
}): string {
  const closeout = frontendCloseoutSummary(input.frontendCloseout);
  return [
    '# OpenClaw 学习闭环老板汇报摘要',
    '',
    `- 租户: ${input.tenantName}`,
    `- 当前状态: ${input.readiness}`,
    `- 真实信号: ${input.signalTotal}`,
    `- Skill 提案: ${input.proposalTotal}`,
    `- 效果事件: ${input.effectEventTotal}`,
    `- 待审核 / 可应用: ${input.pendingReview} / ${input.readyToApply}`,
    `- 已应用 / 已回滚: ${input.applied} / ${input.rolledBack}`,
    `- 建议回滚数: ${input.recommendRollback}`,
    `- 双轨记忆 resident / history: ${input.residentCount} / ${input.historyCount}`,
    `- 前端收尾: ${closeout.label}`,
    '',
    '## 当前判断',
    input.recommendation,
    '',
    '## 前端交付一句话',
    closeout.detail,
    ...(input.frontendCloseout.available
      ? [
          `- closeout artifact: ${input.frontendCloseout.artifactDir || '-'}`,
          `- screenshot artifact: ${input.frontendCloseout.screenshotArtifactDir || '-'}`,
          `- operations scan artifact: ${input.frontendCloseout.operationsScanArtifactDir || '-'}`,
        ]
      : []),
    '',
    '## A-05 知识三层真实消费证据',
    `- mode: ${input.knowledgeEvidence.mode}`,
    `- seed_strategy: ${input.knowledgeEvidence.seedStrategy}`,
    `- platform_common: ${input.knowledgeEvidence.platformCommon}`,
    `- platform_industry: ${input.knowledgeEvidence.platformIndustry}`,
    `- tenant_private: ${input.knowledgeEvidence.tenantPrivate}`,
    `- raw traces excluded: ${input.knowledgeEvidence.rawTraceExcluded}`,
    `- summary only: ${input.knowledgeEvidence.summaryOnly}`,
    `- backflow blocked: ${input.knowledgeEvidence.backflowBlocked}`,
    '',
    '### 验证命令',
    ...KNOWLEDGE_EVIDENCE_COMMAND_ITEMS.map((item, index) => `${index + 1}. ${item.command}`),
    '',
    '### 证据文件',
    '- docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md',
    ...(input.knowledgeEvidence.reportPath ? [`- ${input.knowledgeEvidence.reportPath}`] : []),
    '',
    '## 说明',
    '- 这是一套受控学习闭环，不是自动乱改 Skill。',
    '- 所有补丁都要先提案、扫描、审批，再 apply；apply 之后还能 rollback。',
    '- 运行结果、人工反馈和边缘遥测会继续回流，形成效果观察。',
  ].join('\n');
}

export default function LearningLoopReportPage() {
  const { currentTenantId, currentTenant } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const [copyMessage, setCopyMessage] = useState('');

  const overviewQuery = useQuery({
    queryKey: ['learning-loop-report', tenantId],
    queryFn: () => fetchSkillImprovementOverview({ tenant_id: tenantId }),
    retry: false,
    staleTime: 60 * 1000,
  });
  const releaseGateQuery = useQuery({
    queryKey: ['learning-loop-report', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60 * 1000,
  });
  const knowledgeEvidence = resolveLatestKnowledgeEvidence(releaseGateQuery.data);
  const frontendCloseout = resolveLatestFrontendCloseout(releaseGateQuery.data);

  async function copyReport() {
    if (!overviewQuery.data) return;
    try {
      await navigator.clipboard.writeText(
        buildReportMarkdown({
          tenantName: currentTenant?.name || tenantId,
          readiness: readinessText(overviewQuery.data.summary.readiness_status),
          proposalTotal: overviewQuery.data.summary.proposal_total,
          signalTotal: overviewQuery.data.summary.signal_total,
          effectEventTotal: overviewQuery.data.summary.effect_event_total,
          pendingReview: overviewQuery.data.summary.pending_review,
          readyToApply: overviewQuery.data.summary.ready_to_apply,
          applied: overviewQuery.data.summary.applied,
          rolledBack: overviewQuery.data.summary.rolled_back,
          recommendRollback: overviewQuery.data.summary.recommend_rollback,
          residentCount: overviewQuery.data.dual_track_memory.resident_count,
          historyCount: overviewQuery.data.dual_track_memory.history_count,
          recommendation:
            overviewQuery.data.global_effect_summary.recommendation?.reason ||
            '当前没有明显风险，建议继续观察更多效果数据。',
          knowledgeEvidence,
          frontendCloseout,
        }),
      );
      setCopyMessage('已复制老板汇报页 Markdown 摘要');
    } catch {
      setCopyMessage('复制失败，请检查浏览器剪贴板权限');
    }
  }

  if (overviewQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在生成学习闭环老板摘要"
          description="这里会把学习闭环状态压缩成适合老板或项目总控查看的一屏摘要。"
        />
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="学习闭环老板摘要加载失败"
          description="请先检查 `/api/v1/ai/skills/improvement-overview` 是否可用。"
          actionHref={LEARNING_LOOP_ROUTES.tenantCockpit.href}
          actionLabel="回租户 Cockpit"
        />
      </div>
    );
  }

  const overview = overviewQuery.data;
  const recommendation = overview.global_effect_summary.recommendation;
  const latestReleaseGate = releaseGateQuery.data?.summary;
  const closeoutSummary = frontendCloseoutSummary(frontendCloseout);

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Executive Summary / Learning Loop"
        title="学习闭环老板汇报页"
        description="这页不讲操作细节，只回答老板最关心的问题：经验有没有沉淀、真实信号有没有进来、Skill 是否受控改进、上线后的效果有没有变好、现在是否需要人工介入。"
        actions={
          <>
            <button
              type="button"
              onClick={() => void copyReport()}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              复制 Markdown 汇报摘要
            </button>
            <Link
              href={LEARNING_LOOP_ROUTES.tenantCockpit.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开租户 Cockpit
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100"
            >
              打开 QA 清单
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.projectCloseout.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
            >
              打开项目总收口页
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.frontendGaps.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-sm font-medium text-sky-100"
            >
              打开{LEARNING_LOOP_ROUTES.frontendGaps.title}
            </Link>
          </>
        }
      />

      {copyMessage ? <div className="text-sm text-cyan-200">{copyMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="闭环状态"
          value={readinessText(overview.summary.readiness_status)}
          helper={`signals ${overview.summary.signal_total} / proposals ${overview.summary.proposal_total}`}
          icon={<BrainCircuit className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="审核与应用"
          value={`${overview.summary.pending_review}/${overview.summary.ready_to_apply}`}
          helper="待审核 / 可应用"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="上线恢复"
          value={`${overview.summary.applied}/${overview.summary.rolled_back}`}
          helper="已应用 / 已回滚"
          icon={<GitPullRequestArrow className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="双轨记忆"
          value={`${overview.dual_track_memory.resident_count}/${overview.dual_track_memory.history_count}`}
          helper="resident / history"
          icon={<Database className="h-4 w-4" />}
        />
      </section>

      <SurfaceSection
        title="前端交付一句话"
        description="这块专门回答老板和项目总控常问的那个问题：现在前端这条线，到底能不能当成收好了。"
        actionHref={LEARNING_LOOP_ROUTES.deliveryHub.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.deliveryHub.title}`}
      >
        <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
          <div
            className={`rounded-2xl border p-5 ${
              closeoutSummary.tone === 'ok'
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                : 'border-amber-400/25 bg-amber-500/10 text-amber-100'
            }`}
          >
            <div className="text-xs uppercase tracking-[0.18em] opacity-75">Frontend closeout</div>
            <div className="mt-2 text-2xl font-semibold">{closeoutSummary.label}</div>
            <div className="mt-3 text-sm leading-7 opacity-90">{closeoutSummary.detail}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SurfaceMetric
              label="收尾步骤"
              value={`${frontendCloseout.passedSteps}/${frontendCloseout.totalSteps}`}
              helper="最近一次一键前端收尾通过数"
            />
            <SurfaceMetric
              label="最新时间"
              value={frontendCloseout.generatedAt}
              helper="最近一次收尾产物时间"
            />
            <SurfaceLinkCard
              href={LEARNING_LOOP_ROUTES.deliveryHub.href}
              title="打开交付页"
              description="看 closeout artifact、截图证据和 operations 巡检的完整路径。"
              compact
            />
            <SurfaceLinkCard
              href={LEARNING_LOOP_ROUTES.projectCloseout.href}
              title="打开项目总收口页"
              description="如果要把学习闭环结论继续上升到项目级结论，从这里继续。"
              compact
            />
          </div>
        </div>
      </SurfaceSection>

      <LatestReleaseGateSection
        title="Latest release gate"
        description="老板汇报页不直接执行验收，但会把最近一次自动验收结果挂出来，避免汇报内容和真实验收状态脱节。"
        actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
        actionLabel="打开收尾清单"
        isLoading={releaseGateQuery.isLoading}
        isError={releaseGateQuery.isError}
        latestGate={latestReleaseGate}
        artifactDir={releaseGateQuery.data?.artifact_dir}
        loadingTitle="正在读取最近一次 release gate"
        loadingDescription="这里会把 UI smoke 和本地真实数据 evidence 的合并结果作为老板汇报页的可信背景。"
        unavailableTitle="最近一次 release gate 暂不可用"
        unavailableDescription="说明最近还没有跑一键验收，或者当前没有可读取的 gate 结果。"
        positiveSummary="最近一次自动验收已经通过，说明老板汇报页里的结论和当前自动验收状态是一致的，可以更放心地用于收尾汇报。"
        negativeSummary="最近一次自动验收还有阻塞，老板汇报页当前更适合作为风险沟通材料，而不是对外交付结论。"
      />

      <FrontendCloseoutVerificationSection
        description="这块把前端收尾验证也翻译成老板能理解的动作入口：一条命令就能复验当前前端是否还能稳定 build、还能跑通收尾演示链路。"
        actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.frontendGaps.title}`}
        latestResult={frontendCloseout}
      />

      <SurfaceSection
        title="一句话判断"
        description="这块适合老板或项目总控快速判断现在是继续推进、继续观察，还是需要人工介入。"
      >
        <div
          className={`rounded-2xl border p-5 ${
            recommendation?.action === 'recommend_rollback'
              ? 'border-rose-400/25 bg-rose-500/10 text-rose-100'
              : recommendation?.action === 'keep_applied'
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                : 'border-amber-400/25 bg-amber-500/10 text-amber-100'
          }`}
        >
          <div className="text-xs uppercase tracking-[0.18em] opacity-75">Recommendation</div>
          <div className="mt-2 text-2xl font-semibold">
            {recommendation?.action === 'recommend_rollback'
              ? '建议人工回滚复核'
              : recommendation?.action === 'keep_applied'
                ? '建议保持当前改动'
                : '建议继续观察'}
          </div>
          <div className="mt-3 text-sm leading-7 opacity-90">
            {recommendation?.reason || '当前观测数据还不够，建议继续观察更多运行与反馈结果。'}
          </div>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="A-05 知识三层真实消费"
        description="这里回答老板和总控最关心的一件事：知识边界不只是停留在页面展示，而是真的已经进入运行时，被主管 / 任务消费。"
      >
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <KnowledgeEvidenceSummaryCard
            snapshot={knowledgeEvidence}
            title={knowledgeEvidence.available && knowledgeEvidence.ok ? '知识三层已真实进运行时' : '知识三层证据待刷新'}
            summaryText={`${
              knowledgeEvidence.available
                ? `当前最新样本满足 ${knowledgeEvidence.mode} / ${knowledgeEvidence.seedStrategy}，tenant_private = ${knowledgeEvidence.tenantPrivate}。`
                : '最近一次 release gate 里还没有可读取的知识证据样本，先跑 local runtime evidence 再回来刷新。'
            } 同时仍然保持 raw trace 不进 platform、只允许脱敏 summary 进入 tenant private。`}
            showPills
          />
          <div className="space-y-4">
            <KnowledgeEvidenceCommandsGrid commands={KNOWLEDGE_EVIDENCE_COMMAND_ITEMS} />
            <KnowledgeEvidenceArtifactsCard paths={getKnowledgeEvidenceArtifacts(knowledgeEvidence)} />
          </div>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="老板最该看这三件事"
        description="如果只剩一分钟，这三块最值得记。"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.skillsImprovements.href}
            title="真实信号是否进入闭环"
            description={`当前共有 ${overview.summary.signal_total} 条真实信号进入学习闭环，created / skipped 原因都可追踪。`}
            icon={<Sparkles className="h-5 w-5" />}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.skillsImprovements.href}
            title="Skill 是否受控改进"
            description={`当前待审核 ${overview.summary.pending_review} 条，可应用 ${overview.summary.ready_to_apply} 条；不是自动乱改。`}
            icon={<ShieldCheck className="h-5 w-5" />}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.memory.href}
            title="经验是否真的沉淀"
            description={`resident ${overview.dual_track_memory.resident_count} / history ${overview.dual_track_memory.history_count}，说明经验不是临时聊天内容。`}
            icon={<Database className="h-5 w-5" />}
            compact
          />
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="继续查看"
        description="汇报完成后，通常会继续进入验收说明或项目总收口页。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.acceptance.href}
            title="学习闭环验收说明"
            description="适合给 QA、项目总控和 AI 员工按步骤执行验收。"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.projectCloseout.href}
            title="项目总收口页"
            description="适合从学习闭环继续上升到整个项目层面的收口状态。"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
            title="QA 最终勾选清单"
            description="如果汇报后要转入正式验收，直接从这里进入最终勾选清单。"
            compact
          />
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="Final external gates"
        description="如果只看老板视角，当前正式收尾真正剩下的就是这些外部签收门禁。这里和收尾页、QA 清单页保持同一套口径。"
      >
        <FinalExternalGatesGrid />
      </SurfaceSection>
    </div>
  );
}
