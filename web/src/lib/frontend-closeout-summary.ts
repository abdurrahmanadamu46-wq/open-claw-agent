import type { LatestFrontendCloseoutSnapshot } from '@/lib/release-gate-client';

export function formatFrontendCloseoutSummary(closeout: LatestFrontendCloseoutSnapshot): string {
  if (closeout.copyableSummary) return closeout.copyableSummary;

  if (!closeout.available) {
    return [
      '前端收尾验证',
      '结果：暂无最新证据包',
      '命令：cd web && npm run verify:closeout:frontend',
      '下一步：先运行一次命令，再刷新收尾页面。',
    ].join('\n');
  }

  return [
    '前端收尾验证',
    `结果：${closeout.ok ? '通过' : '未通过'}`,
    `生成时间：${closeout.generatedAt}`,
    `步骤：${closeout.passedSteps}/${closeout.totalSteps} 通过`,
    `关键页面截图：${closeout.frontendCriticalPassed}/${closeout.frontendCriticalTotal} 通过`,
    `operations 扫描：${closeout.operationsScanCovered}/${closeout.operationsScanTotal} 覆盖`,
    ...closeout.steps.map(
      (step) =>
        `- ${step.label}：${step.exitCode === 0 ? '通过' : `失败 ${step.exitCode}`}（${Math.round(
          step.durationMs / 1000,
        )} 秒）`,
    ),
    `摘要来源：${closeout.summaryPath || '-'}`,
    `收尾证据包：${closeout.artifactDir || '-'}`,
    `收尾报告：${closeout.reportPath || '-'}`,
    `关键页面截图证据：${closeout.screenshotArtifactDir || '-'}`,
    `operations 页面扫描证据：${closeout.operationsScanArtifactDir || '-'}`,
  ].join('\n');
}

export function formatFrontendCloseoutSummaryAsMarkdownList(
  closeout: LatestFrontendCloseoutSnapshot,
): string[] {
  return formatFrontendCloseoutSummary(closeout)
    .split('\n')
    .map((line, index) => (index === 0 ? `- ${line}` : `  - ${line}`));
}
