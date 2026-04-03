'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldCheck, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LOBSTER_META, type IndustryWorkflowFrontendPreviewStepCard } from '@/data/workflow-board-mock';

export interface StepCardProps {
  card: IndustryWorkflowFrontendPreviewStepCard;
  onClick?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

function readinessTone(state: IndustryWorkflowFrontendPreviewStepCard['readinessState']) {
  switch (state) {
    case 'ready':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'approval_pending':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'blocked':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'watch':
    default:
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  }
}

function readinessLabel(state: IndustryWorkflowFrontendPreviewStepCard['readinessState']) {
  switch (state) {
    case 'ready':
      return '可执行';
    case 'approval_pending':
      return '待审批';
    case 'blocked':
      return '已阻塞';
    case 'watch':
    default:
      return '需关注';
  }
}

export function StepCard({ card, onClick, onApprove, onReject }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);

  const ownerMeta = useMemo(
    () => LOBSTER_META[card.ownerRole] || { zhName: card.ownerRole, emoji: '🦞' },
    [card.ownerRole],
  );

  const gapCount = card.payloadGaps.length;
  const checklistCount = card.operatorChecklist.length;

  function handleToggle() {
    setExpanded((value) => !value);
    onClick?.();
  }

  return (
    <Card className="border border-gray-700 bg-gray-800 p-0 shadow-none">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">步骤 {card.stepNumber}</div>
            <CardTitle className="mt-2 text-base text-gray-100">{card.title}</CardTitle>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-300">
              <span className="text-base">{ownerMeta.emoji}</span>
              <span>{ownerMeta.zhName}</span>
            </div>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${readinessTone(card.readinessState)}`}>
            {readinessLabel(card.readinessState)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm leading-6 text-gray-300">{card.goal}</p>

        <div className="flex flex-wrap gap-2">
          {card.badges.map((badge) => (
            <span key={badge} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-300">
              {badge}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="uppercase tracking-[0.18em] text-gray-500">主输出</div>
            <div className="mt-2 text-sm text-gray-100">{card.primaryOutput || '待生成'}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="uppercase tracking-[0.18em] text-gray-500">桥接目标</div>
            <div className="mt-2 text-sm text-gray-100">{card.bridgeTarget}</div>
          </div>
        </div>

        {card.approvalRequired && (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-yellow-300">
              <ShieldCheck className="h-4 w-4" />
              需要审批
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {card.approvalActions.map((action) => (
                <span key={action} className="rounded-full border border-yellow-400/25 px-2 py-1 text-[11px] text-yellow-200">
                  {action}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" className="h-9 px-3 text-xs" onClick={onApprove}>
                通过
              </Button>
              <Button variant="danger" className="h-9 px-3 text-xs" onClick={onReject}>
                拒绝
              </Button>
            </div>
          </div>
        )}

        {card.blockedReason && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {card.blockedReason}
          </div>
        )}

        <button
          type="button"
          onClick={handleToggle}
          className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 transition hover:bg-white/[0.06]"
        >
          <span>展开详情</span>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {expanded && (
          <div className="space-y-3 rounded-xl border border-white/8 bg-gray-950/50 p-4">
            <section>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">操作清单</div>
              {checklistCount === 0 ? (
                <p className="mt-2 text-sm text-gray-400">当前没有操作清单。</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm text-gray-300">
                  {card.operatorChecklist.map((item) => (
                    <li key={item} className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">缺失字段</div>
              {gapCount === 0 ? (
                <p className="mt-2 text-sm text-gray-400">当前没有关键字段缺口。</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {card.payloadGaps.map((gap) => (
                    <div key={`${gap.fieldPath}-${gap.source}`} className="rounded-lg border border-white/6 bg-white/[0.03] p-3 text-sm text-gray-300">
                      <div className="font-medium text-gray-100">{gap.fieldPath}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {gap.source} · {gap.required ? '必填' : '可选'}
                      </div>
                      <div className="mt-2">{gap.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">
                <TerminalSquare className="h-3.5 w-3.5" />
                建议命令
              </div>
              {card.suggestedCommands.length === 0 ? (
                <p className="mt-2 text-sm text-gray-400">当前没有建议命令。</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {card.suggestedCommands.map((cmd) => (
                    <div key={cmd} className="rounded-lg border border-white/6 bg-gray-900 px-3 py-2 font-mono text-xs text-cyan-100">
                      {cmd}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
