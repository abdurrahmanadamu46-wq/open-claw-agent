'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { CollabIntegrationPanel } from '@/components/collab/CollabIntegrationPanel';
import { CollabMetricCard } from '@/components/collab/CollabMetricCard';
import { CollabRecordCard } from '@/components/collab/CollabRecordCard';
import { IntegrationHelpCard } from '@/components/operations/IntegrationHelpCard';
import {
  SurfaceHero,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import {
  dispatchGroupCollab,
  fetchGroupCollabContract,
  fetchGroupCollabSummary,
  simulateGroupCollabInbound,
} from '@/services/endpoints/group-collab';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.message || '请求失败';
}

export default function CollabApprovalsPage() {
  const queryClient = useQueryClient();
  const contractQuery = useQuery({
    queryKey: ['collab', 'contract'],
    queryFn: fetchGroupCollabContract,
    staleTime: 5 * 60 * 1000,
  });
  const summaryQuery = useQuery({
    queryKey: ['collab', 'approvals', 'summary'],
    queryFn: fetchGroupCollabSummary,
    staleTime: 60 * 1000,
  });

  const inboundMutation = useMutation({
    mutationFn: simulateGroupCollabInbound,
    onSuccess: async () => {
      triggerSuccessToast('群协作记录已回写');
      await queryClient.invalidateQueries({ queryKey: ['collab'] });
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  const reminderMutation = useMutation({
    mutationFn: () =>
      dispatchGroupCollab({
        objectType: 'reminder',
        title: '手动补发催办',
        summary: '使用统一 contract 追加一条催办提醒。',
        body: '请在 30 分钟内完成审批或确认，否则系统会继续保持当前联调状态。',
        deliveryMode: 'auto',
        tags: ['reminder', 'manual'],
      }),
    onSuccess: async () => {
      triggerSuccessToast('催办提醒已补发');
      await queryClient.invalidateQueries({ queryKey: ['collab'] });
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  const pendingItems = useMemo(() => summaryQuery.data?.pendingItems ?? [], [summaryQuery.data?.pendingItems]);
  const adapters = summaryQuery.data?.adapters ?? [];

  if (contractQuery.isLoading || summaryQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载待确认项"
          description="页面会先读取 collab contract，再拉取 unified summary.pendingItems，然后按 approval / confirmation / reminder 统一渲染。"
        />
      </div>
    );
  }

  if (contractQuery.isError || summaryQuery.isError || !contractQuery.data || !summaryQuery.data) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="待确认项加载失败"
          description="当前没有拿到稳定的 pendingItems 读接口。请先和群协作集成同学、后端同学确认 summary contract 是否可用。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="群协作区 / 待确认项"
        title="把审批、确认和催办收成一张可执行清单"
        description="这页只依赖 summary.pendingItems，不再从审批页、提醒页、群消息里各自维护一套状态。当前阶段按钮仍是 mock-assisted inbound 回写，但页面模型已经切到真实 contract。"
        actions={
          <button
            type="button"
            onClick={() => reminderMutation.mutate()}
            disabled={reminderMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-60"
          >
            {reminderMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            补发催办
          </button>
        }
      />

      <CollabIntegrationPanel
        contractVersion={contractQuery.data.contractVersion}
        adapters={adapters}
        recordsState="待确认页已经读取 unified summary.pendingItems，而不是继续用 commercial readiness blockers 代替确认队列。"
        callbackState="当前操作按钮仍然是 mock-assisted inbound 回写；真正切真时，页面不需要换对象模型，只需要把 inbound 来源替成真实 callback。"
      />

      <IntegrationHelpCard
        description="待确认页如果空白或按钮回写失败，优先确认 summary.pendingItems 和 mock/live inbound 回写接口，不要重新定义一套前端确认模型。"
        modelOwner="AI群协作集成工程师"
        readOwner="后端工程师"
        extra="重点核对 pendingItems 里 approval、confirmation、reminder 三类对象是否都带 recordId、objectType、status 和 route。"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <CollabMetricCard label="待审批" value={String(summaryQuery.data.pendingApprovals)} icon={<ShieldCheck className="h-4 w-4" />} />
        <CollabMetricCard label="待确认" value={String(summaryQuery.data.pendingConfirmations)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <CollabMetricCard label="催办中" value={String(summaryQuery.data.pendingReminders)} icon={<RefreshCw className="h-4 w-4" />} />
      </section>

      <SurfaceSection
        title="当前待处理清单"
        description="所有动作都会回写到同一条 collab record 上，避免页面内再造临时状态。"
      >
        {pendingItems.length > 0 ? (
          <div className="space-y-3">
            {pendingItems.map((item) => (
              <CollabRecordCard
                key={item.recordId}
                record={item}
                actions={
                  <>
                    {item.objectType === 'approval' ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            inboundMutation.mutate({
                              recordId: item.recordId,
                              eventType: 'approval.approved',
                              note: '前端页面模拟审批通过',
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          模拟通过
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            inboundMutation.mutate({
                              recordId: item.recordId,
                              eventType: 'approval.rejected',
                              note: '前端页面模拟审批拒绝',
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                        >
                          <XCircle className="h-4 w-4" />
                          模拟拒绝
                        </button>
                      </>
                    ) : null}

                    {item.objectType === 'confirmation' ? (
                      <button
                        type="button"
                        onClick={() =>
                          inboundMutation.mutate({
                            recordId: item.recordId,
                            eventType: 'confirmation.confirmed',
                            note: '前端页面模拟确认完成',
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        模拟确认
                      </button>
                    ) : null}

                    {item.objectType === 'reminder' ? (
                      <button
                        type="button"
                        onClick={() =>
                          inboundMutation.mutate({
                            recordId: item.recordId,
                            eventType: 'reminder.acknowledged',
                            note: '前端页面模拟催办已收悉',
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100"
                      >
                        <RefreshCw className="h-4 w-4" />
                        标记已收悉
                      </button>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <SurfaceStateCard
            kind="empty"
            title="当前没有待处理项"
            description="这说明统一 collab 清单里暂时没有挂起的审批、确认或催办记录。"
          />
        )}
      </SurfaceSection>

      <SurfaceSection
        title="这页现在到底是什么意思"
        description="这页的重点是“页面模型已切真”，不是“群 callback 已完全切真”。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
            现在待确认页已经不再借 commercial readiness blockers 代用，而是直接吃 pendingItems contract。
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
            现在的“批准 / 拒绝 / 确认 / 收悉”按钮仍然是 mock inbound，只是为了把前端联调链路跑顺。
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
            一旦后端把真实 inbound callback 接上，这页不用重做，只需要把事件来源从 mock 换成 live。
          </div>
        </div>
      </SurfaceSection>
    </div>
  );
}
