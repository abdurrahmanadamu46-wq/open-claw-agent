import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ClipboardCheck,
  FileCheck2,
  FolderKanban,
  Gauge,
  PackageCheck,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { DeliveryHubSummaryButton } from '@/components/operations/DeliveryHubSummaryButton';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfacePill,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import {
  readLatestFrontendCriticalSummary,
  readLatestFrontendCloseoutSummary,
  readLatestOperationsScanSummary,
  readLatestReleaseGateSummary,
  summarizeFrontendCritical,
  summarizeOperationsScan,
} from '@/lib/delivery-evidence';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';

export const dynamic = 'force-dynamic';

const DELIVERY_DOCS = [
  {
    title: '前端交付索引',
    description: '给 QA、老板和接手同学的统一交付索引，先看这份就能知道入口、证据和推荐使用顺序。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
  },
  {
    title: '前端最终交付包目录',
    description: '交付交接时的最终清单，汇总页面入口、验证命令、最新证据、必带文档和非阻断事项。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_FINAL_DELIVERY_PACKAGE_2026-04-17.md',
  },
  {
    title: '前端最终状态审计',
    description: '最终盘点当前前端是否存在阻断项、核心入口和证据链是否完整，以及哪些事项只是非阻断打磨。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_FINAL_AUDIT_2026-04-17.md',
  },
  {
    title: '前端提交前文件分组清单',
    description: '提交或交接前使用，区分哪些文件应该提交、哪些是生成物、哪些属于其他团队改动不要混入。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_PRECOMMIT_GROUPING_2026-04-17.md',
  },
  {
    title: '前端建议 Git Add 清单',
    description: '给提交执行人使用，提供建议 git add 命令、拆分提交方案和不要加入的生成物清单。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_GIT_ADD_PLAN_2026-04-17.md',
  },
  {
    title: '项目总收口说明',
    description: '从项目层面解释当前主入口、学习闭环、QA 验收和交接状态。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
  },
  {
    title: '学习闭环最终交接说明',
    description: '聚焦 memory、skills improvements、验收顺序与边界红线。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md',
  },
  {
    title: '知识三层 QA Runbook',
    description: '给知识边界签收使用，核对 runtime evidence、seed strategy 和 backflow blocked。',
    path: 'F:/openclaw-agent/docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md',
  },
  {
    title: '客户版交付简报',
    description: '给客户、老板或非工程评审对象使用，强调当前能演示、能验收、能交接，以及哪些话术不能过度承诺。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_CUSTOMER_DELIVERY_BRIEF_2026-04-17.md',
  },
  {
    title: '客户版演示附件结构',
    description: '把客户版简报整理成 PDF / 幻灯片 / 汇报附件时使用，适合对外演示前快速套版。',
    path: 'F:/openclaw-agent/docs/OPENCLAW_CUSTOMER_DELIVERY_DECK_2026-04-17.md',
  },
] as const;

const ENGINEER_HANDOFF_COMMANDS = [
  'cd web && npm run verify:closeout:frontend',
  'cd web && npm run test:e2e:release-ui',
  'cd web && npm run verify:release-gate:local',
] as const;

const DELIVERY_ENTRYPOINTS = [
  {
    href: LEARNING_LOOP_ROUTES.projectCloseout.href,
    title: LEARNING_LOOP_ROUTES.projectCloseout.title,
    description: '适合项目总控先看主入口、项目边界、外部签收门禁和整体收口判断。',
    icon: <FolderKanban className="h-5 w-5" />,
  },
  {
    href: LEARNING_LOOP_ROUTES.releaseChecklist.href,
    title: LEARNING_LOOP_ROUTES.releaseChecklist.title,
    description: '适合 QA 逐项勾选最终门禁，决定 Go / Canary / No-Go。',
    icon: <ClipboardCheck className="h-5 w-5" />,
  },
  {
    href: LEARNING_LOOP_ROUTES.acceptance.href,
    title: LEARNING_LOOP_ROUTES.acceptance.title,
    description: '适合执行验收时按步骤跑，不需要再翻聊天记录重新拼路径。',
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    href: LEARNING_LOOP_ROUTES.report.href,
    title: LEARNING_LOOP_ROUTES.report.title,
    description: '适合老板、项目总控快速看当前状态、风险和建议动作。',
    icon: <Gauge className="h-5 w-5" />,
  },
  {
    href: LEARNING_LOOP_ROUTES.frontendGaps.href,
    title: LEARNING_LOOP_ROUTES.frontendGaps.title,
    description: '适合前端、QA、集成工程师核对入口边界、contract 风险和推进顺序。',
    icon: <Radar className="h-5 w-5" />,
  },
  {
    href: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    title: LEARNING_LOOP_ROUTES.tenantCockpit.title,
    description: '适合回到租户辅助总览确认 learning loop、readiness 和 schema 辅助信息。',
    icon: <FileCheck2 className="h-5 w-5" />,
  },
] as const;

const DELIVERY_FLOW = [
  {
    title: '老板 / 项目总控',
    steps: '先看项目总收口页，再看老板汇报页，最后落到 release checklist 判断能否进入最终交付。',
  },
  {
    title: 'QA',
    steps: '先看这页确认最新自动证据，再进验收说明和 QA 清单，避免跑重复路径或漏掉证据目录。',
  },
  {
    title: '接手同学',
    steps: '先看前端联调辅助总表理解边界，再看项目总收口页和自动证据，建立全局上下文。',
  },
] as const;

