'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  RefreshCw,
  Route,
  ShieldCheck,
} from 'lucide-react';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import { FinalExternalGatesGrid } from '@/components/operations/FinalExternalGatesSection';
import { FrontendCloseoutVerificationSection } from '@/components/operations/FrontendCloseoutVerificationSection';
import {
  KnowledgeEvidenceArtifactsCard,
  KnowledgeEvidenceCommandsGrid,
  KnowledgeEvidenceRulesCard,
} from '@/components/operations/KnowledgeEvidenceSection';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import {
  KNOWLEDGE_EVIDENCE_COMMAND_ITEMS,
  KNOWLEDGE_EVIDENCE_PASS_RULES,
  getKnowledgeEvidenceArtifacts,
  getKnowledgeEvidenceSnapshotText,
} from '@/lib/knowledge-evidence';
import {
  fetchLatestReleaseGate,
  resolveLatestFrontendCloseout,
  resolveLatestKnowledgeEvidence,
  type LatestReleaseGateResponse,
} from '@/lib/release-gate-client';

type CheckStatus = 'pending' | 'passed' | 'watch' | 'blocked';
type CheckGroup = 'P0 链路' | '治理台' | '收尾留痕';

type ReleaseCheckItem = {
  id: string;
  group: CheckGroup;
  title: string;
  owner: string;
  href: string;
  priority: 'P0' | 'P1' | 'P2';
  verify: string;
  fallback: string;
  passWhen: string;
};

const STORAGE_KEY = 'openclaw.release-checklist.status.v1';

