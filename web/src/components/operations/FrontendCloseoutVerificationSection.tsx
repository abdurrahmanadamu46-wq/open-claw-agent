'use client';

import { useState } from 'react';
import { SurfaceSection } from '@/components/operations/SurfacePrimitives';
import { formatFrontendCloseoutSummary } from '@/lib/frontend-closeout-summary';
import type { LatestFrontendCloseoutSnapshot } from '@/lib/release-gate-client';

const MANUAL_REVIEW_STEPS = [
  { route: '/', check: '确认首页健康卡、学习闭环状态、主入口导航和项目收口入口都可见。' },
  { route: '/operations/tenant-cockpit', check: '确认租户总览、学习闭环摘要和继续查看入口能串起来。' },
  { route: '/operations/skills-improvements', check: '确认信号、提案、审批、apply、rollback 和效果追踪能完整表达。' },
  { route: '/operations/memory', check: '确认 resident / history 双轨记忆、source chain 和手动沉淀入口可见。' },
  { route: '/operations/release-checklist', check: '确认 QA 能按项勾选，并能跳到验收说明、汇报页和联调辅助总表。' },
  { route: '/operations/learning-loop-acceptance', check: '确认验收步骤、复制 Markdown 摘要和相关入口完整。' },
  { route: '/operations/learning-loop-report', check: '确认老板汇报页能看到风险、建议、release gate 和前端联调辅助总表入口。' },
  { route: '/operations/project-closeout', check: '确认项目总收口页能展示前端收口状态、release gate、外部签收和仓库文档。' },
  { route: '/operations/frontend-gaps', check: '确认前端联调辅助总表能说明入口边界、contract 风险和下一步推进顺序。' },
] as const;

export function FrontendCloseoutVerificationSection({
  description = '跑一条命令，再按人工路线复看一遍，就能确认当前前端收尾基线是否仍然完整可用。',
  actionHref,
  actionLabel,
  latestResult,
}: {
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  latestResult?: LatestFrontendCloseoutSnapshot;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  const summaryText = latestResult?.available
    ? latestResult.ok
      ? '最近一次前端收尾命令已经全链通过，说明类型检查、独立构建、关键页面截图和 operations 扫描当前都处于绿色状态。'
      : '最近一次前端收尾命令仍有阻塞，请沿着下面的 artifact 路径定位失败步骤，再重新运行验证。'
    : '当前还没有挂上前端收尾结果。先跑一次命令，这里就会显示最新通过/失败快照和产物路径。';

  async function copySummary() {
    const fallback: LatestFrontendCloseoutSnapshot = latestResult ?? {
      available: false,
      ok: false,
      generatedAt: '-',
      artifactDir: '',
      summaryPath: '',
      reportPath: '',
      screenshotArtifactDir: '',
      operationsScanArtifactDir: '',
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      frontendCriticalPassed: 0,
      frontendCriticalTotal: 0,
      frontendCriticalFailed: 0,
      operationsScanCovered: 0,
      operationsScanTotal: 0,
      operationsScanUncovered: 0,
      operationsScanHighPriorityIssues: 0,
      copyableSummary: '',
      steps: [],
    };

    try {
      await navigator.clipboard.writeText(formatFrontendCloseoutSummary(fallback));
      setCopyMessage('已复制前端收尾摘要');
    } catch {
      setCopyMessage('复制失败，请手动复制证据路径');
    }
  }

  return (
    <SurfaceSection
      title="前端收尾验证"
      description={description}
      actionHref={actionHref}
      actionLabel={actionLabel}
    >
      <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-4">
          <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Command</div>
            <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-xs text-cyan-100">
              <code>cd web &amp;&amp; npm run verify:closeout:frontend</code>
            </pre>
            <div className="mt-3 text-sm leading-7 text-slate-300">
              这条命令会依次跑类型检查、独立构建、关键页面截图证据和 operations 扫描，并把本轮收尾结果写成可追溯 artifact。
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">What it checks</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                tsc
              </span>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                isolated build
              </span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                screenshot evidence
              </span>
              <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-100">
                operations scan
              </span>
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Manual review route</div>
            <div className="mt-3 space-y-2">
              {MANUAL_REVIEW_STEPS.map((step, index) => (
                <div key={step.route} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">
                      {index + 1}
                    </span>
                    <span className="font-mono text-xs text-cyan-200">{step.route}</span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-slate-300">{step.check}</div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest result</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copySummary()}
              className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-400/15"
            >
              复制前端收尾摘要
            </button>
            {copyMessage ? <span className="text-xs text-cyan-200">{copyMessage}</span> : null}
          </div>
          {latestResult?.available ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-xs ${
                    latestResult.ok
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                  }`}
                >
                  {latestResult.ok ? 'pass' : 'fail'}
                </span>
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                  steps {latestResult.passedSteps}/{latestResult.totalSteps}
                </span>
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                  screenshots {latestResult.frontendCriticalPassed}/{latestResult.frontendCriticalTotal}
                </span>
                <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-100">
                  operations {latestResult.operationsScanCovered}/{latestResult.operationsScanTotal}
                </span>
                {latestResult.failedSteps > 0 ? (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-100">
                    failed {latestResult.failedSteps}
                  </span>
                ) : null}
                {latestResult.operationsScanHighPriorityIssues > 0 ? (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-100">
                    scan issues {latestResult.operationsScanHighPriorityIssues}
                  </span>
                ) : null}
              </div>
              <div className="text-sm leading-7 text-slate-300">{summaryText}</div>
              <div className="text-sm text-slate-300">Generated: {latestResult.generatedAt}</div>
              <ArtifactPath label="Summary source" value={latestResult.summaryPath} />
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Step summary</div>
                <div className="mt-3 grid gap-2">
                  {latestResult.steps.map((step) => (
                    <div key={step.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-slate-950/35 px-3 py-2">
                      <div>
                        <div className="text-xs font-semibold text-white">{step.label}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{Math.round(step.durationMs / 1000)}s</div>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          step.exitCode === 0
                            ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                            : 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                        }`}
                      >
                        {step.exitCode === 0 ? 'pass' : `fail ${step.exitCode}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <ArtifactPath label="Closeout artifact" value={latestResult.artifactDir} />
              <ArtifactPath label="Closeout report" value={latestResult.reportPath} />
              <ArtifactPath label="Screenshot artifact" value={latestResult.screenshotArtifactDir} />
              <ArtifactPath label="Operations scan artifact" value={latestResult.operationsScanArtifactDir} />
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="text-sm leading-7 text-slate-300">{summaryText}</div>
              <div className="font-mono text-xs text-cyan-200">web/test-results/frontend-closeout-*</div>
            </div>
          )}
        </article>
      </div>
    </SurfaceSection>
  );
}

function ArtifactPath({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 font-mono text-xs text-cyan-200">{value || '-'}</div>
    </div>
  );
}
