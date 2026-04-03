'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Crown, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  activateBillingTrial,
  createBillingCheckout,
  fetchBillingPlans,
  type BillingPlanRow,
} from '@/services/endpoints/billing';
import { getCurrentUser } from '@/services/endpoints/user';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

type PlanConfig = {
  key: 'starter' | 'pro' | 'enterprise';
  title: string;
  subtitle: string;
  audience: string;
  badge: string;
  accent: string;
  bullets: string[];
  recommended?: boolean;
  action: { planCode: 'starter' | 'pro' | 'enterprise'; cycle: 'month' | 'year' };
};

const planConfigs: PlanConfig[] = [
  {
    key: 'starter',
    title: 'Starter',
    subtitle: '让单店或单团队先把增长闭环跑起来',
    audience: '适合单店试点、单租户验证、初始 SOP 搭建',
    badge: '单店试点',
    accent: 'from-slate-200/80 to-slate-400/40',
    bullets: [
      '1 个租户的基本增长工作台',
      '默认人机审批与审计留痕',
      '基础内容与线索闭环',
      '账单、用量与试用路径可见',
    ],
    action: { planCode: 'starter', cycle: 'month' },
  },
  {
    key: 'pro',
    title: 'Pro',
    subtitle: '让代理团队和多门店形成稳定复制能力',
    audience: '适合本地服务团队、连锁门店、行业复制',
    badge: '推荐方案',
    accent: 'from-amber-300 via-orange-400 to-amber-500',
    bullets: [
      '多工作流、多角色、多门店协同',
      '行业知识包、Starter Kit、策略回放',
      '边缘执行与客户工作台联动',
      '适合从试点走向标准交付',
    ],
    recommended: true,
    action: { planCode: 'pro', cycle: 'month' },
  },
  {
    key: 'enterprise',
    title: 'Enterprise',
    subtitle: '把龙虾池作为企业级增长基础设施部署',
    audience: '适合私有化、强治理、高审计、跨城市扩张',
    badge: '企业交付',
    accent: 'from-cyan-300/80 to-sky-500/40',
    bullets: [
      '大陆优先部署与私有化支持',
      '治理策略、审批流和回滚策略定制',
      '行业知识资产沉淀与组织级复制',
      '上线陪跑与交付支持',
    ],
    action: { planCode: 'enterprise', cycle: 'month' },
  },
];

const onboardingSteps = [
  '注册账户并激活试用，先用 Pro 试跑 14 天',
  '选择行业标签，加载 starter kit 与策略骨架',
  '接入审批与移动协同，确认高风险动作边界',
  '开始跑第一个增长闭环，再逐步放大行业复制速度',
];

