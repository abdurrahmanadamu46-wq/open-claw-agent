'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
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
  buildGroupCollabTraceSummary,
  dispatchGroupCollab,
  fetchGroupCollabContract,
  fetchGroupCollabRecords,
  fetchGroupCollabSummary,
  type GroupCollabTraceSanitizedSummary,
} from '@/services/endpoints/group-collab';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.message || '请求失败';
}

export default function CollabOverviewPage() {
  const queryClient = useQueryClient();
  const contractQuery = useQuery({
    queryKey: ['collab', 'contract'],
    queryFn: fetchGroupCollabContract,
    staleTime: 5 * 60 * 1000,
  });
  const summaryQuery = useQuery({
    queryKey: ['collab', 'summary'],
    queryFn: fetchGroupCollabSummary,
    staleTime: 60 * 1000,
  });
  const recentQuery = useQuery({
    queryKey: ['collab', 'recent'],
    queryFn: () => fetchGroupCollabRecords({ limit: 6 }),
    staleTime: 60 * 1000,
  });
  const [traceSummaryInput, setTraceSummaryInput] = useState('');
  const [traceSummary, setTraceSummary] = useState<GroupCollabTraceSanitizedSummary | null>(null);

  const seedMutation = useMutation({
    mutationFn: () =>
      dispatchGroupCollab({
        objectType: 'report',
        title: '控制台测试播报',
        summary: '通过统一 group-collab contract 派发一条联调播报记录。',
        body: '这条记录来自统一的 collab dispatch 接口，用来验证群播报、待确认项和回执记录能否共享同一套对象模型。',
        deliveryMode: 'auto',
        tags: ['frontend', 'contract'],
      }),
    onSuccess: async () => {
      triggerSuccessToast('测试播报已写入群协作记录');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['collab', 'summary'] }),
        queryClient.invalidateQueries({ queryKey: ['collab', 'recent'] }),
      ]);
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  const traceSummaryMutation = useMutation({
    mutationFn: (traceId: string) => buildGroupCollabTraceSummary(traceId),
    onSuccess: (summaryResult) => {
      setTraceSummary(summaryResult);
      triggerSuccessToast('Trace sanitized summary generated');
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  if (contractQuery.isLoading || summaryQuery.isLoading || recentQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在装配群协作区"
          description="页面会先读取统一的 group-collab contract、摘要统计和最近记录，再决定渲染播报、确认和催办视图。"
        />
      </div>
    );
  }

  if (contractQuery.isError || summaryQuery.isError || recentQuery.isError || !contractQuery.data || !summaryQuery.data) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="群协作区加载失败"
          description="当前没有拿到稳定的群协作 contract 或摘要接口。请先和群协作集成同学、后端同学确认读接口或 mock 代理状态。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  const contract = contractQuery.data;
  const summary = summaryQuery.data;
  const recentItems = recentQuery.data?.items ?? [];
  const candidateTraceIds = Array.from(new Set(recentItems.map((item) => item.traceId).filter(Boolean))).slice(0, 4);

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="群协作区"
        title="把群播报、待确认项和催办收口到同一份协作 contract 里"
        description="这页只消费统一的 group-collab contract，不再让页面自己定义对象模型。无论现在接的是 mock adapter 还是真实群通道，前端都围绕同一套 record / receipt / pending item 结构来表达。"
        actions={
          <>
            <button
              type="button"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-60"
            >
              {seedMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送测试播报
            </button>
            <Link
              href="/collab/reports"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开播报记录
            </Link>
            <Link
              href="/collab/approvals"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white"
            >
              打开待确认项
            </Link>
          </>
        }
      />

      <CollabIntegrationPanel
        contractVersion={contract.contractVersion}
        adapters={summary.adapters}
        recordsState="总览页已经基于 unified summary contract 和 recent mixed records，不再为播报、确认、催办各维护一套本地状态。"
        callbackState="dispatch 已经接在真实 contract 上，但 confirmation depth 和 receipt depth 仍取决于 adapter mode 和后端 callback 覆盖度。"
      />

      <IntegrationHelpCard
        description="总览页如果加载失败，优先判断是不是 group-collab contract、summary 或 records 读接口不可达，不要先按页面坏了处理。"
        modelOwner="AI群协作集成工程师"
        readOwner="后端工程师"
        extra="页面挂载和视觉结构如需调整，找前端工程师；卡住 30 分钟先找直接依赖人，卡住 2 小时升级给 AI收尾总指挥。"
      />

      <TraceSummaryTester
        candidateTraceIds={candidateTraceIds}
        inputValue={traceSummaryInput}
        loading={traceSummaryMutation.isPending}
        summary={traceSummary}
        onInputChange={setTraceSummaryInput}
        onRun={(traceId) => traceSummaryMutation.mutate(traceId)}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CollabMetricCard
          label="协作记录"
          value={String(summary.totalRecords)}
          description="统一 record 总数"
          icon={<BellRing className="h-4 w-4" />}
        />
        <CollabMetricCard
          label="待审批"
          value={String(summary.pendingApprovals)}
          description="需要人工审批的记录"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <CollabMetricCard
          label="待确认"
          value={String(summary.pendingConfirmations)}
          description="等待业务确认的记录"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <CollabMetricCard
          label="催办中"
          value={String(summary.pendingReminders)}
          description="仍然挂起的催办记录"
          icon={<RefreshCw className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <SurfaceSection
          title="最近协作记录"
          description="这里混合展示 report / approval / confirmation / reminder，确保总览页能看见完整协作链。"
          actionHref="/collab/reports"
          actionLabel="查看完整记录"
        >
          {recentItems.length > 0 ? (
            <div className="space-y-3">
              {recentItems.map((item) => (
                <CollabRecordCard key={item.recordId} record={item} />
              ))}
            </div>
          ) : (
            <SurfaceStateCard
              kind="empty"
              title="当前还没有协作记录"
              description="群协作区页面已经就位，但当前租户还没有打出第一条播报、确认或催办记录。"
            />
          )}
        </SurfaceSection>

        <div className="space-y-4">
          <SurfaceSection title="当前 contract" description="这就是群协作页面现在认的真相源。">
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="text-sm font-semibold text-white">contractVersion</div>
              <div className="mt-2 text-sm text-slate-300">{contract.contractVersion}</div>
              <div className="mt-4 text-sm font-semibold text-white">objectTypes</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {contract.objectTypes.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </SurfaceSection>

          <SurfaceSection title="Adapter 状态" description="前端不再自己想象群通道，而是直接读 adapter 健康度和默认目标。">
            <div className="space-y-3">
              {summary.adapters.map((adapter) => (
                <div key={adapter.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{adapter.label}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {adapter.provider} / {adapter.mode}
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                      {adapter.health}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-slate-400">
                    默认目标：{adapter.defaultTargetName || adapter.defaultChatId || '未设置'}
                  </div>
                </div>
              ))}
            </div>
          </SurfaceSection>

          <SurfaceSection title="这一页的意思" description="总览页更像“群协作驾驶舱”，不是聊天界面。">
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
                它的重点是把播报、审批、确认和催办放进同一条协作对象链里，这样后续接真 callback 时，前端不用再重做页面模型。
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
                如果你在演示，这页适合讲“协作结构已经统一”；如果你在联调，重点看 adapter、record 和 pending item 有没有落在同一条 contract 上。
              </div>
            </div>
          </SurfaceSection>
        </div>
      </section>
    </div>
  );
}

function TraceSummaryTester({
  candidateTraceIds,
  inputValue,
  loading,
  summary,
  onInputChange,
  onRun,
}: {
  candidateTraceIds: string[];
  inputValue: string;
  loading: boolean;
  summary: GroupCollabTraceSanitizedSummary | null;
  onInputChange: (value: string) => void;
  onRun: (traceId: string) => void;
}) {
  const canRun = inputValue.trim().length > 0 && !loading;
  return (
    <SurfaceSection
      title="Trace sanitized summary"
      description="QA debug panel: use a raw trace only as lookup input, then verify the output is sanitized and safe for tenant_private candidates."
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <label className="text-sm font-semibold text-white" htmlFor="collab-trace-summary-input">
            Trace lookup input
          </label>
          <input
            id="collab-trace-summary-input"
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={candidateTraceIds[0] || 'Paste traceId for lookup'}
            className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {candidateTraceIds.map((traceId) => (
              <button
                key={traceId}
                type="button"
                onClick={() => onInputChange(traceId)}
                className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
              >
                use recent trace
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => onRun(inputValue.trim())}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Generate sanitized summary
          </button>
          <div className="mt-3 text-xs leading-6 text-slate-400">
            Raw traceId is used only for lookup. The summary output must not return traceId, requestId, correlationId, inboundTraceId, or raw history.
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          {summary ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{summary.summaryType}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    source records: {summary.source.sourceRecordCount}
                  </div>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                  redacted
                </span>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {Object.entries(summary.objectStats).map(([key, value]) => (
                  <div key={key} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="text-xs text-slate-400">{key}</div>
                    <div className="mt-1 text-lg font-semibold text-white">{value}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {summary.insights.map((item) => (
                  <div key={`${item.category}:${item.objectType}:${item.insight}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-cyan-200">{item.category}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-200">{item.insight}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {item.objectType} / confidence {item.confidence}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-6 text-emerald-100">
                Redaction flags: rawTraceIdReturned={String(summary.redaction.rawTraceIdReturned)}, rawHistoryReturned={String(summary.redaction.rawHistoryReturned)}, rawInboundTraceIdReturned={String(summary.redaction.rawInboundTraceIdReturned)}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm leading-7 text-slate-400">
              No sanitized summary generated yet. Pick a recent trace or paste one to verify the boundary.
            </div>
          )}
        </div>
      </div>
    </SurfaceSection>
  );
}
