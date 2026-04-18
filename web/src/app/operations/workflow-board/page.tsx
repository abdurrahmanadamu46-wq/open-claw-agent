'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ApprovalPanel } from '@/components/workflow/ApprovalPanel';
import { LobsterRoster } from '@/components/workflow/LobsterRoster';
import { WorkflowBoard } from '@/components/workflow/WorkflowBoard';
import { WorkflowHeader } from '@/components/workflow/WorkflowHeader';
import type { IndustryWorkflowFrontendPreviewStepCard } from '@/data/workflow-board-mock';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { previewIndustryWorkflow } from '@/services/endpoints/industry-workflow';
import {
  buildIndustryWorkflowBlueprintPreview,
  readIndustryWorkflowHandoff,
} from '@/lib/industry-workflow';
import {
  buildDefaultWorkflowBoardRequest,
  buildWorkflowBoardPreviewFromBlueprint,
} from '@/lib/workflow-board-preview';
import { useTenant } from '@/contexts/TenantContext';
import { KnowledgeContextEvidence } from '@/components/knowledge/KnowledgeContextEvidence';
import {
  fetchControlPlaneTenantPrivateKnowledgeSummaries,
  resolveControlPlaneKnowledge,
} from '@/services/endpoints/control-plane-overview';
import type { ControlPlaneCollabSummaryEntry as GroupCollabTenantPrivateSummaryEntry } from '@/types/control-plane-overview';

function WorkflowBoardPageInner() {
  const searchParams = useSearchParams();
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_demo';
  const workflowId = searchParams?.get('workflowId') || 'wf_demo_food_growth';
  const handoff = useMemo(() => readIndustryWorkflowHandoff(), []);
  const request = useMemo(() => {
    if (handoff?.request) {
      return {
        ...handoff.request,
        workflowId,
      };
    }
    return buildDefaultWorkflowBoardRequest(workflowId);
  }, [handoff, workflowId]);
  const [selectedStep, setSelectedStep] = useState<IndustryWorkflowFrontendPreviewStepCard | null>(null);
  const [approvalLog, setApprovalLog] = useState<Array<{ stepId: string; decision: 'approved' | 'rejected' }>>([]);

  const query = useQuery({
    queryKey: ['workflow-board', request],
    queryFn: () => previewIndustryWorkflow(request),
    retry: false,
    staleTime: 30 * 1000,
  });
  const collabKnowledgeQuery = useQuery({
    queryKey: ['workflow-board', 'tenant-private-collab', tenantId],
    queryFn: () => fetchControlPlaneTenantPrivateKnowledgeSummaries({ tenant_id: tenantId, limit: 4 }),
    staleTime: 60_000,
  });
  const workflowIndustryTag = useMemo(() => {
    const categoryId = String(request.categoryId ?? '').trim();
    const subIndustryId = String(request.subIndustryId ?? '').trim();
    return categoryId && subIndustryId ? `${categoryId}.${subIndustryId}` : workflowId;
  }, [request.categoryId, request.subIndustryId, workflowId]);
  const runtimeKnowledgePreviewQuery = useQuery({
    queryKey: ['workflow-board', 'knowledge-resolve', tenantId, workflowIndustryTag],
    queryFn: () => resolveControlPlaneKnowledge({
      tenant_id: tenantId,
      role_id: 'strategist',
      industry_tag: workflowIndustryTag,
      task_type: 'workflow_board_preview',
      requested_layers: ['platform_common', 'platform_industry', 'tenant_private'],
    }),
    staleTime: 60_000,
  });

  const fallbackPreview = useMemo(
    () => buildWorkflowBoardPreviewFromBlueprint(handoff?.blueprint ?? buildIndustryWorkflowBlueprintPreview(request)),
    [handoff, request],
  );
  const preview = useMemo(
    () => (query.data?.blueprint ? buildWorkflowBoardPreviewFromBlueprint(query.data.blueprint) : fallbackPreview),
    [fallbackPreview, query.data?.blueprint],
  );
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

  if (query.isLoading && !preview) {
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
      {query.isError ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Industry workflow preview is temporarily unavailable. The page is showing a local blueprint fallback, but the field mapping still follows the frozen contract.
        </div>
      ) : null}

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
            <div className="text-sm font-semibold text-gray-100">Approval Log</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-green-500/25 bg-green-500/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-green-300">Approved</div>
                <div className="mt-2 text-2xl font-semibold text-gray-100">{approvalCounts.approved}</div>
              </div>
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-red-300">Rejected</div>
                <div className="mt-2 text-2xl font-semibold text-gray-100">{approvalCounts.rejected}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <div className="text-sm font-semibold text-cyan-100">Tenant-private collaboration summaries</div>
            <div className="mt-2 text-sm leading-6 text-slate-200">
              Workflow tasks consume only de-identified collaboration summaries here. Raw approval / reminder /
              receipt bodies stay in the collaboration audit layer.
            </div>
            <div className="mt-3">
              <KnowledgeContextEvidence
                context={runtimeKnowledgePreviewQuery.data}
                title="Workflow knowledge resolve preview"
                compact
              />
            </div>
            <div className="mt-3 space-y-2">
              {collabKnowledgeQuery.isLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  Loading collaboration summaries...
                </div>
              ) : collabKnowledgeQuery.data?.items?.length ? (
                collabKnowledgeQuery.data.items.map((item) => (
                  <TaskKnowledgeSummaryCard key={item.captureId} item={item} />
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  No approved tenant-private collaboration summaries yet.
                </div>
              )}
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
            <DialogTitle>{selectedStep?.title || 'Step Detail'}</DialogTitle>
            <DialogClose onClose={() => setSelectedStep(null)} />
          </DialogHeader>
          {selectedStep ? (
            <div className="space-y-4 p-6 text-sm text-gray-200">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Goal</div>
                <div className="mt-2 leading-7">{selectedStep.goal}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Checklist</div>
                  <ul className="mt-2 space-y-2">
                    {selectedStep.operatorChecklist.map((item) => (
                      <li key={item} className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Missing Fields</div>
                  {selectedStep.payloadGaps.length === 0 ? (
                    <div className="mt-2 text-gray-400">No missing fields in the current contract view.</div>
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
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Suggested Commands</div>
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

function TaskKnowledgeSummaryCard({ item }: { item: GroupCollabTenantPrivateSummaryEntry }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-white">{item.sourceType}</div>
        <div className="text-xs text-slate-400">{item.objectType}</div>
      </div>
      <div className="mt-2 leading-6">{item.insight}</div>
      <div className="mt-2 text-xs text-slate-500">
        refs: {item.evidenceRefs.map((ref) => ref.recordId).join(', ') || 'none'}
      </div>
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
