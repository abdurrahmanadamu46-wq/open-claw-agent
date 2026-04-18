'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BrainCircuit,
  ClipboardCheck,
  Database,
  Waypoints,
} from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfacePill,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import {
  KnowledgeEvidenceArtifactsCard,
  KnowledgeEvidenceCommandsGrid,
  KnowledgeEvidenceRulesCard,
} from '@/components/operations/KnowledgeEvidenceSection';
import { FinalExternalGatesGrid } from '@/components/operations/FinalExternalGatesSection';
import { FrontendCloseoutVerificationSection } from '@/components/operations/FrontendCloseoutVerificationSection';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import {
  KNOWLEDGE_EVIDENCE_COMMAND_ITEMS,
  KNOWLEDGE_EVIDENCE_COMMANDS,
  KNOWLEDGE_EVIDENCE_PASS_RULES,
  KNOWLEDGE_EVIDENCE_RUNBOOK_PATH,
  getKnowledgeEvidenceSnapshotText,
  getKnowledgeEvidenceArtifacts,
} from '@/lib/knowledge-evidence';
import { formatFrontendCloseoutSummaryAsMarkdownList } from '@/lib/frontend-closeout-summary';
import {
  fetchLatestReleaseGate,
  resolveLatestFrontendCloseout,
  resolveLatestKnowledgeEvidence,
  type LatestKnowledgeEvidenceSnapshot,
} from '@/lib/release-gate-client';

const MAINLINES = [
  {
    title: '主入口已统一',
    value: '`/` 为唯一主入口',
    helper: 'tenant-cockpit 和 control-panel 都已收缩为辅助页',
    icon: <Waypoints className="h-4 w-4" />,
  },
  {
    title: '学习闭环已形成',
    value: 'memory -> signal -> proposal -> apply/rollback',
    helper: '不是自动乱改，而是受控改进',
    icon: <BrainCircuit className="h-4 w-4" />,
  },
  {
    title: '验收与汇报已具备',
    value: 'QA checklist + acceptance + report',
    helper: '已经不是只能靠聊天解释',
    icon: <ClipboardCheck className="h-4 w-4" />,
  },
  {
    title: '双轨记忆已沉淀',
    value: 'resident + history',
    helper: '常驻小记忆 + 大而可检索历史',
    icon: <Database className="h-4 w-4" />,
  },
] as const;

const ENTRYPOINTS = [
  {
    href: LEARNING_LOOP_ROUTES.home.href,
    title: LEARNING_LOOP_ROUTES.home.title,
    description: LEARNING_LOOP_ROUTES.home.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    title: LEARNING_LOOP_ROUTES.tenantCockpit.title,
    description: LEARNING_LOOP_ROUTES.tenantCockpit.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.skillsImprovements.href,
    title: LEARNING_LOOP_ROUTES.skillsImprovements.title,
    description: LEARNING_LOOP_ROUTES.skillsImprovements.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.memory.href,
    title: LEARNING_LOOP_ROUTES.memory.title,
    description: LEARNING_LOOP_ROUTES.memory.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.releaseChecklist.href,
    title: LEARNING_LOOP_ROUTES.releaseChecklist.title,
    description: LEARNING_LOOP_ROUTES.releaseChecklist.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.deliveryHub.href,
    title: LEARNING_LOOP_ROUTES.deliveryHub.title,
    description: LEARNING_LOOP_ROUTES.deliveryHub.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.report.href,
    title: LEARNING_LOOP_ROUTES.report.title,
    description: LEARNING_LOOP_ROUTES.report.description,
  },
  {
    href: LEARNING_LOOP_ROUTES.frontendGaps.href,
    title: LEARNING_LOOP_ROUTES.frontendGaps.title,
    description: LEARNING_LOOP_ROUTES.frontendGaps.description,
  },
] as const;

const PROJECT_BOUNDARIES = [
  '边缘层只执行，不做视频合成，不做学习决策。',
  '龙虾仍然是统一运行时里的角色协议，不是独立 agent。',
  'Skill 提案必须 scan + approve 之后才能 apply。',
  'recommend_rollback 只是建议，不会自动触发 rollback。',
  '租户私有记忆不允许静默上流成平台知识。',
] as const;

const FRONTEND_CLOSEOUT_STATUS = [
  {
    title: '入口与路径',
    status: '已收口',
    detail: '首页、租户 Cockpit、学习闭环页、QA 清单、老板汇报页、项目总收口页和前端联调辅助总表已经串成一套入口网络。',
  },
  {
    title: '主链路页面',
    status: '已收口',
    detail: '学习闭环、双轨记忆、验收说明、汇报页和租户总览都已进入可演示、可验收状态。',
  },
  {
    title: '业务页接线',
    status: '已收口',
    detail: 'collab、knowledge、lobsters 等高频业务页已经切到统一入口常量，不再靠硬编码路径维持。',
  },
  {
    title: '剩余工作',
    status: '仅剩复核',
    detail: '当前主要剩最后一轮人工复看和演示 polish，不再是结构性开发。',
  },
] as const;