const CUSTOMER_ONE_PAGE_CARDS = [
  {
    title: '能演示',
    detail: '首页已经是租户增长总控台，主管区、学习闭环、群协作、本地执行和交付状态都能从同一主视角进入。',
    proofKey: 'screenshots',
  },
  {
    title: '能验收',
    detail: '前端一键收尾命令已经接入，能复跑 tsc、独立 build、关键截图证据和 operations 巡检。',
    proofKey: 'closeout',
  },
  {
    title: '能交接',
    detail: '交付页、项目总收口页、老板汇报页都能直接看到最近一次前端收尾结论，并能复制摘要给不同角色。',
    proofKey: 'handoff',
  },
  {
    title: '不夸大',
    detail: '当前结论只代表前端主路径、控制台和证据链已收口；真实生产签字、客户现场网络和最终 QA 仍需独立确认。',
    proofKey: 'boundary',
  },
] as const;

function resolveCustomerProof(
  proofKey: (typeof CUSTOMER_ONE_PAGE_CARDS)[number]['proofKey'],
  input: {
    closeoutStatus: string;
    closeoutSteps: string;
    screenshotCoverage: string;
    operationsCoverage: string;
    closeoutArtifact: string;
    screenshotArtifact: string;
    operationsArtifact: string;
  },
) {
  if (proofKey === 'screenshots') return `${input.screenshotCoverage} critical pages passed`;
  if (proofKey === 'closeout') return `verify:closeout:frontend / ${input.closeoutStatus} / ${input.closeoutSteps}`;
  if (proofKey === 'handoff') return `delivery hub + closeout docs + operations ${input.operationsCoverage}`;
  return 'no overpromise';
}

function buildCustomerOnePageMarkdown(input: {
  closeoutStatus: string;
  closeoutSteps: string;
  screenshotCoverage: string;
  operationsCoverage: string;
  closeoutArtifact: string;
  screenshotArtifact: string;
  operationsArtifact: string;
}) {
  return [
    '# OpenClaw 客户版一页交付卡',
    '',
    '## 一句话结论',
    'OpenClaw 前端主路径已收口，运营控制台已覆盖，证据链可复跑，交付入口可使用。',
    '',
    '## 四个判断',
    ...CUSTOMER_ONE_PAGE_CARDS.map(
      (item) => `- ${item.title}: ${item.detail}\n  - 证据: ${resolveCustomerProof(item.proofKey, input)}`,
    ),
    '',
    '## 证据来源',
    `- 前端收尾证据包: ${input.closeoutArtifact}`,
    `- 关键页面截图证据: ${input.screenshotArtifact}`,
    `- operations 页面扫描证据: ${input.operationsArtifact}`,
    '',
    '## 推荐演示顺序',
    '1. `/` 租户增长总控台',
    '2. `/operations/delivery-hub` 最终交付导航页',
    '3. `/operations/learning-loop-report` 老板汇报页',
    '4. `/operations/project-closeout` 项目总收口页',
    '',
    '## 建议说法',
    '当前可以说：前端已具备可演示、可验收、可交接的状态。',
    '不要说：所有真实生产环境都已最终签字，或者系统会自动自己改自己。',
  ].join('\n');
}

const DELIVERY_PACKS = [
  {
    title: 'QA 分发包',
    audience: 'QA 审核',
    summary: '先看自动证据，再按验收说明和勾选清单执行，最后用 release checklist 做最终判断。',
    pages: [
      LEARNING_LOOP_ROUTES.deliveryHub,
      LEARNING_LOOP_ROUTES.releaseChecklist,
      LEARNING_LOOP_ROUTES.acceptance,
      LEARNING_LOOP_ROUTES.frontendGaps,
    ],
    docs: [
      'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
      'F:/openclaw-agent/docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md',
    ],
  },
  {
    title: '老板 / 总控分发包',
    audience: '老板 / 项目总控',
    summary: '先看项目总收口和老板汇报，再决定是否进一步看 release gate、QA 清单和外部门禁。',
    pages: [
      LEARNING_LOOP_ROUTES.deliveryHub,
      LEARNING_LOOP_ROUTES.projectCloseout,
      LEARNING_LOOP_ROUTES.report,
      LEARNING_LOOP_ROUTES.releaseChecklist,
    ],
    docs: [
      'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
      'F:/openclaw-agent/docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
    ],
  },
  {
    title: '接手同学分发包',
    audience: '前端 / 集成 / 运营接手',
    summary: '先理解入口边界和项目总收口，再结合学习闭环 handoff 与交付索引接管后续推进。',
    pages: [
      LEARNING_LOOP_ROUTES.deliveryHub,
      LEARNING_LOOP_ROUTES.frontendGaps,
      LEARNING_LOOP_ROUTES.projectCloseout,
      LEARNING_LOOP_ROUTES.tenantCockpit,
    ],
    docs: [
      'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
      'F:/openclaw-agent/docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
      'F:/openclaw-agent/docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md',
    ],
  },
  {
    title: '总工程师交接包',
    audience: '总工程师 / 交付负责人',
    summary: '先看 delivery hub 和项目总收口，再结合前端交付索引、学习闭环 handoff 与 release gate 样本快速完成全局接手。',
    pages: [
      LEARNING_LOOP_ROUTES.deliveryHub,
      LEARNING_LOOP_ROUTES.projectCloseout,
      LEARNING_LOOP_ROUTES.frontendGaps,
      LEARNING_LOOP_ROUTES.report,
      LEARNING_LOOP_ROUTES.releaseChecklist,
    ],
    docs: [
      'F:/openclaw-agent/docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
      'F:/openclaw-agent/docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
      'F:/openclaw-agent/docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md',
      'F:/openclaw-agent/docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md',
    ],
  },
] as const;

