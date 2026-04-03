'use client';

import type {
  IndustryWorkflowFrontendPreview,
  IndustryWorkflowFrontendPreviewLane,
  IndustryWorkflowFrontendPreviewStepCard,
} from '@/data/workflow-board-mock';
import { StepCard } from './StepCard';

export interface WorkflowBoardProps {
  preview: IndustryWorkflowFrontendPreview;
  onStepClick?: (stepCard: IndustryWorkflowFrontendPreviewStepCard) => void;
  onApprove?: (stepId: string) => void;
  onReject?: (stepId: string) => void;
}

const LANE_ORDER: IndustryWorkflowFrontendPreviewLane['laneId'][] = [
  'strategy',
  'content',
  'runtime',
  'lead',
  'conversion',
  'review',
  'risk',
];

export function WorkflowBoard({ preview, onStepClick, onApprove, onReject }: WorkflowBoardProps) {
  const orderedLanes = [...preview.workflowLanes].sort(
    (a, b) => LANE_ORDER.indexOf(a.laneId) - LANE_ORDER.indexOf(b.laneId),
  );

  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-900/60 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-100">工作流看板</div>
        <div className="mt-1 text-xs text-gray-400">桌面端按泳道横向展开，移动端自动改成纵向堆叠。</div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 md:flex-row">
        {orderedLanes.map((lane) => {
          const approvalCount = lane.stepCards.filter((card) => card.approvalRequired).length;

          return (
            <div
              key={lane.laneId}
              className="min-w-[280px] flex-1 rounded-2xl border border-gray-700 bg-gray-800/80 p-3"
            >
              <div className="mb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-100">{lane.label}</div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-gray-300">
                      {lane.stepCount} 步
                    </span>
                    {approvalCount > 0 && (
                      <span className="rounded-full border border-yellow-500/25 bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-300">
                        {approvalCount} 审批
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lane.laneBadges.map((badge) => (
                    <span key={`${lane.laneId}-${badge}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-gray-400">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {lane.stepCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-gray-500">
                    当前泳道暂无步骤。
                  </div>
                ) : (
                  lane.stepCards.map((card) => (
                    <StepCard
                      key={card.stepId}
                      card={card}
                      onClick={() => onStepClick?.(card)}
                      onApprove={() => onApprove?.(card.stepId)}
                      onReject={() => onReject?.(card.stepId)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