function summarizeFrontendCloseout(closeout: ReturnType<typeof resolveLatestFrontendCloseout>) {
  return {
    label: closeout.available ? (closeout.ok ? '已通过' : '待关注') : '待刷新',
    tone: closeout.available && closeout.ok ? ('ok' as const) : ('warn' as const),
    stepsText: `${closeout.passedSteps}/${closeout.totalSteps}`,
    screenshotText: `${closeout.frontendCriticalPassed}/${closeout.frontendCriticalTotal}`,
    operationsText: `${closeout.operationsScanCovered}/${closeout.operationsScanTotal}`,
    generatedAt: closeout.generatedAt,
    artifactReady: closeout.artifactDir ? '已挂载' : '待刷新',
  };
}

function buildProjectCloseoutMarkdown(
  knowledgeEvidence: LatestKnowledgeEvidenceSnapshot,
  frontendCloseout: ReturnType<typeof resolveLatestFrontendCloseout>,
): string {
  const closeoutLabel = frontendCloseout.available
    ? frontendCloseout.ok
      ? '已通过'
      : '待关注'
    : '待刷新';

  return [
    '# OpenClaw 项目总收口摘要',
    '',
    '## 当前结论',
    '- 主入口已经统一到 `/`',
    '- 学习闭环已形成并可演示',
    '- QA 清单与验收说明已具备',
    '- 老板汇报页已具备',
    `- 前端一键收尾${closeoutLabel}（${frontendCloseout.passedSteps}/${frontendCloseout.totalSteps}）`,
    '',
    '## 建议查看入口',
    ...ENTRYPOINTS.map(
      (item, index) =>
        `${index + 1}. ${item.title}\n   - 路径: ${item.href}\n   - 说明: ${item.description}`,
    ),
    '',
    '## 前端收口状态',
    ...FRONTEND_CLOSEOUT_STATUS.map(
      (item) => `- ${item.title}: ${item.status}\n  - ${item.detail}`,
    ),
    '',
    '## 最新前端一键收尾',
    ...formatFrontendCloseoutSummaryAsMarkdownList(frontendCloseout),
    '',
    '## 当前红线',
    ...PROJECT_BOUNDARIES.map((item) => `- ${item}`),
    '',
    '## A-05 知识三层签收',
    ...KNOWLEDGE_EVIDENCE_COMMANDS.map((item, index) => `${index + 1}. ${item}`),
    '',
    '### 通过标准',
    ...KNOWLEDGE_EVIDENCE_PASS_RULES.map((item) => `- ${item}`),
    '',
    '### 样本与文档',
    `- ${KNOWLEDGE_EVIDENCE_RUNBOOK_PATH}`,
    ...(knowledgeEvidence.reportPath ? [`- ${knowledgeEvidence.reportPath}`] : []),
    '',
    '## 仓库文档',
    '- docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md',
    '- docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
  ].join('\n');
}

