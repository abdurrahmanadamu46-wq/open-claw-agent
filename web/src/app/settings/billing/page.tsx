'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Coins, CreditCard, DatabaseZap, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  activateBillingTrial,
  createBillingCheckout,
  createSeatBillingCheckout,
  createSeatBillingSubscription,
  fetchBillingCompensation,
  fetchFeishuCallbackReadiness,
  fetchNotificationStatus,
  fetchBillingOrders,
  fetchBillingPlans,
  fetchBillingProvidersStatus,
  fetchBillingSubscription,
  fetchBillingUsageSummary,
  fetchBillingWebhookEvents,
  fetchSeatBillingPlans,
  fetchSeatBillingSubscription,
  fetchSeatQuotaSummary,
} from '@/services/endpoints/billing';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function providerReadyLabel(ready: boolean): string {
  return ready ? '已就绪' : '未就绪';
}

function subscriptionStatusLabel(status?: string): string {
  switch (status) {
    case 'trialing':
      return '试用中';
    case 'active':
      return '生效中';
    case 'past_due':
      return '已逾期';
    case 'canceled':
      return '已取消';
    case 'unpaid':
      return '未支付';
    case 'paused':
      return '已暂停';
    default:
      return status || '-';
  }
}

function orderStatusLabel(status?: string): string {
  switch (status) {
    case 'pending':
      return '待支付';
    case 'paid':
      return '已支付';
    case 'failed':
      return '失败';
    case 'canceled':
      return '已取消';
    case 'refunded':
      return '已退款';
    default:
      return status || '-';
  }
}

function notificationModeLabel(mode?: string): string {
  switch (mode) {
    case 'file':
      return '文件模式';
    case 'smtp':
      return 'SMTP';
    case 'sms-mock':
      return '短信模拟';
    default:
      return mode || '-';
  }
}

function cycleLabel(cycle?: string): string {
  switch (cycle) {
    case 'month':
      return '月付';
    case 'year':
      return '年付';
    default:
      return cycle || '-';
  }
}

