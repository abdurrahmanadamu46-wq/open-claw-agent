'use client';

import { useEffect, useState } from 'react';
import { BellRing, RefreshCw } from 'lucide-react';
import {
  createAlertChannel,
  createAlertRule,
  evaluateAlertRules,
  fetchAlertChannels,
  fetchAlertEvents,
  fetchAlertRules,
} from '@/services/endpoints/ai-subservice';
import type { AlertNotificationChannel, AlertRule } from '@/types/alert-engine';

const EMPTY_RULE = {
  name: '',
  description: '',
  metric: 'quality_score',
  aggregation: 'avg',
  condition: '<',
  threshold: 7,
  window_seconds: 1800,
  pending_seconds: 300,
  silence_seconds: 1800,
  severity: 'warning' as const,
  notification_channel_ids: [] as string[],
  enabled: true,
};

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [channels, setChannels] = useState<AlertNotificationChannel[]>([]);
  const [draft, setDraft] = useState(EMPTY_RULE);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rulesRes, eventsRes, channelsRes] = await Promise.all([
        fetchAlertRules(),
        fetchAlertEvents(50),
        fetchAlertChannels(),
      ]);
      setRules(rulesRes.items || []);
      setEvents(eventsRes.items || []);
      setChannels(channelsRes.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载告警失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const ensureDefaultChannel = async () => {
    if (channels.length > 0) return channels[0].channel_id;
    const created = await createAlertChannel({
      name: '平台默认通知',
      channel_type: 'notification_center',
      config: {},
      severity_filter: 'all',
      enabled: true,
    });
    setChannels((prev) => [...prev, created.channel]);
    return created.channel.channel_id;
  };

  const handleCreateRule = async () => {
    try {
      const channelId = draft.notification_channel_ids[0] || (await ensureDefaultChannel());
      await createAlertRule({
        ...draft,
        notification_channel_ids: [channelId],
      } as any);
      setMessage(`已创建规则 ${draft.name}`);
      setDraft(EMPTY_RULE);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建规则失败');
    }
  };

  const handleEvaluate = async () => {
    try {
      const result = await evaluateAlertRules();
      setMessage(`本次评估完成，触发 ${result.events.length} 条告警事件`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '手动评估失败');
    }
  };

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-2xl font-semibold text-white">
              <BellRing className="h-6 w-6 text-amber-300" />
              告警规则引擎
            </div>
            <div className="mt-2 text-sm text-slate-400">参考 Grafana / SigNoz，把质量分、错误率和边缘离线规则做成可配置告警。</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleEvaluate()} className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
              立即评估
            </button>
            <button type="button" onClick={() => void load()} className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100">
              <RefreshCw className="mr-2 inline h-4 w-4" />
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>
        {message ? <div className="mt-3 text-sm text-cyan-200">{message}</div> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 text-lg font-semibold text-white">新建规则</div>
          <div className="space-y-3">
            <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="规则名称" className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
            <textarea value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="规则说明" rows={3} className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
            <div className="grid gap-3 md:grid-cols-4">
              <select value={draft.metric} onChange={(e) => setDraft((prev) => ({ ...prev, metric: e.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white">
                <option value="quality_score">quality_score</option>
                <option value="error_rate">error_rate</option>
                <option value="run_count">run_count</option>
                <option value="duration_ms">duration_ms</option>
                <option value="edge_offline_count">edge_offline_count</option>
              </select>
              <select value={draft.aggregation} onChange={(e) => setDraft((prev) => ({ ...prev, aggregation: e.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white">
                <option value="avg">avg</option>
                <option value="count">count</option>
                <option value="p90">p90</option>
                <option value="p99">p99</option>
              </select>
              <select value={draft.condition} onChange={(e) => setDraft((prev) => ({ ...prev, condition: e.target.value }))} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white">
                <option value="<">{'<'}</option>
                <option value=">">{'>'}</option>
                <option value="<=">{'<='}</option>
                <option value=">=">{'>='}</option>
              </select>
              <input type="number" value={draft.threshold} onChange={(e) => setDraft((prev) => ({ ...prev, threshold: Number(e.target.value) }))} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input type="number" value={draft.window_seconds} onChange={(e) => setDraft((prev) => ({ ...prev, window_seconds: Number(e.target.value) }))} placeholder="window_seconds" className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
              <input type="number" value={draft.pending_seconds} onChange={(e) => setDraft((prev) => ({ ...prev, pending_seconds: Number(e.target.value) }))} placeholder="pending_seconds" className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
              <input type="number" value={draft.silence_seconds} onChange={(e) => setDraft((prev) => ({ ...prev, silence_seconds: Number(e.target.value) }))} placeholder="silence_seconds" className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white" />
            </div>
            <button type="button" onClick={() => void handleCreateRule()} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">
              创建规则
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 text-lg font-semibold text-white">规则列表</div>
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.rule_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{rule.name}</div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{rule.state}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{rule.metric} {rule.condition} {rule.threshold} · {rule.aggregation} / {rule.window_seconds}s</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 text-lg font-semibold text-white">最近告警事件</div>
            <div className="space-y-3">
              {events.map((event: any) => (
                <div key={event.event_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white">{event.rule_name}</div>
                  <div className="mt-1 text-xs text-slate-400">{event.state} · {event.severity} · {event.fired_at}</div>
                  <div className="mt-2 text-sm text-slate-300">{event.message}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
