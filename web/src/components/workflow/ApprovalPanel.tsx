'use client';

import { LOBSTER_META, type IndustryWorkflowFrontendPreviewStepCard } from '@/data/workflow-board-mock';
import { Button } from '@/components/ui/Button';

export interface ApprovalPanelProps {
  approvalCards: IndustryWorkflowFrontendPreviewStepCard[];
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
}

export function ApprovalPanel({ approvalCards, onApprove, onReject }: ApprovalPanelProps) {
  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-100">审批面板</div>
          <div className="mt-1 text-xs text-gray-400">适合快速处理待审批步骤，特别是移动端和值班场景。</div>
        </div>
        <span className="rounded-full border border-yellow-500/25 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-300">
          {approvalCards.length} 项待处理
        </span>
      </div>

      {approvalCards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-gray-400">
          当前没有待审批步骤。
        </div>
      ) : (
        <div className="space-y-3">
          {approvalCards.map((card) => {
            const owner = LOBSTER_META[card.ownerRole] || { zhName: card.ownerRole, emoji: '🦞' };
            return (
              <div key={card.stepId} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-100">{card.title}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      {owner.emoji} {owner.zhName} · 风险动作：{card.approvalActions.join(' / ')}
                    </div>
                  </div>
                  <span className="rounded-full border border-yellow-500/25 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-300">
                    {card.readinessState}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="primary" className="h-9 px-3 text-xs" onClick={() => onApprove(card.stepId)}>
                    通过
                  </Button>
                  <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => onReject(card.stepId)}>
                    拒绝
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