export default function SettingsBillingPage() {
  const subscriptionQuery = useQuery({
    queryKey: ['settings', 'billing', 'subscription'],
    queryFn: () => fetchBillingSubscription(),
  });
  const plansQuery = useQuery({
    queryKey: ['settings', 'billing', 'plans'],
    queryFn: fetchBillingPlans,
  });
  const usageQuery = useQuery({
    queryKey: ['settings', 'billing', 'usage'],
    queryFn: () => fetchBillingUsageSummary(),
  });
  const providerQuery = useQuery({
    queryKey: ['settings', 'billing', 'providers'],
    queryFn: fetchBillingProvidersStatus,
  });
  const ordersQuery = useQuery({
    queryKey: ['settings', 'billing', 'orders'],
    queryFn: () => fetchBillingOrders(),
  });
  const compensationQuery = useQuery({
    queryKey: ['settings', 'billing', 'compensation'],
    queryFn: () => fetchBillingCompensation(),
  });
  const webhookEventsQuery = useQuery({
    queryKey: ['settings', 'billing', 'webhook-events'],
    queryFn: fetchBillingWebhookEvents,
  });
  const notificationQuery = useQuery({
    queryKey: ['settings', 'billing', 'notification-status'],
    queryFn: fetchNotificationStatus,
  });
  const feishuReadinessQuery = useQuery({
    queryKey: ['settings', 'billing', 'feishu-readiness'],
    queryFn: fetchFeishuCallbackReadiness,
  });
  const seatPlansQuery = useQuery({
    queryKey: ['settings', 'billing', 'seat-plans'],
    queryFn: fetchSeatBillingPlans,
  });
  const seatSubscriptionQuery = useQuery({
    queryKey: ['settings', 'billing', 'seat-subscription'],
    queryFn: fetchSeatBillingSubscription,
  });
  const seatQuotaQuery = useQuery({
    queryKey: ['settings', 'billing', 'seat-quota'],
    queryFn: async () => {
      const sub = await fetchSeatBillingSubscription();
      if (!sub.subscription?.tenant_id) {
        return { ok: true, summary: null };
      }
      return fetchSeatQuotaSummary(sub.subscription.tenant_id);
    },
  });

  const subscription = subscriptionQuery.data?.subscription;
  const usage = usageQuery.data?.summary;
  const planRows = Object.entries(plansQuery.data?.plans ?? {});
  const seatPlans = seatPlansQuery.data?.tiers ?? [];
  const seatSubscription = seatSubscriptionQuery.data?.subscription;
  const seatQuota = seatQuotaQuery.data?.summary;
  const providers = providerQuery.data?.providers.providers ?? {};
  const orders = ordersQuery.data?.orders ?? [];
  const compensation = compensationQuery.data?.items ?? [];
  const webhookEvents = webhookEventsQuery.data?.items ?? [];
  const notificationStatus = notificationQuery.data?.notifications;
  const feishuReadiness = feishuReadinessQuery.data;
  const hasError =
    subscriptionQuery.isError || plansQuery.isError || usageQuery.isError || providerQuery.isError;

  async function handleTrialActivate() {
    try {
      const result = await activateBillingTrial({ planCode: 'pro', durationDays: 14 });
      triggerSuccessToast(`试用已开启：${result.subscription.plan_code}`);
      await Promise.all([subscriptionQuery.refetch(), usageQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '试用开启失败');
    }
  }

  async function handleCheckout(planCode: string, cycle: string) {
    try {
      const result = await createBillingCheckout({
        planCode,
        cycle,
        returnUrl: `${window.location.origin}/settings/billing`,
      });
      triggerSuccessToast(`结算订单已创建：${result.order.order_id}`);
      window.open(result.checkout.checkout_url, '_blank', 'noopener,noreferrer');
      await ordersQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '结算订单创建失败');
    }
  }

  async function handleCreateSeatSubscription() {
    try {
      const result = await createSeatBillingSubscription({
        seatCount: 20,
        billingCycle: 'monthly',
      });
      triggerSuccessToast(`已创建 ${result.subscription.seat_count} 席订阅`);
      await Promise.all([seatSubscriptionQuery.refetch(), seatQuotaQuery.refetch()]);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '席位订阅创建失败');
    }
  }

  async function handleSeatCheckout() {
    if (!seatSubscription?.id) {
      triggerErrorToast('请先创建席位订阅');
      return;
    }
    try {
      const result = await createSeatBillingCheckout(seatSubscription.id, {
        provider: 'wechatpay',
        returnUrl: `${window.location.origin}/settings/billing`,
      });
      triggerSuccessToast(`席位结算单已创建：${result.checkout.order_id}`);
      window.open(result.checkout.checkout_url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '席位结算失败');
    }
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="commercial"
        step="主线第 6 步 · 商业化"
        title="账单与订阅"
        description="这里不只是看价格，而是判断当前租户是否已经具备可收费、可续费、可回调、可通知的商业化条件。"
        previous={{ href: '/operations/autopilot/trace', label: '回到 Trace 复盘' }}
        next={{ href: '/settings/integrations', label: '前往集成中心' }}
      />

      {hasError && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>账单数据加载失败，请确认 backend 和 AI 子服务都在运行。</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<CreditCard className="h-5 w-5 text-amber-300" />} label="当前套餐" value={subscription ? `${subscription.plan_code} / ${subscription.cycle}` : '-'} />
        <MetricCard icon={<Coins className="h-5 w-5 text-emerald-300" />} label="任务用量" value={subscription ? `${formatNumber(subscription.used_runs)} / ${formatNumber(subscription.run_limit)}` : '-'} />
        <MetricCard icon={<DatabaseZap className="h-5 w-5 text-cyan-300" />} label="Token 用量" value={subscription ? `${formatNumber(subscription.used_tokens)} / ${formatNumber(subscription.token_limit)}` : '-'} />
        <MetricCard icon={<ShieldCheck className="h-5 w-5 text-sky-300" />} label="默认服务商" value={providerQuery.data?.providers.default_provider ?? '-'} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>订阅信息</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            {!subscription ? (
              <div className="text-slate-400">当前没有订阅数据。</div>
            ) : (
              <>
                <InfoRow label="状态" value={subscriptionStatusLabel(subscription.status)} />
                <InfoRow label="租户" value={subscription.tenant_id} />
                <InfoRow label="用户" value={subscription.user_id} />
                <InfoRow label="支付服务商" value={subscription.payment_provider} />
                <InfoRow label="周期开始" value={new Date(subscription.current_period_start).toLocaleString()} />
                <InfoRow label="周期结束" value={new Date(subscription.current_period_end).toLocaleString()} />
                <InfoRow label="自动续费" value={subscription.auto_renew ? '已开启' : '未开启'} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>用量摘要</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            {!usage ? (
              <div className="text-slate-400">当前没有用量数据。</div>
            ) : (
              <>
                <InfoRow label="总任务数" value={formatNumber(usage.total_runs)} />
                <InfoRow label="总 Token" value={formatNumber(usage.total_tokens)} />
                <InfoRow label="预估成本" value={`${usage.total_cost_cny.toFixed(2)} 元`} />
                <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                  <div className="mb-2 text-xs font-medium text-slate-400">按事件类型拆分</div>
                  <div className="space-y-2">
                    {Object.entries(usage.by_event_type ?? {}).length === 0 ? (
                      <div className="text-xs text-slate-500">当前没有事件拆分数据。</div>
                    ) : (
                      Object.entries(usage.by_event_type ?? {}).map(([eventType, row]) => (
                        <div key={eventType} className="flex items-center justify-between text-xs text-slate-300">
                          <span>{eventType}</span>
                          <span>{row.runs} 次 / {formatNumber(row.tokens)} tokens</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>套餐目录</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {planRows.length === 0 ? (
              <div className="text-sm text-slate-400">当前没有套餐配置。</div>
            ) : (
              planRows.map(([planCode, row]) => (
                <div key={planCode} className="rounded-2xl border border-white/8 bg-slate-950/40 p-4 text-sm text-slate-200">
                  <div className="text-base font-semibold text-slate-100">{planCode}</div>
                  <div className="mt-2 space-y-1 text-xs text-slate-400">
                    <div>月付：{row.price_month_cny} 元</div>
                    <div>年付：{row.price_year_cny} 元</div>
                    <div>任务上限：{formatNumber(row.run_limit)}</div>
                    <div>Token 上限：{formatNumber(row.token_limit)}</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>支付服务商健康度</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(providers).length === 0 ? (
              <div className="text-sm text-slate-400">当前没有服务商状态。</div>
            ) : (
              Object.entries(providers).map(([provider, row]) => (
                <div key={provider} className="flex items-center justify-between rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3 text-sm">
                  <span className="text-slate-100">{provider}</span>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${row.enabled ? 'bg-cyan-500/15 text-cyan-200' : 'bg-slate-500/15 text-slate-300'}`}>
                      {row.enabled ? '默认' : '候选'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${row.ready ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
                      {providerReadyLabel(row.ready)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>V7 席位订阅</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            {seatSubscription ? (
              <>
                <InfoRow label="状态" value={seatSubscription.status} />
                <InfoRow label="席位数" value={`${seatSubscription.seat_count} 席`} />
                <InfoRow label="单席采购价" value={`¥${seatSubscription.unit_price.toLocaleString('zh-CN')}`} />
                <InfoRow label="月度金额" value={`¥${seatSubscription.monthly_amount.toLocaleString('zh-CN')}`} />
                <InfoRow label="试用截止" value={seatSubscription.trial_ends_at ? new Date(seatSubscription.trial_ends_at).toLocaleString() : '-'} />
              </>
            ) : (
              <div className="text-slate-400">当前还没有 V7 席位订阅，可直接创建 20 席代理起步订阅。</div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" onClick={() => void handleCreateSeatSubscription()} className="rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950">
                创建 20 席订阅
              </button>
              <button type="button" onClick={() => void handleSeatCheckout()} className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200">
                生成微信结算
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>席位梯度与配额</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            <div className="grid gap-2">
              {seatPlans.slice(0, 4).map((tier) => (
                <div key={`${tier.min_seats}-${tier.max_seats}`} className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span>{tier.min_seats}-{tier.max_seats} 席</span>
                    <span className="text-cyan-200">¥{tier.unit_price.toLocaleString('zh-CN')}/席</span>
                  </div>
                </div>
              ))}
            </div>
            {seatQuota ? (
              <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                <div className="text-xs text-slate-400">当前整体健康度</div>
                <div className="mt-2 text-base font-semibold text-white">{seatQuota.overall_health}</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {Object.entries(seatQuota.quotas).slice(0, 4).map(([key, quota]) => (
                    <div key={key} className="rounded-xl bg-slate-900/70 px-3 py-2 text-xs">
                      <div className="text-slate-400">{key}</div>
                      <div className="mt-1 text-white">{quota.used}/{quota.limit} ({quota.usage_pct}%)</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-slate-500">创建席位订阅后会显示配额汇总。</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader><CardTitle>自助动作</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
              <div className="font-medium text-slate-100">开启试用</div>
              <div className="mt-1 text-xs text-slate-400">在不触碰生产商户密钥的情况下，先开启 14 天专业版试用。</div>
              <button
                type="button"
                onClick={() => void handleTrialActivate()}
                className="mt-3 rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950"
              >
                开启 14 天试用
              </button>
            </div>

            <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
              <div className="font-medium text-slate-100">创建结算订单</div>
              <div className="mt-1 text-xs text-slate-400">在支付切真前，仍然可以完整演练结算链路。</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckout('pro', 'month')}
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                >
                  Pro 月付
                </button>
                <button
                  type="button"
                  onClick={() => void handleCheckout('enterprise', 'month')}
                  className="rounded-2xl border border-slate-600 px-3 py-2 text-sm text-slate-200"
                >
                  企业版月付
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>通知与回调就绪度</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            <InfoRow label="通知模式" value={notificationModeLabel(notificationStatus?.mode)} />
            <InfoRow label="SMTP 已配置" value={notificationStatus?.smtp?.configured ? '是' : '否'} />
            <InfoRow label="短信 webhook 已配置" value={notificationStatus?.sms_webhook_configured ? '是' : '否'} />
            <InfoRow label="Feishu 回调已就绪" value={feishuReadiness?.ready ? '是' : '否'} />
            <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4 text-xs text-slate-400">
              callback 地址：{feishuReadiness?.callback_url || '（尚未配置）'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader><CardTitle>最近订单</CardTitle></CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <div className="text-sm text-slate-400">当前还没有结算订单。</div>
            ) : (
              <div className="space-y-2">
                {orders.map((order) => (
                  <div key={order.order_id} className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-100">{order.order_id}</div>
                        <div className="text-xs text-slate-400">{order.plan_code} / {cycleLabel(order.cycle)} / {order.payment_provider}</div>
                      </div>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200">{orderStatusLabel(order.status)}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {order.amount_cny} {order.currency} · {new Date(order.updated_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>补偿任务与 webhook 监控</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-400">补偿任务</div>
              {compensation.length === 0 ? (
                <div className="text-sm text-slate-400">当前没有补偿任务。</div>
              ) : (
                <div className="space-y-2">
                  {compensation.slice(0, 5).map((task) => (
                    <div key={task.task_id} className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
                      {task.reason_code} · {task.status} · {task.order_id}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-slate-400">Webhook 事件</div>
              {webhookEvents.length === 0 ? (
                <div className="text-sm text-slate-400">当前没有 webhook 事件。</div>
              ) : (
                <div className="space-y-2">
                  {webhookEvents.slice(0, 5).map((event) => (
                    <div key={`${event.provider}:${event.event_id}`} className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
                      {event.provider} · {event.action} · {event.duplicate ? '重复事件' : '新事件'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 last:border-b-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}
