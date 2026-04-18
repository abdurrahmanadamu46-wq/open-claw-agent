'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Database,
  MessageSquare,
  Radar,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { ingestXhsCompetitiveNote, previewXhsCompetitiveNote } from '@/services/endpoints/tenant';
import { useAlertCenter } from '@/contexts/AlertCenterContext';
import {
  clearTenantXhsCommanderAlertDismissals,
  createTenantXhsCommanderAlertDismissal,
  createTenantXhsCommanderQueueAction,
  createTenantXhsCommanderTask,
  createTenantXhsCommanderTaskAction,
  createTenantXhsHandoffAction,
  fetchTenantXhsCommanderAlertDismissals,
  fetchTenantXhsCommanderReminderPolicy,
  fetchTenantXhsCommanderReminderPolicyHistory,
  fetchTenantXhsCommanderQueue,
  fetchTenantXhsCommanderTasks,
  fetchTenantXhsHandoffActions,
  fetchTenantXhsHandoffActionSummary,
  fetchTenantXhsSupervisorHandoffPack,
  fetchTenantXhsSupervisorOverview,
  updateTenantXhsCommanderReminderPolicy,
} from '@/services/endpoints/tenant-xhs';
import type { XhsCompetitiveIngestResponse, XhsCompetitiveIntelRequestPayload, XhsCompetitivePreviewResponse } from '@/types/xhs-intel';
import type {
  XhsCommanderEscalationQueueItem,
  XhsCommanderReminderPolicy,
  XhsCommanderReminderPolicyChangeRecord,
  XhsCommanderReminderPolicyPreset,
  XhsCommanderQueueActionType,
  XhsCommanderTaskActionType,
  XhsCommanderTaskRecord,
  XhsHandoffActionRecord,
  XhsHandoffActionType,
  XhsRoleHandoffPack,
} from '@/types/xhs-events';

const CARD = 'rounded-[28px] border border-white/10 bg-white/[0.04]';
const DEFAULT_REMINDER_POLICY_PRESETS: XhsCommanderReminderPolicyPreset[] = [
  {
    schema_version: 'xhs_commander_reminder_policy_preset/v1',
    preset_id: 'conservative',
    label: 'Conservative',
    description: 'Only queue-open reminders, with fewer visible alerts.',
    queue_open_enabled: true,
    task_running_enabled: false,
    pending_task_enabled: false,
    max_alerts: 3,
  },
  {
    schema_version: 'xhs_commander_reminder_policy_preset/v1',
    preset_id: 'standard',
    label: 'Standard',
    description: 'Balanced reminders for queue, running task, and pending work.',
    queue_open_enabled: true,
    task_running_enabled: true,
    pending_task_enabled: true,
    max_alerts: 5,
  },
  {
    schema_version: 'xhs_commander_reminder_policy_preset/v1',
    preset_id: 'aggressive',
    label: 'Aggressive',
    description: 'Wider reminder surface for high-risk bursts.',
    queue_open_enabled: true,
    task_running_enabled: true,
    pending_task_enabled: true,
    max_alerts: 8,
  },
];

function normalizeError(error: unknown): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || '请求失败';
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function roleLabel(role: string) {
  if (role === 'echoer') return 'Echoer 回声';
  if (role === 'catcher') return 'Catcher 捕手';
  return role;
}

function actionLabel(action: string) {
  if (action === 'claim') return '认领';
  if (action === 'escalate_commander') return '升级 Commander';
  if (action === 'route_catcher') return '转给 Catcher';
  if (action === 'route_followup') return '转给 Followup';
  if (action === 'resolve') return '标记解决';
  return action;
}

function queueActionLabel(action: string) {
  if (action === 'acknowledge') return '确认收到';
  if (action === 'assign') return '分派';
  if (action === 'close') return '关闭';
  return action;
}

function taskActionLabel(action: string) {
  if (action === 'start') return '开始任务';
  if (action === 'complete') return '完成任务';
  return action;
}

function readPayloadFromPreview(raw: unknown): XhsCompetitiveIntelRequestPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<XhsCompetitivePreviewResponse['data']> & XhsCompetitiveIntelRequestPayload;
  if (candidate.competitive_intel_request && typeof candidate.competitive_intel_request === 'object') {
    return candidate.competitive_intel_request;
  }
  return candidate;
}