export default function PricingPage() {
  const { data: currentUser } = useQuery({
    queryKey: ['pricing', 'current-user'],
    queryFn: getCurrentUser,
    retry: false,
  });
  const { data: plansData } = useQuery({
    queryKey: ['pricing', 'billing-plans'],
    queryFn: fetchBillingPlans,
    retry: false,
  });
  const [busyKey, setBusyKey] = useState('');

  const isLoggedIn = Boolean(currentUser?.id);
  const planTable = plansData?.plans ?? {};

  async function handleTrialActivate() {
    setBusyKey('trial');
    try {
      const result = await activateBillingTrial({ planCode: 'pro', durationDays: 14 });
      triggerSuccessToast(`试用已开通：${result.subscription.plan_code}`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '试用开通失败');
    } finally {
      setBusyKey('');
    }
  }

  async function handleCheckout(planCode: string, cycle: string, tierName: string) {
    setBusyKey(`checkout:${tierName}`);
    try {
      const result = await createBillingCheckout({
        planCode,
        cycle,
        returnUrl: `${window.location.origin}/settings/billing`,
      });
      triggerSuccessToast(`已创建订单：${result.order.order_id}`);
      window.open(result.checkout.checkout_url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '创建结账订单失败');
    } finally {
      setBusyKey('');
    }
  }

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_25%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.16),transparent_24%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-7xl px-6 py-14">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              商业化路径：先跑试点，再扩大知识包和交付规模
            </div>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.04] text-white">
              套餐不是为了卖功能堆栈，
              <br />
              而是为了让增长系统逐步进入真实经营。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              龙虾池的商业化逻辑是：先让一个业务闭环跑起来，再把审批、知识、执行和交付能力逐步做成标准化生产系统。
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {isLoggedIn ? (
                <>
                  <button
                    type="button"
                    disabled={busyKey === 'trial'}
                    onClick={() => void handleTrialActivate()}
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 px-5 py-3 font-medium text-slate-950 shadow-xl shadow-amber-500/20 disabled:opacity-50"
                  >
                    {busyKey === 'trial' ? '正在开通试用...' : '开通 14 天 Pro 试用'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <Link
                    href="/settings/billing"
                    className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 font-medium text-cyan-100"
                  >
                    打开账单控制台
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 px-5 py-3 font-medium text-slate-950 shadow-xl shadow-amber-500/20"
                  >
                    注册并开始试用
                  </Link>
                  <Link href="/login" className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 font-medium text-white">
                    登录后创建订单
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-amber-200/80">转化逻辑</div>
                <div className="mt-1 text-xl font-semibold text-white">客户不是先买功能，而是先验证可复制性。</div>
              </div>
              <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                支持试用与沙箱结算
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {onboardingSteps.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-sm font-semibold text-amber-200">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-7 text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-3">
          {planConfigs.map((plan) => {
            const pricing = resolvePricing(planTable[plan.key], plan.key);
            const isBusy = busyKey === `checkout:${plan.title}`;

            return (
              <article
                key={plan.title}
                className={`relative overflow-hidden rounded-[30px] border p-6 ${
                  plan.recommended
                    ? 'border-amber-300/30 bg-[linear-gradient(180deg,rgba(245,158,11,0.16),rgba(255,255,255,0.04))] shadow-[0_24px_90px_-40px_rgba(245,158,11,0.6)]'
                    : 'border-white/10 bg-white/[0.04]'
                }`}
              >
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-r ${plan.accent} opacity-15 blur-3xl`} />
                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                        {plan.badge}
                      </div>
                      <h2 className="mt-4 text-2xl font-semibold text-white">{plan.title}</h2>
                      <div className="mt-2 text-sm leading-7 text-slate-300">{plan.subtitle}</div>
                    </div>
                    {plan.recommended ? <Crown className="h-6 w-6 text-amber-200" /> : null}
                  </div>

                  <div className="mt-6">
                    <div className="text-4xl font-semibold text-white">{pricing.monthly}</div>
                    <div className="mt-2 text-sm text-slate-400">{plan.audience}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Yearly {pricing.yearly}</div>
                  </div>

                  <ul className="mt-6 space-y-3">
                    {plan.bullets.map((item) => (
                      <li key={item} className="flex gap-3 text-sm leading-7 text-slate-200">
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 flex flex-col gap-3">
                    {plan.key === 'pro' ? (
                      <button
                        type="button"
                        disabled={!isLoggedIn || busyKey === 'trial'}
                        onClick={() => void handleTrialActivate()}
                        className="rounded-2xl bg-white px-4 py-3 font-medium text-slate-950 disabled:opacity-50"
                      >
                        {busyKey === 'trial' ? '正在开通试用...' : '先开通 14 天试用'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={!isLoggedIn || isBusy}
                      onClick={() => void handleCheckout(plan.action.planCode, plan.action.cycle, plan.title)}
                      className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 font-medium text-cyan-100 disabled:opacity-50"
                    >
                      {isBusy ? '正在创建订单...' : `创建 ${plan.title} 订单`}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1fr_0.92fr]">
          <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-white">
              <ShieldCheck className="h-5 w-5 text-cyan-200" />
              <h2 className="text-xl font-semibold">为什么套餐设计成这样</h2>
            </div>
            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
              <p>
                龙虾池不是按“多几个 AI 功能”收费，而是按“让增长系统进入真实经营的深度”来收费。
                所以 Starter 解决的是试点，Pro 解决的是复制，Enterprise 解决的是治理和组织级部署。
              </p>
              <p>
                对客户来说，最合理的路径不是一开始就做大，而是先用试用和 sandbox checkout 跑通一个闭环，
                再把行业知识包、边缘执行和多角色协同逐步放大。
              </p>
            </div>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-slate-950/40 p-6">
            <div className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">商业化说明</div>
            <h2 className="mt-3 text-xl font-semibold text-white">当前前端已经打通的商业化链路</h2>
            <ul className="mt-5 space-y-3">
              {[
                '注册、登录、找回密码与重置密码',
                '开通试用、创建 sandbox checkout、查看账单',
                '商业化 readiness cockpit 与阻塞项展示',
                '套餐页与账单控制台之间的自助跳转',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-7 text-slate-300">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(34,211,238,0.12))] p-6">
          <div>
            <div className="text-sm uppercase tracking-[0.24em] text-amber-100/80">下一步</div>
            <div className="mt-2 text-2xl font-semibold text-white">先把第一个订单和第一个行业闭环跑起来，再谈规模化复制。</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/landing" className="rounded-2xl border border-white/15 bg-slate-950/30 px-5 py-3 font-medium text-white">
              回到首页
            </Link>
            <Link href="/settings/billing" className="rounded-2xl bg-white px-5 py-3 font-medium text-slate-950">
              打开账单中心
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function resolvePricing(plan: BillingPlanRow | undefined, key: PlanConfig['key']) {
  if (plan) {
    return {
      monthly: `¥${plan.price_month_cny.toLocaleString()} / 月`,
      yearly: `¥${plan.price_year_cny.toLocaleString()} / 年`,
    };
  }

  if (key === 'starter') {
    return { monthly: '¥1,999 / 月', yearly: '¥19,999 / 年' };
  }
  if (key === 'pro') {
    return { monthly: '¥6,999 / 月', yearly: '¥69,999 / 年' };
  }
  return { monthly: '定制报价', yearly: '按项目与部署范围定制' };
}
