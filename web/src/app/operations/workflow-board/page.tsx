'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ApprovalPanel } from '@/components/workflow/ApprovalPanel';
import { LobsterRoster } from '@/components/workflow/LobsterRoster';
import { WorkflowBoard } from '@/components/workflow/WorkflowBoard';
import { WorkflowHeader } from '@/components/workflow/WorkflowHeader';
import {
  getWorkflowBoardMock,
  type IndustryWorkflowFrontendPreview,
  type IndustryWorkflowFrontendPreviewStepCard,
} from '@/data/workflow-board-mock';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';

async function fetchWorkflowPreview(workflowId: string): Promise<IndustryWorkflowFrontendPreview> {
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    const isPreview = (hostname === '127.0.0.1' || hostname === 'localhost') && ['3000', '3001', '3002', '3003', '3005'].includes(port || '');
    if (isPreview) {
      return getWorkflowBoardMock(workflowId);
    }
  }
  try {
    const response = await fetch(`/api/agent/industry/preview?workflowId=${encodeURIComponent(workflowId)}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`preview ${response.status}`);
    return (await response.json()) as IndustryWorkflowFrontendPreview;
  } catch {
    return getWorkflowBoardMock(workflowId);
  }
}

function WorkflowBoardPageInner() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get('workflowId') || 'wf_demo_food_growth';
  const [selectedStep, setSelectedStep] = useState<IndustryWorkflowFrontendPreviewStepCard | null>(null);
  const [approvalLog, setApprovalLog] = useState<Array<{ stepId: string; decision: 'approved' | 'rejected' }>>([]);

  const query = useQuery({
    queryKey: ['workflow-board', workflowId],
    queryFn: () => fetchWorkflowPreview(workflowId),
  });

  const preview = query.data;
  const approvalCounts = useMemo(
    () => ({
      approved: approvalLog.filter((item) => item.decision === 'approved').length,
      rejected: approvalLog.filter((item) => item.decision === 'rejected').length,
    }),
    [approvalLog],
  );

  function handleApprove(stepId: string) {
    setApprovalLog((prev) => [...prev, { stepId, decision: 'approved' }]);
    console.log('[workflow-board] approve', stepId);
  }

  function handleReject(stepId: string) {
    setApprovalLog((prev) => [...prev, { stepId, decision: 'rejected' }]);
    console.log('[workflow-board] reject', stepId);
  }

  if (query.isLoading || !preview) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-40 rounded-2xl bg-gray-900/70" />
        <Skeleton className="h-32 rounded-2xl bg-gray-900/70" />
        <Skeleton className="h-[480px] rounded-2xl bg-gray-900/70" />
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-gray-950 p-6 text-gray-100">
      <WorkflowHeader header={preview.header} highlights={preview.highlights} />

      <div className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
        <LobsterRoster agents={preview.baselineAgentSummary} />

        <div className="space-y-4">
          <ApprovalPanel
            approvalCards={preview.approvalCards}
            onApprove={handleApprove}
            onReject={handleReject}
          />

          <div className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
            <div className="text-sm font-semibold text-gray-100">审批日志</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-green-500/25 bg-green-500/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-green-300">通过</div>
                <div className="mt-2 text-2xl font-semibold text-gray-100">{approvalCounts.approved}</div>
              </div>
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-red-300">拒绝</div>
                <div className="mt-2 text-2xl font-semibold text-gray-100">{approvalCounts.rejected}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <WorkflowBoard
        preview={preview}
        onStepClick={setSelectedStep}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <Dialog open={!!selectedStep} onOpenChange={(open) => !open && setSelectedStep(null)}>
        <DialogContent className="bg-gray-900">
          <DialogHeader>
            <DialogTitle>{selectedStep?.title || '步骤详情'}</DialogTitle>
            <DialogClose onClose={() => setSelectedStep(null)} />
          </DialogHeader>
          {selectedStep ? (
            <div className="space-y-4 p-6 text-sm text-gray-200">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">目标</div>
                <div className="mt-2 leading-7">{selectedStep.goal}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">操作清单</div>
                  <ul className="mt-2 space-y-2">
                    {selectedStep.operatorChecklist.map((item) => (
                      <li key={item} className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">缺失字段</div>
                  {selectedStep.payloadGaps.length === 0 ? (
                    <div className="mt-2 text-gray-400">当前没有缺失字段。</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedStep.payloadGaps.map((gap) => (
                        <div key={`${gap.fieldPath}-${gap.source}`} className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
                          <div className="font-medium text-gray-100">{gap.fieldPath}</div>
                          <div className="mt-1 text-xs text-gray-400">{gap.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">建议命令</div>
                <div className="mt-2 space-y-2">
                  {selectedStep.suggestedCommands.map((cmd) => (
                    <div key={cmd} className="rounded-lg border border-white/6 bg-black/20 px-3 py-2 font-mono text-xs text-cyan-100">
                      {cmd}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkflowBoardPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-[520px] rounded-2xl bg-gray-900/70" /></div>}>
      <WorkflowBoardPageInner />
    </Suspense>
  );
}