export default function XiaohongshuChannelPage() {
  const queryClient = useQueryClient();
  const {
    clearDismissedXhsCommanderAlerts,
    setXhsCommanderAlerts,
    setXhsCommanderAlertDismissHandler,
    setXhsCommanderAlertRestoreHandler,
    syncDismissedXhsCommanderAlerts,
  } = useAlertCenter();
  const [noteUrl, setNoteUrl] = useState('');
  const [title, setTitle] = useState('爆款敏感肌修护霜复盘');
  const [content, setContent] = useState('这条笔记重点拆解产品场景、评论异议和达人表达方式。');
  const [comments, setComments] = useState('敏感肌能用吗\n油皮会不会闷\n有没有平价替代');
  const [industry, setIndustry] = useState('beauty');
  const [niche, setNiche] = useState('sensitive-skin');
  const [scenario, setScenario] = useState('product-review');
  const [targetAgents, setTargetAgents] = useState('radar,strategist,inkwriter,visualizer,dispatcher');
  const [previewPayload, setPreviewPayload] = useState<XhsCompetitiveIntelRequestPayload | null>(null);
  const [ingestResult, setIngestResult] = useState<XhsCompetitiveIngestResponse['data'] | null>(null);
  const [notice, setNotice] = useState('');
  const [demoMode, setDemoMode] = useState<boolean | null>(null);

  useEffect(() => {
    setDemoMode(window.localStorage.getItem('clawcommerce_demo_mode') === '1');
  }, []);

  const liveQueriesEnabled = demoMode === false;

  const overviewQuery = useQuery({
    queryKey: ['xhs-channel', 'overview'],
    queryFn: () => fetchTenantXhsSupervisorOverview({ limit: 120, role_preview_limit: 4 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const handoffQuery = useQuery({
    queryKey: ['xhs-channel', 'handoff-pack'],
    queryFn: () => fetchTenantXhsSupervisorHandoffPack({ limit: 120, pack_limit: 8 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const actionsQuery = useQuery({
    queryKey: ['xhs-channel', 'handoff-actions'],
    queryFn: () => fetchTenantXhsHandoffActions({ limit: 100 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const actionSummaryQuery = useQuery({
    queryKey: ['xhs-channel', 'handoff-action-summary'],
    queryFn: () => fetchTenantXhsHandoffActionSummary({ recent_limit: 5 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const commanderQueueQuery = useQuery({
    queryKey: ['xhs-channel', 'commander-queue'],
    queryFn: () => fetchTenantXhsCommanderQueue({ status: 'all', limit: 100 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const commanderTasksQuery = useQuery({
    queryKey: ['xhs-channel', 'commander-tasks'],
    queryFn: () => fetchTenantXhsCommanderTasks({ status: 'all', limit: 100 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const commanderAlertDismissalsQuery = useQuery({
    queryKey: ['xhs-channel', 'commander-alert-dismissals'],
    queryFn: () => fetchTenantXhsCommanderAlertDismissals(),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const commanderReminderPolicyQuery = useQuery({
    queryKey: ['xhs-channel', 'commander-reminder-policy'],
    queryFn: fetchTenantXhsCommanderReminderPolicy,
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const commanderReminderPolicyHistoryQuery = useQuery({
    queryKey: ['xhs-channel', 'commander-reminder-policy-history'],
    queryFn: () => fetchTenantXhsCommanderReminderPolicyHistory({ limit: 8 }),
    enabled: liveQueriesEnabled,
    retry: false,
    staleTime: 30_000,
  });

  const invalidateXhsQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['xhs-channel'] }),
      queryClient.invalidateQueries({ queryKey: ['activities'] }),
    ]);
  };

  const previewMutation = useMutation({
    mutationFn: () => previewXhsCompetitiveNote({ note_url: noteUrl.trim(), industry, niche, scenario }),
    onSuccess: (result) => {
      setPreviewPayload(readPayloadFromPreview(result.data));
      setNotice('预览已生成，可以检查样本后写入租户竞争情报。');
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const ingestMutation = useMutation({
    mutationFn: () => {
      const fallbackPayload: XhsCompetitiveIntelRequestPayload = {
        source: {
          platform: 'xiaohongshu',
          noteUrl: noteUrl.trim() || undefined,
          capturedAt: new Date().toISOString(),
        },
        note: {
          title,
          content,
          metrics: {},
        },
        comments: comments.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        classification: { industry, niche, scenario },
        targetAgents: targetAgents.split(',').map((item) => item.trim()).filter(Boolean),
        upsertAsCorpus: true,
      };
      return ingestXhsCompetitiveNote({
        ...(previewPayload ?? fallbackPayload),
        tenantId: 'tenant_main',
        upsertAsCorpus: true,
        targetAgents: targetAgents.split(',').map((item) => item.trim()).filter(Boolean),
      });
    },
    onSuccess: (result) => {
      setIngestResult(result.data);
      setNotice('竞争情报已写入租户知识层，后续可供 Radar / Strategist / Inkwriter 消费。');
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const handoffActionMutation = useMutation({
    mutationFn: (input: { packId: string; action: XhsHandoffActionType }) =>
      createTenantXhsHandoffAction({
        pack_id: input.packId,
        action: input.action,
        note: `Recorded from XHS channel supervisor page: ${input.action}`,
      }),
    onSuccess: async () => {
      setNotice('Handoff 动作已记录。');
      await invalidateXhsQueries();
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const commanderQueueMutation = useMutation({
    mutationFn: (input: { packId: string; action: XhsCommanderQueueActionType }) =>
      createTenantXhsCommanderQueueAction({
        pack_id: input.packId,
        action: input.action,
        assignee: input.action === 'assign' ? 'commander-review' : undefined,
        note: `Commander queue ${input.action} from XHS channel page.`,
      }),
    onSuccess: async () => {
      setNotice('Commander 队列动作已记录。');
      await invalidateXhsQueries();
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const createTaskMutation = useMutation({
    mutationFn: (packId: string) =>
      createTenantXhsCommanderTask({
        pack_id: packId,
        assignee: 'commander',
        note: 'Created from XHS channel supervisor page.',
      }),
    onSuccess: async () => {
      setNotice('Commander 轻任务已创建。');
      await invalidateXhsQueries();
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const commanderTaskMutation = useMutation({
    mutationFn: (input: { packId: string; action: XhsCommanderTaskActionType }) =>
      createTenantXhsCommanderTaskAction({
        pack_id: input.packId,
        action: input.action,
        note: `Commander task ${input.action} from XHS channel page.`,
      }),
    onSuccess: async () => {
      setNotice('Commander 任务状态已更新。');
      await invalidateXhsQueries();
    },
    onError: (error) => setNotice(normalizeError(error)),
  });
  const commanderReminderPolicyMutation = useMutation({
    mutationFn: (input: {
      preset_id?: 'conservative' | 'standard' | 'aggressive';
      queue_open_enabled?: boolean;
      task_running_enabled?: boolean;
      pending_task_enabled?: boolean;
      max_alerts?: number;
    }) => updateTenantXhsCommanderReminderPolicy(input),
    onSuccess: async () => {
      setNotice('Commander 提醒策略已更新。');
      await invalidateXhsQueries();
    },
    onError: (error) => setNotice(normalizeError(error)),
  });

  const handoffActions = useMemo<Record<string, XhsHandoffActionRecord>>(
    () => Object.fromEntries((actionsQuery.data?.items ?? []).map((item) => [item.pack_id, item])),
    [actionsQuery.data?.items],
  );
  const packs = useMemo<XhsRoleHandoffPack[]>(
    () => [
      ...(handoffQuery.data?.batches.echoer.items ?? []),
      ...(handoffQuery.data?.batches.catcher.items ?? []),
    ],
    [handoffQuery.data?.batches.catcher.items, handoffQuery.data?.batches.echoer.items],
  );
  const commanderFocusPacks = packs.filter(
    (item) => item.route_hint === 'commander' || item.artifact_state === 'needs_review',
  );
  const openCommanderQueue = useMemo(
    () => (commanderQueueQuery.data?.items ?? []).filter((item) => ['open', 'acknowledged', 'assigned'].includes(item.status)),
    [commanderQueueQuery.data?.items],
  );
  const runningCommanderTasks = useMemo(
    () => (commanderTasksQuery.data?.items ?? []).filter((item) => item.status === 'in_progress'),
    [commanderTasksQuery.data?.items],
  );
  const pendingCommanderTasks = useMemo(
    () => (commanderTasksQuery.data?.items ?? []).filter((item) => item.status === 'pending'),
    [commanderTasksQuery.data?.items],
  );
  const reminderPolicy: XhsCommanderReminderPolicy = commanderReminderPolicyQuery.data ?? {
    schema_version: 'xhs_commander_reminder_policy/v1',
    tenant_id: 'tenant_main',
    preset_id: 'standard',
    queue_open_enabled: true,
    task_running_enabled: true,
    pending_task_enabled: true,
    max_alerts: 5,
    updated_at: '',
    available_presets: DEFAULT_REMINDER_POLICY_PRESETS,
  };
  const taskByPack = useMemo<Record<string, XhsCommanderTaskRecord>>(
    () => Object.fromEntries((commanderTasksQuery.data?.items ?? []).map((item) => [item.pack_id, item])),
    [commanderTasksQuery.data?.items],
  );
  const summary = overviewQuery.data?.summary;
  const actionSummary = actionSummaryQuery.data?.summary;
  const reminderPolicyChanges = commanderReminderPolicyHistoryQuery.data?.items ?? [];

  const refetchAll = async () => {
    setNotice('');
    await invalidateXhsQueries();
  };

  useEffect(() => {
    const queueAlerts = reminderPolicy.queue_open_enabled ? openCommanderQueue.map((item) => ({
      id: `xhs_queue_${item.queue_id}`,
      kind: 'queue_open' as const,
      title: 'XHS Commander queue open',
      detail: `${item.status} · ${item.pack_id}`,
      href: '/operations/channels/xiaohongshu',
    })) : [];
    const taskAlerts = reminderPolicy.task_running_enabled ? runningCommanderTasks.map((item) => ({
      id: `xhs_task_${item.task_id}`,
      kind: 'task_running' as const,
      title: 'XHS Commander task in progress',
      detail: `${item.assignee} · ${item.pack_id}`,
      href: '/operations/channels/xiaohongshu',
    })) : [];
    setXhsCommanderAlerts([...queueAlerts, ...taskAlerts].slice(0, reminderPolicy.max_alerts || 5));
    return () => setXhsCommanderAlerts([]);
  }, [
    openCommanderQueue,
    reminderPolicy.max_alerts,
    reminderPolicy.queue_open_enabled,
    reminderPolicy.task_running_enabled,
    runningCommanderTasks,
    setXhsCommanderAlerts,
  ]);

  useEffect(() => {
    if (commanderAlertDismissalsQuery.data?.dismissed_alert_ids) {
      syncDismissedXhsCommanderAlerts(commanderAlertDismissalsQuery.data.dismissed_alert_ids);
    }
  }, [commanderAlertDismissalsQuery.data?.dismissed_alert_ids, syncDismissedXhsCommanderAlerts]);

  useEffect(() => {
    setXhsCommanderAlertDismissHandler(
      liveQueriesEnabled
        ? (alertId) => {
            void createTenantXhsCommanderAlertDismissal({ alert_id: alertId });
          }
        : null,
    );
    setXhsCommanderAlertRestoreHandler(
      liveQueriesEnabled
        ? () => {
            void clearTenantXhsCommanderAlertDismissals();
          }
        : null,
    );
    return () => {
      setXhsCommanderAlertDismissHandler(null);
      setXhsCommanderAlertRestoreHandler(null);
    };
  }, [liveQueriesEnabled, setXhsCommanderAlertDismissHandler, setXhsCommanderAlertRestoreHandler]);

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <section className={`${CARD} overflow-hidden p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <Link href="/operations/channels" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              返回渠道总览
            </Link>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-rose-400/25 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">
              <ShieldAlert className="h-3.5 w-3.5" />
              小红书通道主管台
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">
              让小红书监控、情报入库和 Commander 升级在同一页说清楚
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              这里不是新龙虾角色，而是小红书能力包的通道主管视角。页面消费 `xhs_supervisor_handoff/v1`，
              把 Echoer 回复草稿、Catcher 线索筛选和 Commander 风险升级放在一条清晰链路里。
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refetchAll()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white"
          >
            <RefreshCw className="h-4 w-4" />
            刷新通道状态
          </button>
        </div>

        {notice ? (
          <div className="mt-5 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {notice}
          </div>
        ) : null}
        {demoMode ? (
          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            当前处于演示壳模式，页面不主动请求真实 XHS 后端接口；真实联调环境会按 live contract 读取 handoff pack、Commander 队列和任务。
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="事件总数" value={String(summary?.total_events ?? 0)} />
          <MetricCard label="高意向评论" value={String(summary?.high_intent_comment_count ?? 0)} />
          <MetricCard label="风险评论" value={String(summary?.risk_comment_count ?? 0)} tone="warn" />
          <MetricCard label="Commander 升级" value={String(summary?.commander_escalation_count ?? actionSummary?.commander_escalation_count ?? 0)} tone="warn" />
          <MetricCard label="开放队列" value={String(openCommanderQueue.length)} />
        </div>
      </section>

      {(openCommanderQueue.length || runningCommanderTasks.length || pendingCommanderTasks.length) ? (
        <section className={`${CARD} border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-50`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">XHS Commander reminders</div>
            <button
              type="button"
              onClick={clearDismissedXhsCommanderAlerts}
              className="rounded-xl border border-amber-200/30 px-3 py-1.5 text-xs text-amber-50"
            >
              Restore dismissed alerts
            </button>
          </div>
          <div className="mt-2 leading-6">
            {openCommanderQueue.length ? `${openCommanderQueue.length} queue item(s) still open. ` : ''}
            {runningCommanderTasks.length ? `${runningCommanderTasks.length} task(s) in progress. ` : ''}
            {reminderPolicy.pending_task_enabled && pendingCommanderTasks.length ? `${pendingCommanderTasks.length} task(s) waiting to start.` : ''}
          </div>
        </section>
      ) : null}

      <section className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-white">Commander reminder policy</div>
            <div className="mt-1 text-sm text-slate-400">
              Control which XHS Commander states create global reminders and how many alerts stay visible.
            </div>
          </div>
          <button
            type="button"
            disabled={commanderReminderPolicyMutation.isPending}
            onClick={() =>
              commanderReminderPolicyMutation.mutate({
                queue_open_enabled: !reminderPolicy.queue_open_enabled,
                task_running_enabled: reminderPolicy.task_running_enabled,
                pending_task_enabled: reminderPolicy.pending_task_enabled,
                max_alerts: reminderPolicy.max_alerts,
              })
            }
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-60"
          >
            {commanderReminderPolicyMutation.isPending ? 'Saving...' : reminderPolicy.queue_open_enabled ? 'Disable queue alerts' : 'Enable queue alerts'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Current preset</span>
          <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 font-semibold uppercase tracking-[0.16em] text-cyan-100">
            {reminderPolicy.preset_id}
          </span>
          <span>Manual tweaks are saved as custom.</span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(reminderPolicy.available_presets?.length ? reminderPolicy.available_presets : DEFAULT_REMINDER_POLICY_PRESETS).map((preset) => (
            <PolicyPresetCard
              key={preset.preset_id}
              preset={preset}
              selected={reminderPolicy.preset_id === preset.preset_id}
              busy={commanderReminderPolicyMutation.isPending}
              onApply={() => commanderReminderPolicyMutation.mutate({ preset_id: preset.preset_id })}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <PolicyToggleCard
            label="Queue open alerts"
            enabled={reminderPolicy.queue_open_enabled}
            onToggle={() =>
              commanderReminderPolicyMutation.mutate({
                queue_open_enabled: !reminderPolicy.queue_open_enabled,
                task_running_enabled: reminderPolicy.task_running_enabled,
                pending_task_enabled: reminderPolicy.pending_task_enabled,
                max_alerts: reminderPolicy.max_alerts,
              })
            }
            busy={commanderReminderPolicyMutation.isPending}
          />
          <PolicyToggleCard
            label="Running task alerts"
            enabled={reminderPolicy.task_running_enabled}
            onToggle={() =>
              commanderReminderPolicyMutation.mutate({
                queue_open_enabled: reminderPolicy.queue_open_enabled,
                task_running_enabled: !reminderPolicy.task_running_enabled,
                pending_task_enabled: reminderPolicy.pending_task_enabled,
                max_alerts: reminderPolicy.max_alerts,
              })
            }
            busy={commanderReminderPolicyMutation.isPending}
          />
          <PolicyToggleCard
            label="Pending task reminder"
            enabled={reminderPolicy.pending_task_enabled}
            onToggle={() =>
              commanderReminderPolicyMutation.mutate({
                queue_open_enabled: reminderPolicy.queue_open_enabled,
                task_running_enabled: reminderPolicy.task_running_enabled,
                pending_task_enabled: !reminderPolicy.pending_task_enabled,
                max_alerts: reminderPolicy.max_alerts,
              })
            }
            busy={commanderReminderPolicyMutation.isPending}
          />
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Max alerts</div>
            <div className="mt-2 text-2xl font-semibold text-white">{reminderPolicy.max_alerts}</div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={commanderReminderPolicyMutation.isPending || reminderPolicy.max_alerts <= 1}
                onClick={() =>
                  commanderReminderPolicyMutation.mutate({
                    queue_open_enabled: reminderPolicy.queue_open_enabled,
                    task_running_enabled: reminderPolicy.task_running_enabled,
                    pending_task_enabled: reminderPolicy.pending_task_enabled,
                    max_alerts: reminderPolicy.max_alerts - 1,
                  })
                }
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white disabled:opacity-60"
              >
                -1
              </button>
              <button
                type="button"
                disabled={commanderReminderPolicyMutation.isPending || reminderPolicy.max_alerts >= 10}
                onClick={() =>
                  commanderReminderPolicyMutation.mutate({
                    queue_open_enabled: reminderPolicy.queue_open_enabled,
                    task_running_enabled: reminderPolicy.task_running_enabled,
                    pending_task_enabled: reminderPolicy.pending_task_enabled,
                    max_alerts: reminderPolicy.max_alerts + 1,
                  })
                }
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white disabled:opacity-60"
              >
                +1
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Policy change audit</div>
              <div className="mt-1 text-xs text-slate-500">Recent preset/manual changes with before-after fields.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                {reminderPolicyChanges.length} recent
              </span>
              <Link
                href="/settings/activities?type=xhs_commander_reminder_policy_change"
                className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
              >
                Open global activity
              </Link>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {reminderPolicyChanges.length ? (
              reminderPolicyChanges.map((change) => <PolicyChangeRow key={change.change_id} change={change} />)
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                No policy changes recorded yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
        <section className={`${CARD} p-5`}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
            <Radar className="h-4 w-4" />
            竞品笔记预览 / 入库
          </div>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            用于 Radar 读侧样本、RAG 入库和后续角色消费。预览优先从链接生成结构化样本，入库会写入租户知识层。
          </p>

          <div className="mt-4 space-y-3">
            <Field label="笔记链接" value={noteUrl} onChange={setNoteUrl} placeholder="https://www.xiaohongshu.com/explore/..." />
            <Field label="标题" value={title} onChange={setTitle} />
            <label className="block text-sm text-slate-300">
              正文摘要
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              评论样本，一行一条
              <textarea
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="行业" value={industry} onChange={setIndustry} />
              <Field label="细分" value={niche} onChange={setNiche} />
              <Field label="场景" value={scenario} onChange={setScenario} />
            </div>
            <Field label="目标角色" value={targetAgents} onChange={setTargetAgents} />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!noteUrl.trim() || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {previewMutation.isPending ? '预览中...' : '生成预览'}
              </button>
              <button
                type="button"
                disabled={ingestMutation.isPending}
                onClick={() => ingestMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                <Database className="h-4 w-4" />
                {ingestMutation.isPending ? '写入中...' : '写入租户知识'}
              </button>
            </div>

            {previewPayload ? (
              <InfoPanel title="预览结果" rows={[
                ['标题', previewPayload.note?.title || previewPayload.sample?.title || '-'],
                ['评论数', String(previewPayload.comments?.length ?? previewPayload.sample?.comments?.length ?? 0)],
                ['目标角色', (previewPayload.targetAgents ?? []).join(', ') || targetAgents],
              ]} />
            ) : null}
            {ingestResult ? (
              <InfoPanel title="入库结果" rows={[
                ['是否新写入', ingestResult.inserted ? '是' : '已存在 / 已更新'],
                ['语料 ID', ingestResult.corpusId || '-'],
                ['公式标题', ingestResult.formula?.title || '-'],
              ]} />
            ) : null}
          </div>
        </section>

        <section className={`${CARD} p-5`}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-rose-300">
            <MessageSquare className="h-4 w-4" />
            Handoff Pack / 角色交接
          </div>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Echoer 负责互动回复草稿，Catcher 负责线索筛选和 Followup 路由；如果 `route_hint = commander` 或 `artifact_state = needs_review`，必须显式升级 Commander。
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Mini label="schema" value={handoffQuery.data?.schema_version || 'xhs_supervisor_handoff/v1'} />
            <Mini label="待交接包" value={String(packs.length)} />
            <Mini label="Commander 焦点" value={String(commanderFocusPacks.length)} />
          </div>

          <div className="mt-4 space-y-3">
            {handoffQuery.isLoading ? (
              <EmptyState text="正在读取 handoff pack..." />
            ) : packs.length ? (
              packs.map((pack) => (
                <HandoffCard
                  key={pack.pack_id}
                  pack={pack}
                  latestAction={handoffActions[pack.pack_id]}
                  busy={handoffActionMutation.isPending}
                  onAction={(action) => handoffActionMutation.mutate({ packId: pack.pack_id, action })}
                />
              ))
            ) : (
              <EmptyState text="暂无可交接包。小红书边缘事件进入 supervisor handoff contract 后，会在这里出现。" />
            )}
          </div>
        </section>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <section className={`${CARD} p-5`}>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">Commander 风险队列</div>
          <div className="mt-2 text-sm leading-7 text-slate-400">
            高风险或需复核的包会进入 Commander 队列，可确认、分派或关闭。
          </div>
          <div className="mt-4 space-y-3">
            {(commanderQueueQuery.data?.items ?? []).length ? (
              (commanderQueueQuery.data?.items ?? []).map((item) => (
                <CommanderQueueCard
                  key={item.queue_id}
                  item={item}
                  task={taskByPack[item.pack_id]}
                  busy={commanderQueueMutation.isPending || createTaskMutation.isPending}
                  onAction={(action) => commanderQueueMutation.mutate({ packId: item.pack_id, action })}
                  onCreateTask={() => createTaskMutation.mutate(item.pack_id)}
                />
              ))
            ) : (
              <EmptyState text="暂无 Commander 队列。只有需要复核或风险升级的包会进入这里。" />
            )}
          </div>
        </section>

        <section className={`${CARD} p-5`}>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-fuchsia-300">Commander 轻任务</div>
          <div className="mt-2 text-sm leading-7 text-slate-400">
            队列项可以转成轻任务，进入 pending / in_progress / done 状态，完成后关闭对应 Commander 队列。
          </div>
          <div className="mt-4 space-y-3">
            {(commanderTasksQuery.data?.items ?? []).length ? (
              (commanderTasksQuery.data?.items ?? []).map((task) => (
                <CommanderTaskCard
                  key={task.task_id}
                  task={task}
                  busy={commanderTaskMutation.isPending}
                  onAction={(action) => commanderTaskMutation.mutate({ packId: task.pack_id, action })}
                />
              ))
            ) : (
              <EmptyState text="暂无 Commander 轻任务。先从风险队列创建任务，再在这里推进状态。" />
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-600"
      />
    </label>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone === 'warn' ? 'text-amber-200' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PolicyPresetCard({
  preset,
  selected,
  busy,
  onApply,
}: {
  preset: XhsCommanderReminderPolicyPreset;
  selected: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${selected ? 'border-cyan-300/40 bg-cyan-400/10' : 'border-white/10 bg-black/20'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{preset.label}</div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${selected ? 'border-cyan-300/40 text-cyan-100' : 'border-white/10 text-slate-400'}`}>
          {selected ? 'Active' : preset.preset_id}
        </span>
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-300">{preset.description}</div>
      <div className="mt-3 text-xs text-slate-500">
        queue {preset.queue_open_enabled ? 'on' : 'off'} / running {preset.task_running_enabled ? 'on' : 'off'} / pending{' '}
        {preset.pending_task_enabled ? 'on' : 'off'} / max {preset.max_alerts}
      </div>
      <button
        type="button"
        disabled={busy || selected}
        onClick={onApply}
        className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-60"
      >
        {busy ? 'Saving...' : selected ? 'Applied' : 'Apply preset'}
      </button>
    </div>
  );
}

function PolicyChangeRow({ change }: { change: XhsCommanderReminderPolicyChangeRecord }) {
  const fields = change.changed_fields.map((field) => `${field.field}: ${String(field.before)} to ${String(field.after)}`).join(' / ');
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/35 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">
          {change.from_preset_id} to {change.to_preset_id}
        </div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          {change.change_source}
        </span>
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-400">{fields || 'No field diff captured'}</div>
      <div className="mt-2 text-xs text-slate-500">
        {formatTime(change.changed_at)} / actor roles: {change.actor.roles.length ? change.actor.roles.join(', ') : '-'}
      </div>
    </div>
  );
}

function PolicyToggleCard({
  label,
  enabled,
  onToggle,
  busy,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-sm font-semibold ${enabled ? 'text-emerald-200' : 'text-slate-300'}`}>
        {enabled ? 'Enabled' : 'Disabled'}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onToggle}
        className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-60"
      >
        {busy ? 'Saving...' : enabled ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-8 text-center text-sm text-slate-400">{text}</div>;
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="text-right text-slate-200">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HandoffCard({
  pack,
  latestAction,
  busy,
  onAction,
}: {
  pack: XhsRoleHandoffPack;
  latestAction?: XhsHandoffActionRecord;
  busy: boolean;
  onAction: (action: XhsHandoffActionType) => void;
}) {
  const needsCommander = pack.route_hint === 'commander' || pack.artifact_state === 'needs_review';
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-slate-500">{pack.pack_id}</div>
          <div className="mt-2 text-base font-semibold text-white">{roleLabel(pack.role)} / {pack.artifact_type}</div>
          <div className="mt-1 text-xs text-slate-400">{pack.stage} / {pack.priority} / route: {pack.route_hint}</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${needsCommander ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}>
          {needsCommander ? '需 Commander 复核' : pack.artifact_state}
        </span>
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-300">{pack.summary}</div>
      <div className="mt-2 text-sm text-cyan-100">下一步：{pack.next_step}</div>
      {latestAction ? <div className="mt-2 text-xs text-slate-500">最近动作：{actionLabel(latestAction.action)} / {formatTime(latestAction.created_at)}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {(['claim', 'escalate_commander', 'route_catcher', 'route_followup', 'resolve'] as XhsHandoffActionType[]).map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => onAction(action)}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            {actionLabel(action)}
          </button>
        ))}
      </div>
    </article>
  );
}

function CommanderQueueCard({
  item,
  task,
  busy,
  onAction,
  onCreateTask,
}: {
  item: XhsCommanderEscalationQueueItem;
  task?: XhsCommanderTaskRecord;
  busy: boolean;
  onAction: (action: XhsCommanderQueueActionType) => void;
  onCreateTask: () => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-slate-500">{item.queue_id}</div>
          <div className="mt-2 text-sm font-semibold text-white">{item.pack_id}</div>
        </div>
        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">{item.status}</span>
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-300">{item.reason}</div>
      <div className="mt-2 text-xs text-slate-500">assignee: {item.assignee || '-'} / updated {formatTime(item.updated_at)}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['acknowledge', 'assign', 'close'] as XhsCommanderQueueActionType[]).map((action) => (
          <button key={action} type="button" disabled={busy} onClick={() => onAction(action)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50">
            {queueActionLabel(action)}
          </button>
        ))}
        <button type="button" disabled={busy || Boolean(task)} onClick={onCreateTask} className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs text-fuchsia-100 disabled:opacity-50">
          {task ? '已创建任务' : '创建轻任务'}
        </button>
      </div>
    </article>
  );
}

function CommanderTaskCard({
  task,
  busy,
  onAction,
}: {
  task: XhsCommanderTaskRecord;
  busy: boolean;
  onAction: (action: XhsCommanderTaskActionType) => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-slate-500">{task.task_id}</div>
          <div className="mt-2 text-sm font-semibold text-white">{task.title}</div>
        </div>
        <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-100">{task.status}</span>
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-300">{task.details.reason}</div>
      <div className="mt-2 text-xs text-slate-500">pack: {task.pack_id} / assignee: {task.assignee}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['start', 'complete'] as XhsCommanderTaskActionType[]).map((action) => (
          <button key={action} type="button" disabled={busy} onClick={() => onAction(action)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50">
            {taskActionLabel(action)}
          </button>
        ))}
      </div>
    </article>
  );
}