export default function ProjectCloseoutPage() {
  const [copyMessage, setCopyMessage] = useState('');
  const releaseGateQuery = useQuery({
    queryKey: ['project-closeout', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60 * 1000,
  });

  const latestReleaseGate = releaseGateQuery.data?.summary;
  const knowledgeEvidence = resolveLatestKnowledgeEvidence(releaseGateQuery.data);
  const frontendCloseout = resolveLatestFrontendCloseout(releaseGateQuery.data);
  const frontendCloseoutSummary = summarizeFrontendCloseout(frontendCloseout);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildProjectCloseoutMarkdown(knowledgeEvidence, frontendCloseout));
      setCopyMessage('已复制项目总收口 Markdown 摘要');
    } catch {
      setCopyMessage('复制失败，请检查浏览器剪贴板权限');
    }
  }

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Project Closeout / Final Handoff"
        title="项目总收口页"
        description="这页不是操作台，而是把整个项目当前已经收口的主线、入口、边界和交付状态压缩成一张总览图。适合项目总控、老板、QA 和后续接手同学快速建立共识。"
        actions={
          <>
            <button
              type="button"
              onClick={() => void copySummary()}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              复制项目总收口摘要
            </button>
            <Link
              href={LEARNING_LOOP_ROUTES.report.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开{LEARNING_LOOP_ROUTES.report.title}
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.acceptance.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100"
            >
              打开{LEARNING_LOOP_ROUTES.acceptance.title}
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100"
            >
              打开{LEARNING_LOOP_ROUTES.releaseChecklist.title}
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.deliveryHub.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/25 bg-indigo-400/10 px-4 py-3 text-sm font-medium text-indigo-100"
            >
              打开{LEARNING_LOOP_ROUTES.deliveryHub.title}
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.tenantCockpit.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
            >
              打开{LEARNING_LOOP_ROUTES.tenantCockpit.title}
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.frontendGaps.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-sm font-medium text-sky-100"
            >
              打开{LEARNING_LOOP_ROUTES.frontendGaps.title}
            </Link>
          </>
        }
        aside={
          <>
            <SurfacePill
              label="前端收尾"
              value={frontendCloseoutSummary.label}
              tone={frontendCloseoutSummary.tone}
            />
            <SurfacePill label="收尾步骤" value={frontendCloseoutSummary.stepsText} />
            <SurfacePill
              label="截图覆盖"
              value={frontendCloseoutSummary.screenshotText}
              tone={frontendCloseout.frontendCriticalTotal > 0 && frontendCloseout.frontendCriticalPassed === frontendCloseout.frontendCriticalTotal ? 'ok' : 'warn'}
            />
            <SurfacePill
              label="operations 覆盖"
              value={frontendCloseoutSummary.operationsText}
              tone={frontendCloseout.operationsScanTotal > 0 && frontendCloseout.operationsScanCovered === frontendCloseout.operationsScanTotal ? 'ok' : 'warn'}
            />
            <SurfacePill
              label="最近时间"
              value={frontendCloseoutSummary.generatedAt}
            />
            <SurfacePill
              label="artifact"
              value={frontendCloseoutSummary.artifactReady}
              tone={frontendCloseoutSummary.artifactReady === '已挂载' ? 'ok' : 'warn'}
            />
          </>
        }
      />

      {copyMessage ? <div className="text-sm text-cyan-200">{copyMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {MAINLINES.map((item) => (
          <SurfaceMetric
            key={item.title}
            label={item.title}
            value={item.value}
            helper={item.helper}
            icon={item.icon}
          />
        ))}
      </section>

      <SurfaceSection
        title="前端收口状态"
        description="这块专门给项目总控、QA 和老板看前端这条线收到了哪里，不需要自己再去拼页面。"
      >
        <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {FRONTEND_CLOSEOUT_STATUS.map((item) => (
              <article key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <SurfacePill
                    label="status"
                    value={item.status}
                    tone={item.status === '仅剩复核' ? 'warn' : 'ok'}
                  />
                </div>
                <div className="mt-3 text-sm leading-7 text-slate-300">{item.detail}</div>
              </article>
            ))}
          </div>
          <div className="grid gap-3">
            <SurfaceLinkCard
              href={LEARNING_LOOP_ROUTES.frontendGaps.href}
              title={LEARNING_LOOP_ROUTES.frontendGaps.title}
              description={LEARNING_LOOP_ROUTES.frontendGaps.description}
              compact
            />
            <SurfaceLinkCard
              href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              title={LEARNING_LOOP_ROUTES.releaseChecklist.title}
              description="如果要按验收顺序一项项勾掉，继续从 QA 最终勾选清单进入。"
              compact
            />
            <SurfaceLinkCard
              href={LEARNING_LOOP_ROUTES.report.href}
              title={LEARNING_LOOP_ROUTES.report.title}
              description="如果要对老板汇报前端与学习闭环是否稳定，继续从汇报页进入。"
              compact
            />
          </div>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="Latest release gate"
        description="项目总收口页不执行验收，但会挂出最近一次自动验收的结果，方便项目总控和老板快速判断这版是否已经稳定。"
        actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.releaseChecklist.title}`}
      >
        {releaseGateQuery.isLoading ? (
          <SurfaceStateCard
            kind="loading"
            title="正在读取最近一次 release gate"
            description="这里会把 UI smoke 和本地真实数据 evidence 的合并结果挂到最终收口视角里。"
          />
        ) : releaseGateQuery.isError || !latestReleaseGate ? (
          <SurfaceStateCard
            kind="warn"
            title="最近一次 release gate 暂不可用"
            description="说明最近还没有跑一键验收，或者当前没有可读取的 gate 结果。"
            actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
            actionLabel={`去${LEARNING_LOOP_ROUTES.releaseChecklist.title}查看`}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-base font-semibold text-white">Gate verdict</div>
                <SurfacePill
                  label="result"
                  value={latestReleaseGate.ok ? 'pass' : 'needs attention'}
                  tone={latestReleaseGate.ok ? 'ok' : 'warn'}
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SurfaceMetric
                  label="UI routes"
                  value={`${latestReleaseGate.ui_smoke?.metrics?.passed_routes ?? 0}/${latestReleaseGate.ui_smoke?.metrics?.total_routes ?? 0}`}
                  helper="核心页面路由 smoke"
                />
                <SurfaceMetric
                  label="UI interactions"
                  value={`${latestReleaseGate.ui_smoke?.metrics?.passed_interactions ?? 0}/${latestReleaseGate.ui_smoke?.metrics?.total_interactions ?? 0}`}
                  helper="关键交互 smoke"
                />
                <SurfaceMetric
                  label="Data probes"
                  value={`${latestReleaseGate.data_evidence?.metrics?.required_passed ?? 0}/${latestReleaseGate.data_evidence?.metrics?.required_total ?? 0}`}
                  helper="本地真实数据 evidence"
                />
                <SurfaceMetric
                  label="Runtime mode"
                  value={String(latestReleaseGate.data_evidence?.runtime_mode || '-')}
                  helper={String(latestReleaseGate.data_evidence?.dragon_url || '-')}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="text-base font-semibold text-white">Closeout judgment</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <SurfacePill label="generated" value={String(latestReleaseGate.generated_at || '-')} />
                <SurfacePill label="artifact" value={releaseGateQuery.data?.artifact_dir || '-'} />
              </div>
              <div className="mt-4 text-sm leading-7 text-slate-300">
                {latestReleaseGate.ok
                  ? '最近一次自动验收已经通过，说明这版在主链页面和本地真实数据层面都至少完成了一轮稳定验证，适合继续走最终收口和汇报。'
                  : '最近一次自动验收还有阻塞，建议先去收尾清单和自动验收报告确认风险，不要直接给出对外交付结论。'}
              </div>
              {Array.isArray(latestReleaseGate.notes) && latestReleaseGate.notes.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-slate-400">
                  {latestReleaseGate.notes.join(' | ')}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </SurfaceSection>

      <FrontendCloseoutVerificationSection
        description="这里把前端收尾验证也挂成正式入口。跑一条命令，就能顺序完成 tsc、独立构建、关键页面截图和 operations 巡检，并留下本轮交付的前端验证证据。"
        actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.frontendGaps.title}`}
        latestResult={frontendCloseout}
      />

      <SurfaceSection
        title="Final external gates"
        description="外部签收门禁仍然存在，但它们已经从“页面未收口”转成“最终签字与真实环境确认”问题。这里先保留一个统一提醒，详细勾选动作请回发布清单。"
        actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.releaseChecklist.title}`}
      >
        <FinalExternalGatesGrid />
      </SurfaceSection>

      <SurfaceSection
        title="建议查看入口"
        description="如果要从不同角色视角快速切入，这些入口已经足够覆盖当前项目主线。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ENTRYPOINTS.map((item) => (
            <SurfaceLinkCard
              key={item.href}
              href={item.href}
              title={item.title}
              description={item.description}
              compact
            />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="最后两张页"
        description="一张偏老板汇报，一张偏 QA / 执行验收。项目总收口页应该把这两张页都串起来。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.report.href}
            title={LEARNING_LOOP_ROUTES.report.title}
            description="适合用一屏讲清当前是否能继续推进、有没有风险、要不要人工介入。"
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.acceptance.href}
            title={LEARNING_LOOP_ROUTES.acceptance.title}
            description="适合 QA、项目总控和 AI 员工按步骤执行验收，不遗漏入口和边界。"
            compact
          />
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="A-05 知识三层签收"
        description="这里承接知识边界的最终验证口径。总控、QA 和知识负责人不需要再翻聊天记录，直接按命令跑、按标准看即可。"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <KnowledgeEvidenceCommandsGrid commands={KNOWLEDGE_EVIDENCE_COMMAND_ITEMS} />
          <div className="space-y-3">
            <KnowledgeEvidenceRulesCard
              title="Pass Rules"
              rules={KNOWLEDGE_EVIDENCE_PASS_RULES}
              summaryText={getKnowledgeEvidenceSnapshotText(knowledgeEvidence)}
              actionLinks={[
                { href: LEARNING_LOOP_ROUTES.releaseChecklist.href, label: '打开 QA 清单', tone: 'amber' },
                { href: '/operations/workflow-board', label: '打开任务消费页', tone: 'cyan' },
                { href: '/operations/knowledge-base', label: '打开知识库页', tone: 'fuchsia' },
              ]}
            />
            <KnowledgeEvidenceArtifactsCard paths={getKnowledgeEvidenceArtifacts(knowledgeEvidence)} />
          </div>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="当前红线"
        description="这些规则依然是收口后的长期边界，不因项目进入交付阶段而放宽。"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {PROJECT_BOUNDARIES.map((item) => (
            <SurfaceStateCard key={item} kind="warn" title="边界规则" description={item} />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="仓库文档"
        description="页面适合演示，文档适合留档和交接。"
      >
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Learning Loop Handoff</div>
            <div className="mt-2 font-mono text-sm text-cyan-200">
              docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Project Final Closeout</div>
            <div className="mt-2 font-mono text-sm text-cyan-200">
              docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md
            </div>
          </div>
        </div>
      </SurfaceSection>
    </div>
  );
}