const CHECK_ITEMS: ReleaseCheckItem[] = [
  {
    id: 'monitor-fallback',
    group: 'P0 链路',
    title: '执行监控实时流与快照 fallback',
    owner: '稳定性负责人 + 后端工程师',
    href: '/operations/monitor',
    priority: 'P0',
    verify: '打开执行监控室，确认 live stream 和 snapshot mode 都有明确状态；断流时仍能看到节点、日志和风险卡。',
    fallback: 'WebSocket 不稳定时使用 REST 快照轮询，不清空现场数据。',
    passWhen: '能看到心跳超时、回执滞后、严重告警，并能从告警跳到日志审核。',
  },
  {
    id: 'log-audit-handoff',
    group: 'P0 链路',
    title: '监控告警到日志审核 handoff',
    owner: '稳定性负责人 + QA审核',
    href: '/operations/log-audit',
    priority: 'P0',
    verify: '从监控页点击节点或任务风险，确认日志审核能自动带入 nodeId、keyword、module、errorsOnly。',
    fallback: '没有 traceId 时，仍能靠 node、task、module 和异常过滤缩小范围。',
    passWhen: '进入日志审核后不需要手动重填主要过滤条件。',
  },
  {
    id: 'trace-recovery-loop',
    group: 'P0 链路',
    title: 'Trace 处理、验证、收尾闭环',
    owner: '稳定性负责人 + 项目总控',
    href: '/operations/autopilot/trace',
    priority: 'P0',
    verify: '从日志审核进入 Trace，完成预演、审批或回滚后，回到监控和日志做趋势验证。',
    fallback: '回滚接口不可用时，仍能使用本地 closeout receipt 进行人工闭环留痕。',
    passWhen: 'Trace 能展示闭环状态、验证回流、下一步动作和本地收尾记录。',
  },
  {
    id: 'edge-heartbeat-receipt',
    group: 'P0 链路',
    title: 'Edge 心跳与执行回执可见',
    owner: '后端工程师 + Edge 集成',
    href: '/operations/monitor#stability-alerts',
    priority: 'P0',
    verify: '确认心跳 90s/180s、回执 5m/15m 的告警分级能出现在 Stability Alerts。',
    fallback: '实时帧缺失时，以快照中的 last_seen_at、runtime_foreground、task notification 做判断。',
    passWhen: '能定位具体 node/task，并能继续进入日志审核或 Trace。',
  },
  {
    id: 'knowledge-context-runtime-evidence',
    group: 'P0 链路',
    title: '知识三层真实消费证据',
    owner: '知识库优化负责人 + QA审核',
    href: '/operations/workflow-board',
    priority: 'P0',
    verify: '先跑 local:context，再跑完整 local 命令，确认报告里同时出现 platform_common、platform_industry、tenant_private，并且 tenant_private 大于 0。',
    fallback: '如果完整 runtime 受 provider 或长图阻塞，先保住 local:context 通过，再看 REPORT.md / preflight.json / knowledge-context.json 定位卡点。',
    passWhen: '最新报告满足 mode = runtime_evidence、seed_strategy = collab_dispatch、tenant_private > 0，且 raw trace excluded / summary only / backflow blocked 全部为 yes。',
  },
  {
    id: 'skills-governance',
    group: '治理台',
    title: '技能治理台扫描闭环',
    owner: '前端工程师 + QA审核',
    href: '/operations/skills-pool',
    priority: 'P1',
    verify: '按 scan_status、issues only、角色、发布状态筛选技能，并查看完整 scan report。',
    fallback: '没有 scan report 时，仍能看 publish_status、priority、rollback_to、voice_profile_ref。',
    passWhen: 'QA 能复制问题、导出筛选结果，并识别 warn/block 技能。',
  },
  {
    id: 'hermes-dual-track-memory',
    group: '治理台',
    title: 'Hermes 双轨记忆收口',
    owner: '知识库优化负责人 + QA审核',
    href: LEARNING_LOOP_ROUTES.memory.href,
    priority: 'P1',
    verify: '打开 Memory 页，确认常驻小记忆、历史可检索记忆、source chain、手动写入入口和脱敏结果都可见。',
    fallback: '双轨统计接口暂不可用时，Memory 页仍应显示租户共享记忆、三层压缩和 hybrid search 结果。',
    passWhen: 'QA 能说明 resident/history 两条轨道的区别，并能看到常驻上下文预算、历史命中和来源链。',
  },
  {
    id: 'skill-auto-trigger-loop',
    group: '治理台',
    title: 'Skill 自动触发提案闭环',
    owner: '开发 skills 负责人 + 后端工程师 + QA审核',
    href: LEARNING_LOOP_ROUTES.skillsImprovements.href,
    priority: 'P0',
    verify: '打开 Skill 进化页，确认 runtime failure、人工改稿、低质量分、边缘重试等 signal 会出现在 Automatic trigger signals，并显示 created/skipped 原因。',
    fallback: '真实信号暂未产生时，使用 Simulate trigger 验证阈值、去重和扫描后的提案生成。',
    passWhen: 'QA 能看到 signal、proposal、scan_status、evidence、patch draft 之间的关联，且不会直接修改线上 Skill。',
  },
  {
    id: 'skill-apply-rollback',
    group: '治理台',
    title: 'Skill apply / rollback 受控恢复链路',
    owner: '项目总控 + QA审核',
    href: LEARNING_LOOP_ROUTES.skillsImprovements.href,
    priority: 'P0',
    verify: '在 Skill 进化页确认未审批提案无法 apply，approved 提案能看到字段级 diff，applied 后才能 rollback。',
    fallback: '如果后端 apply/rollback 暂不可用，前端必须保留 disabled 状态和错误提示，不允许伪装成功。',
    passWhen: 'QA 能完成 approve -> apply -> rollback 的受控流程，并看到 manifest before/after 差异。',
  },
  {
    id: 'skill-effect-recommendation',
    group: '收尾留痕',
    title: 'Skill 发布后效果追踪与建议',
    owner: '稳定性负责人 + QA审核',
    href: LEARNING_LOOP_ROUTES.skillsImprovements.href,
    priority: 'P1',
    verify: '确认 Post-apply effect tracking 展示 applied/rolled_back、runtime、human_feedback、edge_telemetry 等效果事件，并给出 keep_applied / recommend_rollback / continue_observing 建议。',
    fallback: '效果观测不足时必须显示继续观察，不能自动回滚；负向观测只允许建议人工回滚。',
    passWhen: 'QA 能看到 effect_event、avg_delta、positive/negative observations 和 recommendation reason。',
  },
  {
    id: 'learning-loop-entrypoints',
    group: '收尾留痕',
    title: '学习闭环入口总览',
    owner: 'AI 前端补位工程师 + 项目总控',
    href: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    priority: 'P1',
    verify: '确认 `/` 首页和 tenant-cockpit 都能看到学习闭环健康度，并能跳转到 Skill 进化页和 Memory 页。',
    fallback: '如果总览聚合接口失败，首页和 tenant-cockpit 必须保留错误/观察态提示，并不影响主入口导航。',
    passWhen: '老板或 QA 从首页即可判断学习闭环是否 active、是否待审核、是否有建议回滚、双轨记忆是否有沉淀。',
  },
  {
    id: 'channel-adapters',
    group: '治理台',
    title: '渠道适配器治理台',
    owner: 'AI群协作集成工程师 + QA审核',
    href: '/operations/channels',
    priority: 'P1',
    verify: '在渠道页查看 Edge Adapter Manifest，按 scan_status 和 issues only 筛选。',
    fallback: '平台详情接口失败时，列表仍能显示 manifest 摘要、risk level 和 scan issue。',
    passWhen: 'xiaohongshu、douyin 等适配器能完成风险初筛、复制问题和导出。',
  },
  {
    id: 'model-providers',
    group: '治理台',
    title: '模型供应商治理台',
    owner: '后端工程师 + 稳定性负责人',
    href: '/settings/model-providers',
    priority: 'P1',
    verify: '按 scan_status 筛选 provider，检查健康状态、默认模型、绑定关系和 scan report。',
    fallback: '供应商实时状态不可用时，仍能通过 scan report 和手动刷新判断风险。',
    passWhen: '发版前能快速判断供应商配置风险和模型绑定风险。',
  },
  {
    id: 'trace-closeout-receipt',
    group: '收尾留痕',
    title: 'Trace closeout receipt 与最近收尾记录',
    owner: '项目总控 + QA审核',
    href: '/operations/autopilot/trace',
    priority: 'P1',
    verify: '在 Trace 中确认 Closeout Receipt、Recent Closeouts、总控/QA 摘要、保留策略可用。',
    fallback: '没有后端留痕接口时，先使用当前浏览器本地记录完成人工闭环。',
    passWhen: '能复制总控/QA 摘要，能导出筛选结果，能看到最近收尾记录。',
  },
];