function formatDate(value?: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function shrinkPath(value?: string): string {
  if (!value) return '-';
  return value.length > 88 ? `...${value.slice(-85)}` : value;
}

function summarizeFrontendCloseout(closeout?: {
  summary?: {
    ok?: boolean;
    generatedAt?: string;
    steps?: Array<{ exitCode?: number }>;
    coverage?: {
      frontendCritical?: {
        passed?: number;
        total?: number;
        failed?: number;
      };
      operationsScan?: {
        covered?: number;
        total?: number;
        uncovered?: number;
        highPriorityIssues?: number;
      };
    };
  };
  artifact_dir?: string;
} | null) {
  const steps = closeout?.summary?.steps ?? [];
  const passedSteps = steps.filter((step) => Number(step.exitCode ?? 1) === 0).length;
  const frontendCritical = closeout?.summary?.coverage?.frontendCritical;
  const operationsScan = closeout?.summary?.coverage?.operationsScan;

  if (!closeout?.summary) {
    return {
      label: '待刷新',
      tone: 'warn' as const,
      stepsText: '0/0',
      screenshotText: '0/0',
      operationsText: '0/0',
      screenshotTone: 'warn' as const,
      operationsTone: 'warn' as const,
      generatedAt: '-',
      artifactDir: '',
    };
  }

  return {
    label: closeout.summary.ok ? '已通过' : '待关注',
    tone: closeout.summary.ok ? ('ok' as const) : ('warn' as const),
    stepsText: `${passedSteps}/${steps.length}`,
    screenshotText: `${frontendCritical?.passed ?? 0}/${frontendCritical?.total ?? 0}`,
    operationsText: `${operationsScan?.covered ?? 0}/${operationsScan?.total ?? 0}`,
    screenshotTone:
      frontendCritical?.total && frontendCritical.passed === frontendCritical.total
        ? ('ok' as const)
        : ('warn' as const),
    operationsTone:
      operationsScan?.total && operationsScan.covered === operationsScan.total && (operationsScan.highPriorityIssues ?? 0) === 0
        ? ('ok' as const)
        : ('warn' as const),
    generatedAt: closeout.summary.generatedAt || '-',
    artifactDir: closeout.artifact_dir || '',
  };
}

function summarizeKnowledgeEvidence(releaseGate?: {
  summary?: {
    knowledge_evidence?: {
      ok?: boolean;
      mode?: string;
      seed_strategy?: string | null;
      layer_counts?: {
        platform_common?: number;
        platform_industry?: number;
        tenant_private?: number;
      };
      checks?: {
        raw_group_collab_trace_excluded?: boolean;
        tenant_private_summary_only?: boolean;
        platform_backflow_blocked?: boolean;
      };
      report?: string;
    };
  };
} | null) {
  const evidence = releaseGate?.summary?.knowledge_evidence;
  if (!evidence) {
    return {
      label: '待刷新',
      tone: 'warn' as const,
      mode: '-',
      seedStrategy: '-',
      tenantPrivate: 0,
      common: 0,
      industry: 0,
      guardrails: 'n/a',
      report: '',
    };
  }
  const guardrailOk =
    evidence.checks?.raw_group_collab_trace_excluded === true
    && evidence.checks?.tenant_private_summary_only === true
    && evidence.checks?.platform_backflow_blocked === true;
  return {
    label: evidence.ok ? '已通过' : '待关注',
    tone: evidence.ok ? ('ok' as const) : ('warn' as const),
    mode: String(evidence.mode || '-'),
    seedStrategy: String(evidence.seed_strategy || '-'),
    tenantPrivate: Number(evidence.layer_counts?.tenant_private ?? 0) || 0,
    common: Number(evidence.layer_counts?.platform_common ?? 0) || 0,
    industry: Number(evidence.layer_counts?.platform_industry ?? 0) || 0,
    guardrails: guardrailOk ? 'yes' : 'no',
    report: String(evidence.report || ''),
  };
}

function buildDeliveryHubMarkdown(input: {
  releaseGateVerdict: string;
  releaseGateGeneratedAt: string;
  releaseGateArtifact: string;
  frontendCloseoutVerdict: string;
  frontendCloseoutSteps: string;
  frontendCloseoutArtifact: string;
  screenshotSummary: string;
  screenshotArtifact: string;
  operationsSummary: string;
  operationsArtifact: string;
}) {
  return [
    '# OpenClaw 前端最终交付摘要',
    '',
    '## 当前结论',
    `- Release gate: ${input.releaseGateVerdict}`,
    `- 最新 gate 时间: ${input.releaseGateGeneratedAt}`,
    `- 前端收尾: ${input.frontendCloseoutVerdict}（${input.frontendCloseoutSteps}）`,
    `- 关键截图证据: ${input.screenshotSummary}`,
    `- Operations 覆盖: ${input.operationsSummary}`,
    '',
    '## 推荐打开顺序',
    `1. ${LEARNING_LOOP_ROUTES.deliveryHub.title}（${LEARNING_LOOP_ROUTES.deliveryHub.href}）`,
    `2. ${LEARNING_LOOP_ROUTES.projectCloseout.title}（${LEARNING_LOOP_ROUTES.projectCloseout.href}）`,
    `3. ${LEARNING_LOOP_ROUTES.releaseChecklist.title}（${LEARNING_LOOP_ROUTES.releaseChecklist.href}）`,
    `4. ${LEARNING_LOOP_ROUTES.acceptance.title}（${LEARNING_LOOP_ROUTES.acceptance.href}）`,
    `5. ${LEARNING_LOOP_ROUTES.report.title}（${LEARNING_LOOP_ROUTES.report.href}）`,
    '',
    '## 最新证据路径',
    `- release gate artifact: ${input.releaseGateArtifact}`,
    `- frontend closeout artifact: ${input.frontendCloseoutArtifact}`,
    `- frontend screenshot artifact: ${input.screenshotArtifact}`,
    `- operations scan artifact: ${input.operationsArtifact}`,
    '',
    '## 仓库文档',
  ...DELIVERY_DOCS.map((item) => `- ${item.title}: ${item.path}`),
  ].join('\n');
}

function buildAudiencePacketMarkdown(input: {
  title: string;
  audience: string;
  summary: string;
  frontendCloseoutVerdict: string;
  frontendCloseoutSteps: string;
  frontendScreenshotCoverage: string;
  frontendOperationsCoverage: string;
  pages: ReadonlyArray<{ href: string; title: string; description: string }>;
  docs: readonly string[];
}) {
  return [
    `# ${input.title}`,
    '',
    `- 面向对象: ${input.audience}`,
    `- 说明: ${input.summary}`,
    '',
    '## 当前前端收尾结论',
    `- 状态: ${input.frontendCloseoutVerdict}`,
    `- 步骤: ${input.frontendCloseoutSteps}`,
    `- 关键页面截图: ${input.frontendScreenshotCoverage}`,
    `- operations 扫描: ${input.frontendOperationsCoverage}`,
    '',
    '## 推荐打开顺序',
    ...input.pages.map((item, index) => `${index + 1}. ${item.title}（${item.href}）\n   - ${item.description}`),
    '',
    '## 建议附带文档',
    ...input.docs.map((item) => `- ${item}`),
  ].join('\n');
}

function buildEngineerHandoffMarkdown(input: {
  releaseGateArtifact: string;
  releaseGateReport: string;
  frontendCloseoutVerdict: string;
  frontendCloseoutSteps: string;
  frontendScreenshotCoverage: string;
  frontendOperationsCoverage: string;
  screenshotArtifact: string;
  operationsArtifact: string;
  frontendCloseoutArtifact: string;
}) {
  return [
    '# 总工程师交接摘要',
    '',
    '- 面向对象: 总工程师 / 交付负责人',
    '- 目标: 先看入口与证据，再复跑最关键命令，快速确认当前前端交付链是否完整可复用。',
    '',
    '## 推荐页面顺序',
    `1. ${LEARNING_LOOP_ROUTES.deliveryHub.title}（${LEARNING_LOOP_ROUTES.deliveryHub.href}）`,
    `2. ${LEARNING_LOOP_ROUTES.projectCloseout.title}（${LEARNING_LOOP_ROUTES.projectCloseout.href}）`,
    `3. ${LEARNING_LOOP_ROUTES.frontendGaps.title}（${LEARNING_LOOP_ROUTES.frontendGaps.href}）`,
    `4. ${LEARNING_LOOP_ROUTES.report.title}（${LEARNING_LOOP_ROUTES.report.href}）`,
    `5. ${LEARNING_LOOP_ROUTES.releaseChecklist.title}（${LEARNING_LOOP_ROUTES.releaseChecklist.href}）`,
    '',
    '## 推荐命令',
    ...ENGINEER_HANDOFF_COMMANDS.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 当前前端收尾结论',
    `- 状态: ${input.frontendCloseoutVerdict}`,
    `- 步骤: ${input.frontendCloseoutSteps}`,
    `- 关键页面截图: ${input.frontendScreenshotCoverage}`,
    `- operations 扫描: ${input.frontendOperationsCoverage}`,
    '',
    '## 最新样本路径',
    `- release gate artifact: ${input.releaseGateArtifact}`,
    `- release gate report: ${input.releaseGateReport}`,
    `- frontend closeout artifact: ${input.frontendCloseoutArtifact}`,
    `- frontend screenshot artifact: ${input.screenshotArtifact}`,
    `- operations scan artifact: ${input.operationsArtifact}`,
    '',
    '## 建议附带文档',
    ...DELIVERY_DOCS.map((item) => `- ${item.title}: ${item.path}`),
  ].join('\n');
}

function ArtifactCard({
  title,
  description,
  statusLabel,
  statusTone,
  generatedAt,
  artifactDir,
  reportPath,
  children,
}: {
  title: string;
  description: string;
  statusLabel: string;
  statusTone: 'neutral' | 'ok' | 'warn';
  generatedAt?: string;
  artifactDir?: string;
  reportPath?: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm leading-7 text-slate-400">{description}</div>
        </div>
        <SurfacePill label="status" value={statusLabel} tone={statusTone} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {children}
      </div>
      <div className="mt-4 space-y-2 text-xs leading-6 text-slate-400">
        <div>
          <span className="text-slate-500">generated:</span> {formatDate(generatedAt)}
        </div>
        <div className="font-mono text-cyan-200">artifact: {shrinkPath(artifactDir)}</div>
        <div className="font-mono text-slate-300">report: {shrinkPath(reportPath)}</div>
      </div>
    </article>
  );
}

export default async function DeliveryHubPage() {
  const [releaseGate, frontendCritical, operationsScan, frontendCloseout] = await Promise.all([
    readLatestReleaseGateSummary(),
    readLatestFrontendCriticalSummary(),
    readLatestOperationsScanSummary(),
    readLatestFrontendCloseoutSummary(),
  ]);

  const screenshotMetrics = summarizeFrontendCritical(frontendCritical?.summary);
  const operationsMetrics = summarizeOperationsScan(operationsScan?.summary);
  const releaseGateSummary = releaseGate?.summary;
  const frontendCloseoutStatus = summarizeFrontendCloseout(frontendCloseout);
  const knowledgeStatus = summarizeKnowledgeEvidence(releaseGate);
  const deliverySummary = buildDeliveryHubMarkdown({
    releaseGateVerdict: releaseGateSummary ? (releaseGateSummary.ok ? '通过' : '待关注') : '未发现',
    releaseGateGeneratedAt: formatDate(releaseGateSummary?.generated_at),
    releaseGateArtifact: releaseGate?.artifact_dir || '-',
    frontendCloseoutVerdict: frontendCloseoutStatus.label,
    frontendCloseoutSteps: frontendCloseoutStatus.stepsText,
    frontendCloseoutArtifact: frontendCloseoutStatus.artifactDir || '-',
    screenshotSummary: `${screenshotMetrics.passedPages}/${screenshotMetrics.totalPages} 页面通过，噪音页 ${screenshotMetrics.noisyPages}`,
    screenshotArtifact: frontendCritical?.artifact_dir || '-',
    operationsSummary: `${operationsMetrics.coveredPages}/${operationsMetrics.totalPages} 已覆盖，高优先级 ${operationsMetrics.highPriorityItems}`,
    operationsArtifact: operationsScan?.artifact_dir || '-',
  });
  const customerProofInput = {
    closeoutStatus: frontendCloseoutStatus.label,
    closeoutSteps: frontendCloseoutStatus.stepsText,
    screenshotCoverage: frontendCloseoutStatus.screenshotText,
    operationsCoverage: frontendCloseoutStatus.operationsText,
    closeoutArtifact: frontendCloseoutStatus.artifactDir || '-',
    screenshotArtifact: frontendCritical?.artifact_dir || '-',
    operationsArtifact: operationsScan?.artifact_dir || '-',
  };
  const engineerHandoffSummary = buildEngineerHandoffMarkdown({
    releaseGateArtifact: releaseGate?.artifact_dir || '-',
    releaseGateReport: releaseGate?.report_path || '-',
    frontendCloseoutVerdict: frontendCloseoutStatus.label,
    frontendCloseoutSteps: frontendCloseoutStatus.stepsText,
    frontendScreenshotCoverage: frontendCloseoutStatus.screenshotText,
    frontendOperationsCoverage: frontendCloseoutStatus.operationsText,
    screenshotArtifact: frontendCritical?.artifact_dir || '-',
    operationsArtifact: operationsScan?.artifact_dir || '-',
    frontendCloseoutArtifact: frontendCloseout?.artifact_dir || '-',
  });

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Final Delivery / Evidence Hub"
        title="最终交付导航页"
        description="这页不是再讲业务流程，而是把最终交付时最需要的自动证据、入口页和查看顺序收成一张导航图。适合 QA、项目总控、老板和接手同学快速判断“先看哪页、证据在哪、这版现在稳不稳”。"
        actions={
          <>
            <Link
              href={LEARNING_LOOP_ROUTES.projectCloseout.href}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              打开项目总收口页
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开 QA 清单
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.report.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100"
            >
              打开老板汇报页
            </Link>
            <DeliveryHubSummaryButton
              summary={engineerHandoffSummary}
              label="复制总工程师交接摘要"
              successMessage="已复制总工程师交接摘要，可以直接发给总工程师 / 交付负责人。"
              testId="delivery-hub-copy-engineer-handoff"
            />
            <DeliveryHubSummaryButton summary={deliverySummary} testId="delivery-hub-copy-summary" />
          </>
        }
        aside={
          <>
            <SurfacePill
              label="前端收尾"
              value={frontendCloseoutStatus.label}
              tone={frontendCloseoutStatus.tone}
            />
            <SurfacePill label="收尾步骤" value={frontendCloseoutStatus.stepsText} />
            <SurfacePill
              label="截图覆盖"
              value={frontendCloseoutStatus.screenshotText}
              tone={frontendCloseoutStatus.screenshotTone}
            />
            <SurfacePill
              label="operations 覆盖"
              value={frontendCloseoutStatus.operationsText}
              tone={frontendCloseoutStatus.operationsTone}
            />
            <SurfacePill
              label="最近时间"
              value={formatDate(frontendCloseoutStatus.generatedAt)}
            />
            <SurfacePill
              label="artifact"
              value={frontendCloseoutStatus.artifactDir ? '已挂载' : '待刷新'}
              tone={frontendCloseoutStatus.artifactDir ? 'ok' : 'warn'}
            />
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="Release gate"
          value={releaseGateSummary ? (releaseGateSummary.ok ? '通过' : '待关注') : '未发现'}
          helper={releaseGateSummary ? formatDate(releaseGateSummary.generated_at) : '尚未读到最近一次自动 gate'}
        />
        <SurfaceMetric
          label="截图证据"
          value={`${screenshotMetrics.passedPages}/${screenshotMetrics.totalPages}`}
          helper="生产 next start 下的关键页面截图通过数"
        />
        <SurfaceMetric
          label="Operations 覆盖"
          value={`${operationsMetrics.coveredPages}/${operationsMetrics.totalPages}`}
          helper="operations 页面已进入证据覆盖的数量"
        />
        <SurfaceMetric
          label="证据噪音页"
          value={`${screenshotMetrics.noisyPages}`}
          helper="console / response 仍有噪音的页面数"
        />
      </section>

      <SurfaceSection
        title="总工程师一屏摘要"
        description="这一块把总工程师最关心的三件事压成一屏：前端收尾是否通过、整包 release gate 是否通过、知识三层 evidence 是否通过。"
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">Frontend closeout</div>
                <div className="mt-1 text-sm text-slate-400">tsc / build / screenshots / operations scan</div>
              </div>
              <SurfacePill label="status" value={frontendCloseoutStatus.label} tone={frontendCloseoutStatus.tone} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SurfaceMetric label="Steps" value={frontendCloseoutStatus.stepsText} helper="已通过步骤 / 总步骤" />
              <SurfaceMetric label="Generated" value={formatDate(frontendCloseoutStatus.generatedAt)} helper="最近一键收尾时间" />
              <SurfaceMetric label="Screenshots" value={frontendCloseoutStatus.screenshotText} helper="关键页面截图通过数" />
              <SurfaceMetric label="Operations" value={frontendCloseoutStatus.operationsText} helper="operations 页面覆盖数" />
            </div>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-200">
              {frontendCloseoutStatus.artifactDir || '-'}
            </div>
          </article>

          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">Release gate</div>
                <div className="mt-1 text-sm text-slate-400">UI smoke + release data + knowledge evidence</div>
              </div>
              <SurfacePill
                label="status"
                value={releaseGateSummary ? (releaseGateSummary.ok ? '已通过' : '待关注') : '待刷新'}
                tone={releaseGateSummary?.ok ? 'ok' : 'warn'}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SurfaceMetric
                label="UI routes"
                value={`${releaseGateSummary?.ui_smoke?.metrics?.passed_routes ?? 0}/${releaseGateSummary?.ui_smoke?.metrics?.total_routes ?? 0}`}
                helper="release UI smoke"
              />
              <SurfaceMetric
                label="Data probes"
                value={`${releaseGateSummary?.data_evidence?.metrics?.required_passed ?? 0}/${releaseGateSummary?.data_evidence?.metrics?.required_total ?? 0}`}
                helper="release data local evidence"
              />
            </div>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-200">
              {releaseGate?.artifact_dir || '-'}
            </div>
          </article>

          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">Knowledge evidence</div>
                <div className="mt-1 text-sm text-slate-400">A-05 runtime evidence + guardrails</div>
              </div>
              <SurfacePill label="status" value={knowledgeStatus.label} tone={knowledgeStatus.tone} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SurfaceMetric label="Tenant private" value={String(knowledgeStatus.tenantPrivate)} helper={`${knowledgeStatus.mode} / ${knowledgeStatus.seedStrategy}`} />
              <SurfaceMetric label="Guardrails" value={knowledgeStatus.guardrails} helper={`common ${knowledgeStatus.common} / industry ${knowledgeStatus.industry}`} />
            </div>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-200">
              {knowledgeStatus.report || '-'}
            </div>
          </article>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="一键收尾命令"
        description="如果你想把当前前端收尾状态重新跑一遍，现在已经可以用一条命令完成。"
      >
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="text-base font-semibold text-white">推荐命令</div>
            <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 font-mono text-sm text-cyan-100">
              cd web && npm run verify:closeout:frontend
            </div>
            <div className="mt-3 text-sm leading-7 text-slate-300">
              这条命令会按当前项目认可口径，依次跑 tsc、隔离 build、关键页面截图证据和 operations 巡检。
            </div>
          </article>

          {frontendCloseout ? (
            <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">最近一次一键收尾结果</div>
                  <div className="mt-1 text-sm leading-7 text-slate-400">
                    适合判断“现在直接跑收尾命令会得到什么样的结论”。
                  </div>
                </div>
                <SurfacePill
                  label="result"
                  value={frontendCloseout.summary.ok ? 'pass' : 'needs attention'}
                  tone={frontendCloseout.summary.ok ? 'ok' : 'warn'}
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SurfaceMetric
                  label="generated"
                  value={formatDate(frontendCloseout.summary.generatedAt)}
                  helper="最近一次一键收尾时间"
                />
                <SurfaceMetric
                  label="steps"
                  value={`${frontendCloseout.summary.steps?.filter((step) => step.exitCode === 0).length ?? 0}/${frontendCloseout.summary.steps?.length ?? 0}`}
                  helper="本次通过的步骤数"
                />
              </div>
              <div className="mt-4 space-y-2 text-xs leading-6 text-slate-400">
                {frontendCloseout.summary.steps?.map((step) => (
                  <div key={step.label} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <span className="font-medium text-white">{step.label}</span>
                    <span className="ml-2">{step.exitCode === 0 ? 'pass' : 'fail'}</span>
                    <span className="ml-2 text-slate-500">{step.durationMs}ms</span>
                    {step.artifactDir ? (
                      <div className="mt-1 font-mono text-cyan-200">{shrinkPath(step.artifactDir)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="最近还没有一键收尾产物"
              description="先跑 `npm run verify:closeout:frontend`，这一区就会自动显示最近一次汇总结果。"
            />
          )}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="统一交付入口"
        description="不同角色不需要各自记路径，这里已经按使用目的整理好了。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DELIVERY_ENTRYPOINTS.map((item) => (
            <SurfaceLinkCard
              key={item.href}
              href={item.href}
              title={item.title}
              description={item.description}
              icon={item.icon}
              compact
            />
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="最新自动证据"
        description="这里直接读取最近一次 release gate、前端截图证据和 operations 巡检。重跑脚本后刷新页面，就会自动看到新的时间戳和结果。"
      >
        <div className="grid gap-4 xl:grid-cols-3">
          {releaseGate ? (
            <ArtifactCard
              title="Release gate"
              description="主链 UI smoke、本地真实数据 evidence 与最终 gate 结论。"
              statusLabel={releaseGate.summary.ok ? 'pass' : 'needs attention'}
              statusTone={releaseGate.summary.ok ? 'ok' : 'warn'}
              generatedAt={releaseGate.summary.generated_at}
              artifactDir={releaseGate.artifact_dir}
              reportPath={releaseGate.report_path}
            >
              <SurfaceMetric
                label="UI routes"
                value={`${releaseGate.summary.ui_smoke?.metrics?.passed_routes ?? 0}/${releaseGate.summary.ui_smoke?.metrics?.total_routes ?? 0}`}
                helper="页面路由 smoke"
              />
              <SurfaceMetric
                label="Data probes"
                value={`${releaseGate.summary.data_evidence?.metrics?.required_passed ?? 0}/${releaseGate.summary.data_evidence?.metrics?.required_total ?? 0}`}
                helper="本地真实数据 evidence"
              />
            </ArtifactCard>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="最近一次 release gate 暂不可用"
              description="先跑验证脚本，再刷新这页即可看到最新 gate。"
              actionHref={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              actionLabel="先看 QA 清单"
            />
          )}

          {frontendCritical ? (
            <ArtifactCard
              title="Frontend critical screenshots"
              description="生产环境截图证据，确认关键页面能打开、无应用错误、无常见乱码。"
              statusLabel={
                screenshotMetrics.totalPages > 0 && screenshotMetrics.passedPages === screenshotMetrics.totalPages
                  ? 'all green'
                  : 'needs review'
              }
              statusTone={
                screenshotMetrics.totalPages > 0 && screenshotMetrics.passedPages === screenshotMetrics.totalPages
                  ? 'ok'
                  : 'warn'
              }
              generatedAt={frontendCritical.summary.generated_at}
              artifactDir={frontendCritical.artifact_dir}
              reportPath={frontendCritical.report_path}
            >
              <SurfaceMetric
                label="Pages"
                value={`${screenshotMetrics.passedPages}/${screenshotMetrics.totalPages}`}
                helper="通过的截图页面数"
              />
              <SurfaceMetric
                label="Noise"
                value={`${screenshotMetrics.noisyPages}`}
                helper={`console ${screenshotMetrics.consoleErrors} / response ${screenshotMetrics.responseErrors}`}
              />
            </ArtifactCard>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="前端截图证据暂不可用"
              description="还没有读到最近一次 frontend-critical-screens 产物。"
              actionHref={LEARNING_LOOP_ROUTES.projectCloseout.href}
              actionLabel="先看项目总收口页"
            />
          )}

          {operationsScan ? (
            <ArtifactCard
              title="Operations surface scan"
              description="静态体检报告，确认 operations 页面是否都进入证据覆盖，以及是否还有高优先级风险。"
              statusLabel={
                operationsMetrics.highPriorityItems === 0 && operationsMetrics.uncoveredPages === 0
                  ? 'clean'
                  : 'needs review'
              }
              statusTone={
                operationsMetrics.highPriorityItems === 0 && operationsMetrics.uncoveredPages === 0
                  ? 'ok'
                  : 'warn'
              }
              generatedAt={operationsScan.summary.generated_at}
              artifactDir={operationsScan.artifact_dir}
              reportPath={operationsScan.report_path}
            >
              <SurfaceMetric
                label="Covered"
                value={`${operationsMetrics.coveredPages}/${operationsMetrics.totalPages}`}
                helper="已纳入截图证据的 operations 页"
              />
              <SurfaceMetric
                label="High priority"
                value={`${operationsMetrics.highPriorityItems}`}
                helper={
                  operationsMetrics.topRoutes.length > 0
                    ? operationsMetrics.topRoutes.map((item) => item.route).join(' | ')
                    : '当前没有高优先级静态风险'
                }
              />
            </ArtifactCard>
          ) : (
            <SurfaceStateCard
              kind="warn"
              title="Operations 巡检暂不可用"
              description="还没有读到最近一次 operations-surface-scan 产物。"
              actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
              actionLabel="先看前端联调总表"
            />
          )}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="建议使用顺序"
        description="如果你不是长期在这个项目里，这一段能帮你最快进入状态。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {DELIVERY_FLOW.map((item) => (
            <article key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="text-base font-semibold text-white">{item.title}</div>
              <div className="mt-3 text-sm leading-7 text-slate-300">{item.steps}</div>
            </article>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="客户一页卡"
        description="这一块把客户或老板最关心的判断压成一页：能不能演示、能不能验收、能不能交接、哪些话不能过度承诺。"
      >
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 md:grid-cols-2">
            {CUSTOMER_ONE_PAGE_CARDS.map((item) => (
              <article key={item.title} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                <div className="text-lg font-semibold text-white">{item.title}</div>
                <div className="mt-3 text-sm leading-7 text-slate-300">{item.detail}</div>
                <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                  {resolveCustomerProof(item.proofKey, customerProofInput)}
                </div>
              </article>
            ))}
          </div>
          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="text-base font-semibold text-white">复制给客户 / 老板</div>
            <div className="mt-3 text-sm leading-7 text-slate-300">
              如果对方只需要短版说明，可以直接复制这一页卡，不需要暴露完整工程日志。
            </div>
            <div className="mt-4">
              <DeliveryHubSummaryButton
                summary={buildCustomerOnePageMarkdown(customerProofInput)}
                label="复制客户一页卡"
                successMessage="已复制客户一页交付卡。"
                testId="delivery-hub-copy-customer-one-page"
              />
            </div>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-200">
              F:/openclaw-agent/docs/OPENCLAW_CUSTOMER_DELIVERY_BRIEF_2026-04-17.md
            </div>
          </article>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="按角色分发"
        description="如果你现在就要把成果发出去，这里已经按使用者分成几包，不需要你再临时组织话术和路径。"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {DELIVERY_PACKS.map((pack) => (
            <article key={pack.title} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{pack.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{pack.audience}</div>
                </div>
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                  <PackageCheck className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 text-sm leading-7 text-slate-300">{pack.summary}</div>
              <div className="mt-4 space-y-2">
                {pack.pages.map((item) => (
                  <div key={item.href} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="text-sm font-medium text-white">{item.title}</div>
                    <div className="mt-1 text-xs leading-6 text-slate-400">{item.href}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <DeliveryHubSummaryButton
                  summary={buildAudiencePacketMarkdown({
                    ...pack,
                    frontendCloseoutVerdict: frontendCloseoutStatus.label,
                    frontendCloseoutSteps: frontendCloseoutStatus.stepsText,
                    frontendScreenshotCoverage: frontendCloseoutStatus.screenshotText,
                    frontendOperationsCoverage: frontendCloseoutStatus.operationsText,
                  })}
                  label={`复制${pack.title}`}
                  successMessage={`已复制${pack.title}，可以直接发给${pack.audience}。`}
                />
              </div>
            </article>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="总工程师交接速览"
        description="这一块专门服务总工程师：不只是告诉他看哪些页面，还把最该跑的命令和最新样本路径一起打包。"
      >
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="text-base font-semibold text-white">推荐命令</div>
            <div className="mt-4 space-y-3">
              {ENGINEER_HANDOFF_COMMANDS.map((item, index) => (
                <div key={item} className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Command {index + 1}</div>
                  <div className="mt-2 font-mono text-sm text-cyan-200">{item}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
            <div className="text-base font-semibold text-white">最新样本</div>
            <div className="mt-4 space-y-3">
              {[
                releaseGate?.artifact_dir || '-',
                frontendCloseout?.artifact_dir || '-',
                frontendCritical?.artifact_dir || '-',
                operationsScan?.artifact_dir || '-',
              ].map((item) => (
                <div key={item} className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 font-mono text-xs text-cyan-200">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-4">
              <DeliveryHubSummaryButton
                summary={engineerHandoffSummary}
                label="复制这一整包"
                successMessage="已复制总工程师交接速览。"
                testId="delivery-hub-copy-engineer-pack"
              />
            </div>
          </article>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="交付文档区"
        description="如果你要把结果发给别人，除了页面入口，还需要把仓库里的正式 handoff 文档一起带上。这里列的是当前最推荐的交付文档。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {DELIVERY_DOCS.map((item) => (
            <article key={item.path} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="text-base font-semibold text-white">{item.title}</div>
              <div className="mt-2 text-sm leading-7 text-slate-300">{item.description}</div>
              <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-200">
                {item.path}
              </div>
              <div className="mt-4">
                <DeliveryHubSummaryButton
                  summary={item.path}
                  label={`复制${item.title}路径`}
                  successMessage={`已复制 ${item.title} 路径。`}
                />
              </div>
            </article>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="交付边界"
        description="这页只负责聚合入口和证据，不发明新的业务 contract，也不替代 release checklist 或项目总收口页。"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SurfacePill label="定位" value="统一交付导航，不是业务主入口" />
          <SurfacePill label="数据来源" value="自动读取 test-results 最新产物" tone="ok" />
          <SurfacePill label="刷新方式" value="脚本重跑后刷新页面即可" />
          <SurfacePill label="外部门禁" value="仍由项目总收口页承接" tone="warn" />
        </div>
      </SurfaceSection>
    </div>
  );
}
