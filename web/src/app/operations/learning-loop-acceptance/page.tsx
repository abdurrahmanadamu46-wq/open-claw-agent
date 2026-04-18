'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  GitPullRequestArrow,
  ShieldCheck,
} from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import {
  KnowledgeEvidenceCommandsGrid,
  KnowledgeEvidenceRulesCard,
} from '@/components/operations/KnowledgeEvidenceSection';
import {
  KNOWLEDGE_EVIDENCE_COMMAND_ITEMS,
  KNOWLEDGE_EVIDENCE_COMMANDS,
  KNOWLEDGE_EVIDENCE_PASS_RULES,
  getKnowledgeEvidenceSnapshotText,
} from '@/lib/knowledge-evidence';
import {
  fetchLatestReleaseGate,
  resolveLatestKnowledgeEvidence,
  type LatestKnowledgeEvidenceSnapshot,
} from '@/lib/release-gate-client';

const ACCEPTANCE_ROUTES = [
  {
    href: LEARNING_LOOP_ROUTES.home.href,
    title: LEARNING_LOOP_ROUTES.home.title,
    description: '先确认首页是否能把学习闭环状态、信号、提案、效果和双轨记忆汇总到一屏。',
  },
  {
    href: LEARNING_LOOP_ROUTES.tenantCockpit.href,
    title: LEARNING_LOOP_ROUTES.tenantCockpit.title,
    description: '确认租户级总览是否能展示 readiness、review gate、effect recommendation 和 memory 摘要。',
  },
  {
    href: LEARNING_LOOP_ROUTES.skillsImprovements.href,
    title: LEARNING_LOOP_ROUTES.skillsImprovements.title,
    description: '确认真实信号、提案、扫描、审批、apply、rollback 和效果追踪都可操作。',
  },
  {
    href: LEARNING_LOOP_ROUTES.memory.href,
    title: LEARNING_LOOP_ROUTES.memory.title,
    description: '确认 resident / history 双轨记忆、source chain 和手动沉淀入口都可见。',
  },
  {
    href: LEARNING_LOOP_ROUTES.releaseChecklist.href,
    title: LEARNING_LOOP_ROUTES.releaseChecklist.title,
    description: '确认 QA 能逐项勾选并直接复制最终验收报告。',
  },
  {
    href: LEARNING_LOOP_ROUTES.report.href,
    title: LEARNING_LOOP_ROUTES.report.title,
    description: '确认老板或项目总控能一眼看懂当前学习闭环是否可继续推进。',
  },
  {
    href: LEARNING_LOOP_ROUTES.frontendGaps.href,
    title: LEARNING_LOOP_ROUTES.frontendGaps.title,
    description: '确认入口边界、联调风险、contract 缺口和 QA 推荐推进顺序已经对齐。',
  },
] as const;

