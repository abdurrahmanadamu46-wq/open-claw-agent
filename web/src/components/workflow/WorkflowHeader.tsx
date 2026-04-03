'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { IndustryWorkflowFrontendPreview } from '@/data/workflow-board-mock';

interface WorkflowHeaderProps {
  header: IndustryWorkflowFrontendPreview['header'];
  highlights: IndustryWorkflowFrontendPreview['highlights'];
}

export function WorkflowHeader({ header, highlights }: WorkflowHeaderProps) {
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Workflow Preview</div>
            <h1 className="mt-2 text-3xl font-semibold text-gray-100">{header.industryLabel}</h1>
            <p className="mt-2 text-sm text-gray-300">{header.brandName}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {header.channels.map((channel) => (
                <span key={channel} className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                  {channel}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="总步骤数" value={header.totalSteps} />
            <StatCard label="运行时步骤" value={header.runtimeStepCount} />
            <StatCard label="审批步骤" value={header.approvalStepCount} />
            <StatCard label="门控步骤" value={header.gatedStepCount} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <HighlightCard label="选题评分维度" value={highlights.topicRubricCount} />
        <HighlightCard label="云端输出数" value={highlights.cloudOutputCount} />
        <HighlightCard label="边缘输出数" value={highlights.edgeOutputCount} />
        <HighlightCard label="参与 Agent 数" value={highlights.baselineAgentCount} />
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border border-gray-700 bg-gray-900/70 p-0 shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm text-gray-400">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-2xl font-semibold text-gray-100">{value}</CardContent>
    </Card>
  );
}

function HighlightCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-100">{value}</div>
    </div>
  );
}
