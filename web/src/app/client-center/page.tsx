'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeAlert,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
  Waypoints,
} from 'lucide-react';
import { fetchCommercialReadiness, fetchHitlPending } from '@/services/endpoints/ai-subservice';
import { getCurrentUser } from '@/services/endpoints/user';

const desktopModules = [
  {
    title: '安装与授权',
    value: '激活码 + 边缘绑定',
    detail: '客户执行端只负责安装、授权和回传结果，不承担策略脑与治理决策。',
  },
  {
    title: '在线奖励',
    value: '在线时长 -> 配额',
    detail: '客户端可根据在线贡献获取执行配额，帮助执行网络保持稳定供给。',
  },
  {
    title: '验证码中继',
    value: '即收即转',
    detail: '用于账号续航和登录挑战，不持久保存明文验证码。',
  },
  {
    title: '结果回传',
    value: '客户只看结果',
    detail: '云端多龙虾负责策略与执行编排，客户端只看到结果快照、审批状态与收益变化。',
  },
];

const customerFlows = [
  '飞书 / 钉钉接收审批请求，Mobile Web 作为兜底入口。',
  '高风险动作默认走人机协同，审批结果自动回写到 trace 和审计链。',
  '客户可从移动端一键跳转回控制台，查看上下文、结果和责任路径。',
];

function statusTone(ok: boolean): string {
  return ok
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
    : 'border-amber-400/25 bg-amber-400/10 text-amber-100';
}

