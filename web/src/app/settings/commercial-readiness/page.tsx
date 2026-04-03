'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { fetchCommercialReadiness } from '@/services/endpoints/ai-subservice';
import { fetchNotificationOutbox, sendNotificationTest } from '@/services/endpoints/billing';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

type BlockerRow = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  domain: string;
  title: string;
  detail: string;
  next_action: string;
};

function scoreTone(score: number) {
  if (score >= 90) return 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10';
  if (score >= 60) return 'text-amber-200 border-amber-500/35 bg-amber-500/10';
  return 'text-rose-200 border-rose-500/35 bg-rose-500/10';
}

function severityTone(severity: string) {
  if (severity === 'high') return 'border-rose-500/35 bg-rose-500/10 text-rose-200';
  if (severity === 'medium') return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  return 'border-slate-600 bg-slate-800/80 text-slate-200';
}

function readinessStatusLabel(status: string) {
  switch (status) {
    case 'ready':
      return '已就绪';
    case 'warning':
      return '存在提醒';
    case 'blocked':
      return '存在阻塞';
    default:
      return '待确认';
  }
}

function notificationModeLabel(mode: string) {
  switch (mode) {
    case 'file':
      return '文件模式';
    case 'smtp':
      return 'SMTP';
    case 'sms-mock':
      return '短信模拟';
    default:
      return mode || '待确认';
  }
}

const CUTOVER_RUNBOOKS = [
  {
    title: '支付切真',
    owner: '财务 + 后端',
    steps: [
      '绑定生产商户账号与证书。',
      '在正式 checkout 前配置 webhook HMAC secret 和回跳地址。',
      '先用小流量 canary 租户执行一次对账与补偿演练。',
    ],
    href: '/settings/billing',
    cta: '打开账单控制台',
  },
  {
    title: '通知切真',
    owner: '运维 + 送达保障',
    steps: [
      '从文件模式切到 SMTP 或短信生产通道。',
      '发送一次测试通知，确认 outbox 和 inbox 都成功到达。',
      '保留回退到文件模式的旁路，便于故障隔离。',
    ],
    href: '/help',
    cta: '打开帮助中心',
  },
  {
    title: 'Feishu 回调切真',
    owner: '平台 + 集成',
    steps: [
      '确认公网 HTTPS callback URL 和 challenge 响应。',
      '核对签名密钥和应用订阅配置。',
      '正式接流量前先执行一次 callback smoke test。',
    ],
    href: '/settings/commercial-readiness',
    cta: '查看就绪度',
  },
];