const ACCEPTANCE_STEPS = [
  {
    title: '1. 先看首页是否有闭环状态',
    owner: 'QA 审核 + 项目总控',
    verify: '打开 `/`，检查学习闭环健康卡是否显示 readiness、signals/proposals/effects、apply/rollback、resident/history。',
    passWhen: '首页能够说清系统现在是等待信号、待审批、运行中，还是建议回滚复核。',
  },
  {
    title: '2. 验证双轨记忆',
    owner: '知识层负责人',
    verify: '打开 `/operations/memory`，检查常驻记忆、历史记忆、source chain、手动沉淀入口和脱敏结果。',
    passWhen: 'QA 能解释 resident 是小而稳定的运行时上下文，history 是大而可检索的历史材料。',
  },
  {
    title: '3. 跑知识三层 runtime evidence',
    owner: '知识库优化负责人 + QA 审核',
    verify: '先执行 local:context，再执行完整 local 命令，确认 REPORT.md 里出现 platform_common、platform_industry、tenant_private，且 tenant_private 大于 0。',
    passWhen: '报告满足 runtime_evidence、collab_dispatch、tenant_private > 0，并且 raw trace excluded / summary only / backflow blocked 全部为 yes。',
  },
  {
    title: '4. 验证真实信号进入学习闭环',
    owner: '技能负责人 + 后端工程师',
    verify: '打开 `/operations/skills-improvements`，确认 Automatic trigger signals 中能看到 runtime、feedback、edge telemetry 信号以及 created / skipped 原因。',
    passWhen: '信号能够正确关联 proposal，低置信度和重复信号不会反复造提案。',
  },
  {
    title: '5. 验证提案审批与补丁预览',
    owner: 'QA 审核 + 项目总控',
    verify: '选择一条 proposal，查看 evidence、scan report、before/after diff，并尝试执行 scan、approve 或 reject。',
    passWhen: '未扫描或 block 风险的提案不能直接 apply，approved 提案能展示字段级 diff。',
  },
  {
    title: '6. 验证 apply / rollback',
    owner: '稳定性负责人 + QA 审核',
    verify: '对 approved proposal 执行 apply，确认状态变为 applied；再执行 rollback，确认状态变为 rolled_back。',
    passWhen: 'apply 会写回 manifest，rollback 会用 before 快照恢复，且两步都有前端状态变化和审计留痕。',
  },
  {
    title: '7. 验证发布后的效果建议',
    owner: '稳定性负责人',
    verify: '查看 Post-apply effect tracking，确认 runtime、human feedback、edge telemetry 的效果事件和 avg_delta 可见。',
    passWhen: '系统只会给出 keep_applied、continue_observing、recommend_rollback 建议，不会自动回滚。',
  },
] as const;

const ACCEPTANCE_BOUNDARIES = [
  '边缘层只回传事实信号，不做 LLM、视频合成或学习决策。',
  '龙虾仍然是统一运行时里的角色协议，不是独立 agent。',
  'Skill 提案必须先 scan、再 approve，之后才允许 apply。',
  'recommend_rollback 只是建议，不自动执行 rollback。',
  '租户私有记忆不能静默上流成平台知识。',
] as const;

function buildAcceptanceMarkdown(knowledgeEvidence: LatestKnowledgeEvidenceSnapshot): string {
  return [
    '# OpenClaw 学习闭环验收说明',
    '',
    '## 核心能力',
    '- 双轨记忆：resident + history',
    '- 自动触发：signals -> proposal',
    '- 受控发布：approve -> apply',
    '- 恢复链路：rollback ready',
    '',
    '## 验收入口',
    ...ACCEPTANCE_ROUTES.map(
      (item, index) =>
        `${index + 1}. ${item.title}\n   - 路径: ${item.href}\n   - 说明: ${item.description}`,
    ),
    '',
    '## 一步一步验收',
    ...ACCEPTANCE_STEPS.map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        `   - Owner: ${item.owner}`,
        `   - 验证动作: ${item.verify}`,
        `   - 通过标准: ${item.passWhen}`,
      ].join('\n'),
    ),
    '',
    '## A-05 知识三层命令',
    ...KNOWLEDGE_EVIDENCE_COMMANDS.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## A-05 通过标准',
    ...KNOWLEDGE_EVIDENCE_PASS_RULES.map((item) => `- ${item}`),
    '',
    '## A-05 最新样本',
    `- mode: ${knowledgeEvidence.mode}`,
    `- seed_strategy: ${knowledgeEvidence.seedStrategy}`,
    `- tenant_private: ${knowledgeEvidence.tenantPrivate}`,
    ...(knowledgeEvidence.reportPath ? [`- report: ${knowledgeEvidence.reportPath}`] : []),
    '',
    '## 不可越过的边界',
    ...ACCEPTANCE_BOUNDARIES.map((item) => `- ${item}`),
  ].join('\n');
}