function readinessLabel(status?: string) {
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

export default function ClientCenterPage() {
  const currentUserQuery = useQuery({
    queryKey: ['client-center', 'current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const readinessQuery = useQuery({
    queryKey: ['client-center', 'readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });
  const approvalsQuery = useQuery({
    queryKey: ['client-center', 'hitl-pending'],
    queryFn: () => fetchHitlPending(20),
    retry: false,
  });

  const currentUser = currentUserQuery.data;
  const readiness = readinessQuery.data?.readiness;
  const pendingApprovals = approvalsQuery.data?.items ?? [];
  const topBlockers = readiness?.blockers?.slice(0, 3) ?? [];
  const domainCards = [
    {
      title: '部署',
      value: readiness?.deploy.mode || '待确认',
      detail: `区域 ${readiness?.deploy.region || '待确认'}`,
      ok: Boolean(readiness?.deploy.mode && readiness.deploy.mode !== 'preview'),
    },
    {
      title: '支付',
      value: readiness?.payment.provider || '未配置',
      detail: `checkout ${readiness?.payment.checkout || '未配置'}`,
      ok: Boolean(readiness?.payment.provider && readiness.payment.checkout && readiness.payment.checkout !== 'sandbox'),
    },
    {
      title: '通知',
      value: readiness?.notifications.mode || '待确认',
      detail: readiness?.notifications.smtp?.configured ? 'SMTP 已配置' : 'SMTP 待配置',
      ok: Boolean(readiness?.notifications.smtp?.configured || readiness?.notifications.mode === 'file'),
    },
    {
      title: 'Feishu',
      value: readiness?.feishu.enabled ? '已启用' : '未启用',
      detail: readiness?.feishu.callback_url || '缺少 callback 地址',
      ok: Boolean(readiness?.feishu.enabled && readiness?.feishu.callback_url),
    },
  ];

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_76%_10%,rgba(245,158,11,0.14),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-7xl px-6 py-14">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              客户中心：给客户看的不是复杂系统，而是可控、可见、可审批的结果面
            </div>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.04] text-white">
              一个更像业务操作面的客户工作台，
              <br />
              而不是“AI 内部控制台”的镜像。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              桌面端负责执行与回传，移动端负责审批和响应，策略脑与治理核心留在云端。
              这样客户能享受到系统能力，又不会背上复杂的技术负担。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/client-mobile"
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 font-medium text-slate-950"
              >
                打开移动审批
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/settings/commercial-readiness"
                className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 font-medium text-cyan-100"
              >
                查看商业化就绪度
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="text-xs uppercase tracking-[0.24em] text-amber-200/80">Client Snapshot</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {currentUser?.tenantName || currentUser?.tenantId || '当前租户'}
            </div>
            <div className="mt-2 text-sm text-slate-400">
              操作者：{currentUser?.name ?? '未知用户'} · 角色：{currentUser?.role || 'viewer'}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <KpiCard label="商业化得分" value={String(readiness?.score ?? 0)} detail={`阻塞项 ${readiness?.blocker_count ?? 0} 个`} />
              <KpiCard label="待审批动作" value={String(pendingApprovals.length)} detail="支持移动端快速通过或拒绝" />
              <KpiCard label="执行边界" value="云脑 + 边缘" detail="边缘节点只执行，不持有策略脑" />
              <KpiCard label="治理模式" value="审批优先" detail="高风险动作默认进入 HITL" />
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-3">
          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-white">
              <ShieldCheck className="h-5 w-5 text-cyan-200" />
              <h2 className="text-lg font-semibold">商业化就绪度</h2>
            </div>
            <div className="mt-4 text-4xl font-semibold text-white">{readiness?.score ?? 0}</div>
            <div className="mt-2 text-sm text-slate-400">
              当前状态：{readinessLabel(readiness?.status)} · 阻塞项 {readiness?.blocker_count ?? 0}
            </div>
            <Link
              href="/settings/commercial-readiness"
              className="mt-5 inline-flex rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100"
            >
              打开就绪度面板
            </Link>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-white">
              <Smartphone className="h-5 w-5 text-amber-200" />
              <h2 className="text-lg font-semibold">移动审批环</h2>
            </div>
            <div className="mt-4 text-4xl font-semibold text-white">{pendingApprovals.length}</div>
            <div className="mt-2 text-sm text-slate-400">
              适合客户、运营和审批人快速处理高风险动作，不用回到复杂后台。
            </div>
            <Link
              href="/client-mobile"
              className="mt-5 inline-flex rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100"
            >
              打开移动审批环
            </Link>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-white">
              <Wallet className="h-5 w-5 text-emerald-200" />
              <h2 className="text-lg font-semibold">商业动作</h2>
            </div>
            <div className="mt-4 text-base leading-7 text-slate-300">
              客户看到的应该是试用、订单、账单、审批与收益结果，而不是一堆系统内部节点名称。
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/pricing" className="rounded-xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm text-white">
                查看套餐
              </Link>
              <Link href="/settings/billing" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
                查看账单
              </Link>
            </div>
          </article>
        </section>

        <section className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Cutover Snapshot</div>
              <h2 className="mt-2 text-xl font-semibold text-white">客户侧能看懂的切真状态</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                这里不展示后端原始 payload，而是把上线前最重要的四个域压成客户能理解的状态：部署、支付、通知和 Feishu 回调。
              </p>
            </div>
            <Link
              href="/settings/commercial-readiness"
              className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100"
            >
              查看完整闸门
            </Link>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {domainCards.map((item) => (
              <DomainStatusCard key={item.title} {...item} />
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-white">
              <MonitorSmartphone className="h-5 w-5 text-cyan-200" />
              <h2 className="text-xl font-semibold">桌面执行端的职责边界</h2>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {desktopModules.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-white">{item.title}</div>
                    <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                      {item.value}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
            <div className="flex items-center gap-2 text-white">
              <Waypoints className="h-5 w-5 text-amber-200" />
              <h2 className="text-xl font-semibold">客户视角下的操作主线</h2>
            </div>
            <ul className="mt-5 space-y-3">
              {customerFlows.map((item, index) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-slate-300">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white">
                    {index + 1}
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[0.88fr_1.12fr]">
          <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
            <div className="flex items-center gap-2 text-white">
              <BadgeAlert className="h-5 w-5 text-amber-200" />
              <h2 className="text-xl font-semibold">当前最需要关注的阻塞项</h2>
            </div>
            {topBlockers.length ? (
              <div className="mt-5 space-y-3">
                {topBlockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{blocker.title}</div>
                      <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                        {blocker.severity}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-slate-300">{blocker.detail}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{blocker.next_action}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                当前没有阻塞项，客户工作台已处于可推进状态。
              </div>
            )}
          </article>

          <article className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(245,158,11,0.12))] p-6">
            <div className="text-sm uppercase tracking-[0.24em] text-cyan-100/80">Design Principle</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">客户工作台应该让人更放心，而不是让人感觉自己走进了实验室后台。</h2>
            <p className="mt-4 text-sm leading-8 text-slate-100/90">
              所以这里强调的是边界清晰、结果清晰、审批清晰、收益清晰。客户需要知道龙虾池在替他们稳定运行什么，
              而不需要理解所有内部 AI 节点如何协商。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/operations/autopilot/trace" className="rounded-2xl bg-white px-5 py-3 font-medium text-slate-950">
                查看 Trace
              </Link>
              <Link href="/operations/autopilot/alerts" className="rounded-2xl border border-white/15 bg-slate-950/30 px-5 py-3 font-medium text-white">
                查看告警看板
              </Link>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

function KpiCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{detail}</div>
    </div>
  );
}

function DomainStatusCard({
  title,
  value,
  detail,
  ok,
}: {
  title: string;
  value: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${statusTone(ok)}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] opacity-80">{title}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      <div className="mt-2 text-sm leading-6 opacity-85">{detail}</div>
    </div>
  );
}
