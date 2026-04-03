'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { MessageSquare, Webhook, CheckCircle2, Copy, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

// Stub Feishu webhook config page — awaiting Task 3 backend implementation
// Real endpoint: POST /api/channels/feishu/config

const SUPPORTED_EVENTS = [
  { id: 'lead_captured', label: '线索入库', description: '铁网虾将新线索录入 CRM 时触发' },
  { id: 'content_published', label: '内容发布', description: '内容通过审批并成功发布至平台时触发' },
  { id: 'task_completed', label: '任务完成', description: '龙虾完成一个完整执行任务时触发' },
  { id: 'alert_triggered', label: '告警通知', description: '系统检测到异常或升级事件时触发' },
  { id: 'campaign_started', label: '活动开始', description: '新任务开始执行时发送通知' },
  { id: 'approval_required', label: '需要审批', description: '内容或操作需要人工审批时触发' },
];

type FeishuConfig = {
  webhook_url: string;
  secret: string;
  enabled: boolean;
  events: string[];
};

const DEFAULT_CONFIG: FeishuConfig = {
  webhook_url: '',
  secret: '',
  enabled: true,
  events: ['lead_captured', 'alert_triggered', 'approval_required'],
};

function TestResultBadge({ status }: { status: 'idle' | 'success' | 'error' | 'testing' }) {
  if (status === 'idle') return null;
  const styles = {
    testing: 'border-slate-600 bg-slate-800/50 text-slate-300',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    error: 'border-red-500/40 bg-red-500/10 text-red-300',
  };
  const labels = {
    testing: '测试中...',
    success: '✓ 发送成功',
    error: '✕ 发送失败，请检查 Webhook URL 和密钥',
  };
  return (
    <div className={`mt-3 rounded-xl border px-4 py-2.5 text-sm ${styles[status]}`}>
      {labels[status]}
    </div>
  );
}

export default function FeishuWebhookPage() {
  const [config, setConfig] = useState<FeishuConfig>(DEFAULT_CONFIG);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error' | 'testing'>('idle');
  const [saved, setSaved] = useState(false);

  const handleEventToggle = (eventId: string) => {
    setConfig((prev) => ({
      ...prev,
      events: prev.events.includes(eventId)
        ? prev.events.filter((e) => e !== eventId)
        : [...prev.events, eventId],
    }));
  };

  const handleTest = async () => {
    if (!config.webhook_url.trim()) return;
    setTestStatus('testing');
    // Stub: simulate API call
    await new Promise((r) => setTimeout(r, 1200));
    setTestStatus(config.webhook_url.includes('https://') ? 'success' : 'error');
  };

  const handleSave = async () => {
    // Stub: simulate save
    await new Promise((r) => setTimeout(r, 800));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-400/10">
              <MessageSquare className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">飞书 Webhook 配置</div>
              <div className="mt-0.5 text-sm text-slate-400">
                当龙虾完成关键任务或触发告警时，自动推送消息到飞书群
              </div>
            </div>
          </div>
          <span className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            Task-3 · 后端接入中
          </span>
        </div>
      </div>

      {/* How to get webhook URL */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-3">
          <Webhook className="h-4 w-4 text-cyan-300" />
          如何获取飞书 Webhook 地址
        </div>
        <ol className="space-y-1.5 text-sm text-slate-400">
          {[
            '在飞书客户端打开目标群组',
            '点击右上角「设置」→「机器人」→「添加机器人」',
            '选择「自定义机器人」，填写名称后确认',
            '复制「Webhook 地址」粘贴到下方输入框',
            '（可选）开启「安全设置」中的「签名校验」，将密钥填入下方',
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-400">
                {i + 1}
              </span>
              <span className="leading-5">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Config form */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="text-sm font-medium text-slate-300 mb-4">Webhook 基础配置</div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Webhook URL <span className="text-red-400">*</span>
            </label>
            <input
              className="w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50 font-mono"
              style={{ borderColor: BORDER }}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              value={config.webhook_url}
              onChange={(e) => setConfig((prev) => ({ ...prev, webhook_url: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              签名密钥（可选，启用后飞书端验证请求合法性）
            </label>
            <input
              type="password"
              className="w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50 font-mono"
              style={{ borderColor: BORDER }}
              placeholder="飞书机器人安全设置中的签名密钥"
              value={config.secret}
              onChange={(e) => setConfig((prev) => ({ ...prev, secret: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
              style={{ backgroundColor: config.enabled ? '#22d3ee' : 'rgba(71,85,105,0.6)' }}
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                style={{ transform: config.enabled ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </button>
            <span className="text-sm text-slate-300">启用此 Webhook</span>
          </div>
        </div>

        {/* Test button */}
        <div className="mt-4">
          <button
            type="button"
            disabled={!config.webhook_url.trim() || testStatus === 'testing'}
            onClick={handleTest}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition disabled:opacity-40"
            style={{ borderColor: BORDER, color: '#94a3b8' }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-spin' : ''}`} />
            发送测试消息
          </button>
          <TestResultBadge status={testStatus} />
        </div>
      </div>

      {/* Event subscriptions */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="text-sm font-medium text-slate-300 mb-4">
          推送事件配置
          <span className="ml-2 text-xs text-slate-500">已选 {config.events.length} 个事件</span>
        </div>
        <div className="space-y-2">
          {SUPPORTED_EVENTS.map((event) => {
            const active = config.events.includes(event.id);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => handleEventToggle(event.id)}
                className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition"
                style={{
                  borderColor: active ? 'rgba(34,211,238,0.3)' : BORDER,
                  backgroundColor: active ? 'rgba(34,211,238,0.05)' : 'transparent',
                }}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-cyan-400 bg-cyan-400' : 'border-slate-600'}`}>
                  {active && <CheckCircle2 className="h-3 w-3 text-slate-900" />}
                </span>
                <div>
                  <div className="text-sm font-medium" style={{ color: active ? '#22d3ee' : '#e2e8f0' }}>
                    {event.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{event.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Message preview */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
      >
        <div className="text-sm font-medium text-slate-300 mb-3">推送消息预览</div>
        <div className="rounded-xl bg-slate-950/60 p-4 font-mono text-xs text-slate-300 leading-6">
          <div className="text-green-400">【Dragon Senate · 线索入库】</div>
          <div className="mt-1">铁网虾于 14:23 捕获新线索</div>
          <div className="text-slate-500">租户：tenant_main · 评分：87分</div>
          <div className="text-cyan-400 mt-1">→ 查看详情</div>
        </div>
        <div className="mt-2 text-xs text-slate-500">消息格式在后端接入后支持自定义模板</div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-xl border px-5 py-2.5 text-sm text-slate-300 transition hover:bg-white/[0.04]"
          style={{ borderColor: BORDER }}
          onClick={() => setConfig(DEFAULT_CONFIG)}
        >
          重置
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-medium transition"
          style={{
            backgroundColor: saved ? '#34d399' : '#22d3ee',
            color: '#0f172a',
          }}
        >
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              已保存
            </>
          ) : (
            '保存配置'
          )}
        </button>
      </div>
    </div>
  );
}