const FINAL_SIGNOFF_GATES = [
  {
    id: 'A-02',
    title: 'Execution monitor real-environment verification',
    owner: 'QA审核',
    status: 'blocked',
    summary: '本地 evidence 已齐，但真实 control-plane /ws/execution-logs 仍需 QA 最终签收。',
    evidence: 'docs/qa-evidence/A02_EXECUTION_MONITOR_LOCAL_EVIDENCE_2026-04-14',
  },
  {
    id: 'A-03',
    title: 'Group-collab frozen contract signoff',
    owner: 'QA审核 + AI群协作集成工程师',
    status: 'passed',
    summary: 'frozen contract、traceability 字段和后端本地闭环证据已齐。',
    evidence: 'backend/src/integrations/group-collab/FROZEN_CONTRACT.md',
  },
  {
    id: 'A-04',
    title: 'Demo skills freeze recognition',
    owner: 'Skills负责人 + 项目总控',
    status: 'watch',
    summary: 'freeze 已签字，当前主要剩发布流程认可。',
    evidence: 'packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md',
  },
  {
    id: 'A-05',
    title: 'Knowledge boundary and consumer signoff',
    owner: 'QA审核 + 知识库优化负责人',
    status: 'passed',
    summary: 'tenant-private summaries 已能被知识库页、主管页、任务页消费，QA 和知识库侧已通过。',
    evidence: 'backend/test-results/group-collab-closeout-2026-04-13T15-20-02-463Z',
  },
] as const;

const STATUS_OPTIONS: CheckStatus[] = ['pending', 'passed', 'watch', 'blocked'];
const CHECK_GROUPS: CheckGroup[] = ['P0 链路', '治理台', '收尾留痕'];

function statusLabel(status: CheckStatus): string {
  if (status === 'passed') return '已通过';
  if (status === 'watch') return '观察中';
  if (status === 'blocked') return '阻塞';
  return '待验证';
}

function statusTone(status: CheckStatus): string {
  if (status === 'passed') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
  if (status === 'watch') return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100';
  if (status === 'blocked') return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
  return 'border-slate-400/20 bg-slate-400/10 text-slate-200';
}

function priorityTone(priority: ReleaseCheckItem['priority']): string {
  if (priority === 'P0') return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
  if (priority === 'P1') return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  return 'border-slate-400/20 bg-slate-400/10 text-slate-200';
}

