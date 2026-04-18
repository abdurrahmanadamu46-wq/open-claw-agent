'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, RefreshCw, Send } from 'lucide-react';
import { CollabIntegrationPanel } from '@/components/collab/CollabIntegrationPanel';
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
  type GroupCollabAdapterDescriptor,
  fetchGroupCollabContract,
  fetchGroupCollabRecords,
} from '@/services/endpoints/group-collab';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.message || '请求失败';
}

export default function CollabReportsPage() {
  const queryClient = useQueryClient();
  const contractQuery = useQuery({
    queryKey: ['collab', 'contract'],
    queryFn: fetchGroupCollabContract,
    staleTime: 5 * 60 * 1000,
  });
  const reportsQuery = useQuery({
    queryKey: ['collab', 'reports'],
    queryFn: () => fetchGroupCollabRecords({ objectType: 'report', limit: 20 }),
    staleTime: 60 * 1000,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      dispatchGroupCollab({
        objectType: 'report',
        title: '运营日报播报',
        summary: '使用统一 group-collab contract 派发一条新的播报记录。',
        body: '这条播报会经过统一 adapter 记录、回执和 trace 字段，用于验证播报页联调链路。',
        deliveryMode: 'auto',
        tags: ['report', 'demo'],
      }),
    onSuccess: async () => {
      triggerSuccessToast('群播报已写入记录');
      await queryClient.invalidateQueries({ queryKey: ['collab', 'reports'] });
    },
    onError: (error) => {
      triggerErrorToast(normalizeError(error));
    },
  });

  if (contractQuery.isLoading || reportsQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载群播报记录"
          description="页面会先读取 collab contract，再读取 report objectType 的记录列表。"
        />
      </div>
    );
  }

  if (contractQuery.isError || reportsQuery.isError || !contractQuery.data) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="群播报记录加载失败"
          description="当前没有拿到稳定的 report 记录接口。请先确认群协作 contract 和记录读接口是否已经由后端或 mock 代理提供。"
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  const items = reportsQuery.data?.items ?? [];
  const adapters: GroupCollabAdapterDescriptor[] = items.map((item) => ({
    id: item.route.adapterId,
    label: item.route.targetName || item.route.chatId || item.route.adapterId,
    provider: item.route.provider,
    mode: item.route.mode,
    enabled: true,
    capabilities: ['report'],
    health: item.route.mode === 'live' ? 'ready' : 'mock',
    isDefault: false,
    liveSupported: item.route.mode === 'live',
  }));

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="群协作区 / 播报记录"
        title="每一条群播报都留在控制面里，而不是散在聊天窗口里"
        description="这页只消费 objectType=report 的记录，目的不是做聊天界面，而是把 dispatch / record / receipt 这条播报链路先跑顺，再逐步切到真实群通道。"
        actions={
          <>
            <button
              type="button"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-60"
            >
              {sendMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              新建测试播报
            </button>
            <Link
              href="/collab/approvals"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              打开待确认项
            </Link>
          </>
        }
      />

      <CollabIntegrationPanel
        contractVersion={contractQuery.data.contractVersion}
        adapters={adapters}
        recordsState="播报记录页已经是 record-strong：页面直接围绕 report records 渲染，不再自己发明群消息对象。"
        callbackState="这页仍然是 callback-light：真正的 delivery receipt、thread 已读和回流深度，还取决于后端回执接口是否补齐。"
      />

      <IntegrationHelpCard
        description="播报页如果没有数据，先确认 report records 读接口和 receipt 字段是否返回；如果只是没有真实群回执，不等于页面挂了。"
        modelOwner="AI群协作集成工程师"
        readOwner="后端工程师"
        extra="重点核对 recordId、traceId、route、receipt、history。真实 thread/readback 尚未补齐时，页面应显示半联调态。"
      />

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <SurfaceSection title="播报出站记录" description="同一条记录会保留 route、receipt 和 trace 信息，方便联调时定位。">
          {items.length > 0 ? (
            <div className="space-y-3">
              {items.map((item) => (
                <CollabRecordCard key={item.recordId} record={item} />
              ))}
            </div>
          ) : (
            <SurfaceStateCard
              kind="empty"
              title="当前还没有群播报记录"
              description="UI 已就位，但当前租户还没有打出第一条 report 记录。"
            />
          )}
        </SurfaceSection>

        <SurfaceSection title="这页现在的真实状态" description="播报页已经不再是静态壳，但也还没到 thread-complete。">
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
              当前页面基于 `{contractQuery.data.contractVersion}` 渲染，只消费 report records，不再自己定义群消息字段。
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
              当前最强的一段是“播报出站记录已经统一”，还缺的一段是“谁已读了、谁回了、有没有 thread 回流”。
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
              下一步最自然的补位就是 report delivery receipt 和 thread readback，一补上，这页就会从“已发出去”升级成“可追踪闭环”。
            </div>
            <Link href="/collab" className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-400/25">
              <div className="text-sm font-semibold text-white">返回群协作总览</div>
              <div className="mt-2 text-sm text-slate-300">回到总览页，看播报、待确认项和 adapter 状态能否一起闭环。</div>
            </Link>
          </div>
        </SurfaceSection>
      </section>

      <SurfaceSection title="为什么这页仍然重要" description="哪怕 thread 还没补齐，这页也已经能承担“播报留痕”职责。">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BellRing className="h-4 w-4 text-cyan-300" />
              已发什么
            </div>
            <div className="mt-2 text-sm leading-7 text-slate-300">
              这块已经是真的。播报对象、route 和 trace 都能在这里留痕。
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <RefreshCw className="h-4 w-4 text-amber-300" />
              有没有回执
            </div>
            <div className="mt-2 text-sm leading-7 text-slate-300">
              这块现在是半真。页面能显示 receipt，但深度还不够完整。
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Send className="h-4 w-4 text-emerald-300" />
              谁真正看了
            </div>
            <div className="mt-2 text-sm leading-7 text-slate-300">
              这块还没切真。等 thread / readback 接口补齐后，播报页才能真正闭环。
            </div>
          </div>
        </div>
      </SurfaceSection>
    </div>
  );
}