export default function LearningLoopAcceptancePage() {
  const [copyMessage, setCopyMessage] = useState('');
  const releaseGateQuery = useQuery({
    queryKey: ['learning-loop-acceptance', 'release-gate-latest'],
    queryFn: fetchLatestReleaseGate,
    retry: false,
    staleTime: 60 * 1000,
  });
  const knowledgeEvidence = resolveLatestKnowledgeEvidence(releaseGateQuery.data);

  async function copyMarkdownSummary() {
    try {
      await navigator.clipboard.writeText(buildAcceptanceMarkdown(knowledgeEvidence));
      setCopyMessage('已复制学习闭环验收 Markdown 摘要');
    } catch {
      setCopyMessage('复制失败，请检查浏览器剪贴板权限');
    }
  }

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Final Acceptance / Learning Loop"
        title="学习闭环验收说明"
        description="这页把双轨记忆、技能提案、审批门禁、apply / rollback、效果追踪和 QA 入口收成一份可执行的验收说明。适合 QA、项目总控和后续接手同学统一口径。"
        actions={
          <>
            <Link
              href={LEARNING_LOOP_ROUTES.releaseChecklist.href}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              打开 QA 勾选清单
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.skillsImprovements.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开 Skill 进化台
            </Link>
            <Link
              href={LEARNING_LOOP_ROUTES.report.href}
              className="inline-flex items-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-3 text-sm font-medium text-fuchsia-100"
            >
              打开老板汇报页
            </Link>
            <button
              type="button"
              onClick={() => void copyMarkdownSummary()}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100"
            >
              复制 Markdown 摘要
            </button>
          </>
        }
      />

      {copyMessage ? <div className="text-sm text-cyan-200">{copyMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric
          label="双轨记忆"
          value="resident + history"
          helper="常驻小记忆 + 可检索历史"
          icon={<Database className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="自动触发"
          value="signals -> proposal"
          helper="失败、改稿、低分、边缘重试"
          icon={<BrainCircuit className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="受控发布"
          value="approve -> apply"
          helper="只有已批准提案才允许改 manifest"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="恢复链路"
          value="rollback ready"
          helper="applied 后可用 before 快照恢复"
          icon={<GitPullRequestArrow className="h-4 w-4" />}
        />
      </section>

      <SurfaceSection
        title="验收入口"
        description="按这个顺序看，最快判断学习闭环是否已经从运行时、记忆层、前端和 QA 清单四个方向收口。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ACCEPTANCE_ROUTES.map((item) => (
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
        title="A-05 知识三层验收"
        description="这一步专门验证知识边界不是只停留在页面展示，而是真正进了 run-dragon-team 的运行时消费。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <KnowledgeEvidenceCommandsGrid commands={KNOWLEDGE_EVIDENCE_COMMAND_ITEMS} />
          <KnowledgeEvidenceRulesCard
            title="签收标准"
            rules={KNOWLEDGE_EVIDENCE_PASS_RULES}
            summaryText={getKnowledgeEvidenceSnapshotText(knowledgeEvidence)}
            actionLinks={[
              { href: LEARNING_LOOP_ROUTES.releaseChecklist.href, label: '打开 QA 清单', tone: 'amber' },
              { href: '/operations/knowledge-base', label: '打开知识库页', tone: 'cyan' },
              { href: '/operations/workflow-board', label: '打开任务消费页', tone: 'fuchsia' },
            ]}
          />
        </div>
        {knowledgeEvidence.reportPath ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs text-cyan-200">
            {knowledgeEvidence.reportPath}
          </div>
        ) : null}
      </SurfaceSection>

      <SurfaceSection
        title="一步一步验收"
        description="这些步骤可以直接分发给 QA、知识层负责人、技能负责人和稳定性负责人。"
      >
        <div className="space-y-3">
          {ACCEPTANCE_STEPS.map((item) => (
            <article key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{item.title}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{item.owner}</div>
                </div>
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <InfoBlock label="验证动作" value={item.verify} />
                <InfoBlock label="通过标准" value={item.passWhen} />
              </div>
            </article>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="不可越过的边界"
        description="这些规则是商业化安全底线，也是 QA 判断是否可放行的红线。"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {ACCEPTANCE_BOUNDARIES.map((item) => (
            <SurfaceStateCard key={item} kind="warn" title="边界规则" description={item} />
          ))}
        </div>
      </SurfaceSection>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm leading-7 text-slate-200">{value}</div>
    </div>
  );
}