function loadStoredStatus(): Record<string, CheckStatus> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? ((JSON.parse(raw) as Record<string, CheckStatus>) ?? {}) : {};
  } catch {
    return {};
  }
}

function formatReport(items: ReleaseCheckItem[], statusById: Record<string, CheckStatus>): string {
  const counts = STATUS_OPTIONS.map((status) => ({
    status,
    count: items.filter((item) => (statusById[item.id] ?? 'pending') === status).length,
  }));
  return [
    'OpenClaw 前端收尾联调报告',
    `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '状态汇总:',
    ...counts.map((item) => `- ${statusLabel(item.status)}: ${item.count}`),
    '',
    '检查项:',
    ...items.map((item, index) => [
      `${index + 1}. [${statusLabel(statusById[item.id] ?? 'pending')}] ${item.title}`,
      `   owner: ${item.owner}`,
      `   priority: ${item.priority}`,
      `   verify: ${item.verify}`,
      `   pass when: ${item.passWhen}`,
      `   fallback: ${item.fallback}`,
      `   href: ${item.href}`,
    ].join('\n')),
  ].join('\n');
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <span className="mr-2 text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ChecklistCard({
  item,
  status,
  onStatusChange,
}: {
  item: ReleaseCheckItem;
  status: CheckStatus;
  onStatusChange: (status: CheckStatus) => void;
}) {
  return (
    <article className="rounded-[26px] border border-white/10 bg-slate-950/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">{item.title}</div>
          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{item.owner}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs ${priorityTone(item.priority)}`}>{item.priority}</span>
          <span className={`rounded-full border px-3 py-1 text-xs ${statusTone(status)}`}>{statusLabel(status)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onStatusChange(option)}
            className={`rounded-2xl border px-3 py-2 text-xs transition ${
              status === option
                ? statusTone(option)
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
            }`}
          >
            {statusLabel(option)}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
        <InfoLine label="验证" value={item.verify} />
        <InfoLine label="fallback" value={item.fallback} />
        <InfoLine label="通过条件" value={item.passWhen} />
      </div>

      <Link
        href={item.href}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
      >
        打开验收入口
        <ExternalLink className="h-4 w-4" />
      </Link>
    </article>
  );
}

function DecisionCard({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="text-lg font-semibold">{label}</div>
      <div className="mt-3 text-sm leading-7">{detail}</div>
    </div>
  );
}