export default function CommercialReadinessPage() {
  const readinessQuery = useQuery({
    queryKey: ['settings', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });
  const outboxQuery = useQuery({
    queryKey: ['settings', 'commercial-readiness', 'notification-outbox'],
    queryFn: () => fetchNotificationOutbox(10),
    retry: false,
  });

  const readiness = readinessQuery.data?.readiness;
  const blockers = useMemo(() => ((readiness?.blockers ?? []) as BlockerRow[]), [readiness?.blockers]);
  const score = Number(readiness?.score ?? 0);
  const status = String(readiness?.status ?? 'unknown');

  const [testTarget, setTestTarget] = useState('ops@example.com');
  const [testText, setTestText] = useState('Lobster Pool commercial readiness notification test');
  const [busy, setBusy] = useState(false);

  const summaryCards = useMemo(
    () => [
      {
        title: '就绪度评分',
        value: String(score),
        subtitle: readinessStatusLabel(status),
        icon: <ShieldCheck className="h-5 w-5" />,
      },
      {
        title: '阻塞项',
        value: String(readiness?.blocker_count ?? 0),
        subtitle: blockers.length > 0 ? `${blockers.filter((item) => item.severity === 'high').length} 个高优先级` : '当前已清空',
        icon: <ShieldAlert className="h-5 w-5" />,
      },
      {
        title: '通知模式',
        value: notificationModeLabel(String((readiness?.notifications as Record<string, unknown> | undefined)?.mode ?? '-')),
        subtitle: String(
          (((readiness?.notifications as Record<string, unknown> | undefined)?.smtp as Record<string, unknown> | undefined)?.configured)
            ? 'SMTP 已配置'
            : 'SMTP 待配置',
        ),
        icon: <Mail className="h-5 w-5" />,
      },
      {
        title: 'Feishu 回调',
        value: String((readiness?.feishu as Record<string, unknown> | undefined)?.enabled ? '已启用' : '未启用'),
        subtitle: String((readiness?.feishu as Record<string, unknown> | undefined)?.callback_url ?? '缺少 callback 地址'),
        icon: <Wrench className="h-5 w-5" />,
      },
    ],
    [blockers, readiness?.blocker_count, readiness?.feishu, readiness?.notifications, score, status],
  );

  async function handleNotificationTest() {
    setBusy(true);
    try {
      const result = await sendNotificationTest(testTarget.trim(), testText.trim());
      triggerSuccessToast(`Notification test sent via ${result.result.mode}`);
      await outboxQuery.refetch();
      await readinessQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : 'Notification test failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="commercial"
        step="主线第 6 步 · 商业化"
        title="把切真阻塞项压成一张可执行清单"
        description="商业化就绪度不是展示页，而是上线前的协同看板。你应该一眼看到阻塞项、优先级和下一步执行动作。"
        previous={{ href: '/operations/autopilot/trace', label: '回到 Trace 复盘' }}
        next={{ href: '/settings/billing', label: '前往账单与订阅' }}
      />

      {readinessQuery.isError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          商业化就绪度加载失败。需要管理员角色，并且 backend 与 AI 子服务必须保持连通。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <div key={item.title} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {item.icon}
              <span>{item.title}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">{item.value}</div>
            <div className="mt-1 text-xs text-slate-400">{item.subtitle}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.9fr]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 text-lg font-semibold text-white">上线阻塞项</div>
          {blockers.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
              当前未发现阻塞项，这套环境已经接近可上线状态。
            </div>
          ) : (
            <div className="space-y-3">
              {blockers.map((item) => (
                <div key={item.id} className={`rounded-2xl border px-4 py-4 ${severityTone(item.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{item.title}</div>
                      <div className="mt-1 text-xs opacity-80">{item.domain} · {item.severity}</div>
                    </div>
                    {item.severity === 'high' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  </div>
                  <div className="mt-3 text-sm">{item.detail}</div>
                  <div className="mt-3 rounded-xl bg-black/15 px-3 py-2 text-xs">{item.next_action}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 text-lg font-semibold text-white">通知通道测试</div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">目标地址</span>
                <input
                  value={testTarget}
                  onChange={(e) => setTestTarget(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">测试内容</span>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleNotificationTest()}
                className="rounded-2xl bg-cyan-500 px-4 py-2.5 font-medium text-slate-950 disabled:opacity-50"
              >
                {busy ? '发送中...' : '发送测试通知'}
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 text-lg font-semibold text-white">最近通知出站记录</div>
            {outboxQuery.data?.items?.length ? (
              <div className="space-y-2">
                {outboxQuery.data.items.map((item) => (
                  <div key={item.file} className="rounded-2xl border border-white/8 bg-slate-950/40 px-3 py-3 text-sm">
                    <div className="font-medium text-slate-100">{item.kind}</div>
                    <div className="text-xs text-slate-400">{item.target} · {item.channel}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{item.file}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400">当前还没有通知出站记录。</div>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/settings/billing" className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-cyan-200">
          打开账单控制台
        </Link>
        <Link href="/pricing" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-slate-200">
          打开套餐页
        </Link>
        <Link href="/legal/icp-ready" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-slate-200">
          打开 ICP 页面
        </Link>
      </div>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 text-lg font-semibold text-white">切真 Runbook</div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {CUTOVER_RUNBOOKS.map((item) => (
            <div key={item.title} className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold text-slate-100">{item.title}</div>
              <div className="mt-1 text-xs text-slate-400">{item.owner}</div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                {item.steps.map((step, index) => (
                  <div key={step} className="flex gap-2">
                    <span className="text-cyan-300">{index + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
              <Link href={item.href} className="mt-4 inline-flex rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200">
                {item.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