export default function ReleaseChecklistPage() {
  const [statusById, setStatusById] = useState<Record<string, CheckStatus>>({});
  const [copiedMessage, setCopiedMessage] = useState('');
  const [latestGate, setLatestGate] = useState<LatestReleaseGateResponse | null>(null);
  const [latestGateLoading, setLatestGateLoading] = useState(false);
  const [latestGateError, setLatestGateError] = useState('');

  useEffect(() => {
    setStatusById(loadStoredStatus());
  }, []);

  async function refreshLatestGate() {
    setLatestGateLoading(true);
    setLatestGateError('');
    try {
      const payload = await fetchLatestReleaseGate();
      setLatestGate(payload);
    } catch (error) {
      setLatestGate(null);
      setLatestGateError(error instanceof Error ? error.message : 'release gate request failed');
    } finally {
      setLatestGateLoading(false);
    }
  }

  useEffect(() => {
    void refreshLatestGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(statusById));
  }, [statusById]);

  const counts = useMemo(() => {
    return STATUS_OPTIONS.reduce<Record<CheckStatus, number>>((acc, status) => {
      acc[status] = CHECK_ITEMS.filter((item) => (statusById[item.id] ?? 'pending') === status).length;
      return acc;
    }, { pending: 0, passed: 0, watch: 0, blocked: 0 });
  }, [statusById]);

  const groupedItems = useMemo(() => {
    return CHECK_ITEMS.reduce<Record<CheckGroup, ReleaseCheckItem[]>>((acc, item) => {
      acc[item.group].push(item);
      return acc;
    }, { 'P0 链路': [], '治理台': [], '收尾留痕': [] });
  }, []);

  const decision = counts.blocked > 0
    ? 'No-Go'
    : counts.pending > 0 || counts.watch > 0
      ? 'Canary'
      : 'Go';
  const knowledgeEvidence = resolveLatestKnowledgeEvidence(latestGate);
  const frontendCloseout = resolveLatestFrontendCloseout(latestGate);

  async function copyChecklistReport() {
    try {
      await navigator.clipboard.writeText(formatReport(CHECK_ITEMS, statusById));
      setCopiedMessage('已复制联调报告');
    } catch {
      setCopiedMessage('复制失败，请检查浏览器剪贴板权限');
    }
  }

  function resetChecklist() {
    setStatusById({});
    setCopiedMessage('已重置本地联调状态');
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="trace"
        step="阶段 C · 收尾联调"
        title="发版前稳定性检查清单"
        description="这页用于把收尾联调从口头确认变成可执行清单。状态只保存在当前浏览器，不改变后端数据。"
        previous={{ href: '/operations/monitor', label: '回执行监控室' }}
        next={{ href: '/operations/autopilot/trace', label: '去 Trace 复盘' }}
        actions={
          <>
            <button
              type="button"
              onClick={() => void copyChecklistReport()}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            >
              <Copy className="h-4 w-4" />
              复制联调报告
            </button>
            <button
              type="button"
              onClick={resetChecklist}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" />
              重置本地状态
            </button>
            <Link
              href={LEARNING_LOOP_ROUTES.acceptance.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/15"
            >
              {LEARNING_LOOP_ROUTES.acceptance.title}
              <ExternalLink className="h-4 w-4" />
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.projectCloseout.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100 transition hover:bg-fuchsia-400/15"
            >
              {LEARNING_LOOP_ROUTES.projectCloseout.title}
              <ExternalLink className="h-4 w-4" />
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.report.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15"
            >
              {LEARNING_LOOP_ROUTES.report.title}
              <ExternalLink className="h-4 w-4" />
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.frontendGaps.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-sm font-medium text-sky-100 transition hover:bg-sky-400/15"
            >
              {LEARNING_LOOP_ROUTES.frontendGaps.title}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </>
        }
      />

      {copiedMessage ? <div className="text-sm text-cyan-200">{copiedMessage}</div> : null}

      <section className="rounded-[30px] border border-emerald-400/20 bg-emerald-400/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-lg font-semibold text-white">Latest release gate</div>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              This panel reads the newest result from <code>npm run verify:release-gate:local</code> and shows the latest
              combined verdict from UI smoke plus local real-data evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshLatestGate()}
            disabled={latestGateLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${latestGateLoading ? 'animate-spin' : ''}`} />
            Refresh gate
          </button>
        </div>

        {latestGateError ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Latest release gate is not available yet: {latestGateError}
          </div>
        ) : null}

        {latestGate ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-base font-semibold text-white">Gate result</div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs ${
                    latestGate.summary.ok
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
                      : 'border-rose-400/25 bg-rose-400/10 text-rose-100'
                  }`}
                >
                  {latestGate.summary.ok ? 'pass' : 'needs attention'}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoLine label="generated" value={String(latestGate.summary.generated_at || '-')} />
                <InfoLine label="runtime" value={String(latestGate.summary.data_evidence?.runtime_mode || '-')} />
                <InfoLine label="artifact dir" value={latestGate.artifact_dir || '-'} />
                <InfoLine label="report" value={latestGate.report_path || '-'} />
              </div>
            </article>

            <article className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
              <div className="text-base font-semibold text-white">Verification metrics</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoLine
                  label="ui routes"
                  value={`${latestGate.summary.ui_smoke?.metrics?.passed_routes ?? 0}/${latestGate.summary.ui_smoke?.metrics?.total_routes ?? 0}`}
                />
                <InfoLine
                  label="ui interactions"
                  value={`${latestGate.summary.ui_smoke?.metrics?.passed_interactions ?? 0}/${latestGate.summary.ui_smoke?.metrics?.total_interactions ?? 0}`}
                />
                <InfoLine
                  label="data probes"
                  value={`${latestGate.summary.data_evidence?.metrics?.required_passed ?? 0}/${latestGate.summary.data_evidence?.metrics?.required_total ?? 0}`}
                />
                <InfoLine
                  label="dragon"
                  value={String(latestGate.summary.data_evidence?.dragon_url || '-')}
                />
              </div>
              {Array.isArray(latestGate.summary.notes) && latestGate.summary.notes.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-slate-400">
                  {latestGate.summary.notes.join(' | ')}
                </div>
              ) : null}
            </article>
          </div>
        ) : null}
      </section>

      <FrontendCloseoutVerificationSection
        description="把前端收尾验证也纳入 QA 清单入口。现在不用分别记 build 和 mock E2E，两者已经被统一成一条可重复执行的收尾命令。"
        actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
        actionLabel={`打开${LEARNING_LOOP_ROUTES.frontendGaps.title}`}
        latestResult={frontendCloseout}
      />

      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-lg font-semibold text-white">Final external gates</div>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              实现和本地验证已经基本收口，这里只保留真正还影响正式收尾的外部签收门禁，避免 QA 和总控在多个页面之间来回对照。
            </p>
          </div>
        </div>

        <div className="mt-4">
          <FinalExternalGatesGrid />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <SummaryCard icon={<ClipboardCheck className="h-5 w-5" />} label="总项数" value={String(CHECK_ITEMS.length)} />
        <SummaryCard icon={<CheckCircle2 className="h-5 w-5" />} label="已通过" value={String(counts.passed)} />
        <SummaryCard icon={<Route className="h-5 w-5" />} label="观察中" value={String(counts.watch)} />
        <SummaryCard icon={<AlertTriangle className="h-5 w-5" />} label="阻塞" value={String(counts.blocked)} />
        <SummaryCard icon={<ShieldCheck className="h-5 w-5" />} label="建议" value={decision} />
      </section>

      <section className="rounded-[30px] border border-cyan-400/20 bg-cyan-400/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-lg font-semibold text-white">A-05 知识三层签收命令</div>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              这组命令把“知识页能看到”升级成“真实 run-dragon-team 确实吃到了三层知识”。
              QA 先跑快速注入验证，再跑完整运行时证据，最后对照 REPORT.md 判断是否可以签收。
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {getKnowledgeEvidenceSnapshotText(knowledgeEvidence)}
          </div>
        </div>

        <div className="mt-5">
          <KnowledgeEvidenceCommandsGrid commands={KNOWLEDGE_EVIDENCE_COMMAND_ITEMS} />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <KnowledgeEvidenceRulesCard
            title="通过标准"
            rules={KNOWLEDGE_EVIDENCE_PASS_RULES}
            actionLinks={[
              { href: '/operations/knowledge-base', label: '看知识库页', tone: 'cyan' },
              { href: '/lobsters/capability-tree', label: '看主管消费页', tone: 'fuchsia' },
              { href: '/operations/workflow-board', label: '看任务消费页', tone: 'amber' },
            ]}
          />
          <KnowledgeEvidenceArtifactsCard paths={getKnowledgeEvidenceArtifacts(knowledgeEvidence)} />
        </div>
      </section>

      {CHECK_GROUPS.map((group) => (
        <section key={group} className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 text-lg font-semibold text-white">{group}</div>
          <div className="grid gap-4 xl:grid-cols-2">
            {groupedItems[group].map((item) => (
              <ChecklistCard
                key={item.id}
                item={item}
                status={statusById[item.id] ?? 'pending'}
                onStatusChange={(nextStatus) =>
                  setStatusById((prev) => ({
                    ...prev,
                    [item.id]: nextStatus,
                  }))
                }
              />
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-[30px] border border-white/10 bg-slate-950/35 p-5">
        <div className="mb-4 text-lg font-semibold text-white">Go / Canary / No-Go 口径</div>
        <div className="grid gap-4 md:grid-cols-3">
          <DecisionCard
            label="Go"
            detail="所有检查项已通过，且 Trace 能完成一次处理、验证、留痕闭环。"
            tone="border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
          />
          <DecisionCard
            label="Canary"
            detail="没有阻塞项，但仍有待验证或观察项，建议先内部或限定租户验证。"
            tone="border-cyan-400/25 bg-cyan-400/10 text-cyan-100"
          />
          <DecisionCard
            label="No-Go"
            detail="存在阻塞项，尤其是监控 fallback、日志 handoff、Trace 验效任一失败时不建议发版。"
            tone="border-rose-400/25 bg-rose-400/10 text-rose-100"
          />
        </div>
      </section>
    </div>
  );
}
