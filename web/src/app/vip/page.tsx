'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { triggerSuccessToast } from '@/services/api';

const PLANS = [
  {
    id: 'free',
    name: '免费版',
    tag: '体验',
    price: '0',
    period: '永久',
    desc: '适合个人试跑、小规模验证',
    features: ['2 个并发任务', '每日 50 条线索', '3 个龙虾节点', '基础二创模板', '社区支持'],
    cta: '当前版本',
    highlight: false,
  },
  {
    id: 'pro',
    name: '专业版',
    tag: '推荐',
    price: '999',
    period: '月',
    desc: '适合中小团队、稳定获客',
    features: ['10 个并发任务', '每日 500 条线索', '10 个龙虾节点', '50+ 行业模板', '专属网络+指纹', '邮件支持'],
    cta: '立即升级',
    highlight: true,
  },
  {
    id: 'vip',
    name: 'VIP 企业版',
    tag: '旗舰',
    price: '面议',
    period: '年',
    desc: '适合品牌与大规模矩阵',
    features: ['不限并发任务', '不限线索量', '不限龙虾节点', '定制模板 + RAG', '专属客服', 'SLA 保障', '私有化可选'],
    cta: '联系销售',
    highlight: true,
  },
];

export default function VipPage() {
  const handleUpgrade = (planId: string) => {
    if (planId === 'free') return;
    if (planId === 'vip') {
      triggerSuccessToast('已提交意向，销售将尽快联系您');
      return;
    }
    triggerSuccessToast('即将跳转支付（演示）');
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--claw-rust)' }}>
          开通 VIP · 解锁全自动获客
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--claw-caramel)' }}>
          按需选择套餐，龙虾节点、线索量与模板全面升级
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-2xl border-2 p-6 shadow-lg transition hover:shadow-xl ${
              plan.highlight ? 'ring-2 ring-offset-2 ring-[var(--claw-gold)]' : ''
            }`}
            style={{
              borderColor: plan.highlight ? 'var(--claw-copper)' : 'var(--claw-card-border)',
              backgroundColor: plan.highlight ? 'var(--claw-gradient-soft)' : 'white',
            }}
          >
            {plan.tag && (
              <span
                className="absolute -top-2 right-4 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ background: 'var(--claw-gradient)' }}
              >
                {plan.tag}
              </span>
            )}
            <h2 className="text-lg font-semibold" style={{ color: 'var(--claw-rust)' }}>
              {plan.name}
            </h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ color: 'var(--claw-copper)' }}>
                ¥{plan.price}
              </span>
              <span className="text-sm" style={{ color: 'var(--claw-caramel)' }}>
                / {plan.period}
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--claw-caramel)' }}>
              {plan.desc}
            </p>
            <ul className="mt-4 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm" style={{ color: 'var(--claw-text-primary)' }}>
                  <span className="text-[var(--claw-gold)]">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {plan.id === 'free' ? (
                <span className="block rounded-lg border-2 py-2 text-center text-sm font-medium" style={{ borderColor: 'var(--claw-card-border)', color: 'var(--claw-caramel)' }}>
                  {plan.cta}
                </span>
              ) : (
                <Button
                  className="w-full"
                  variant="primary"
                  onClick={() => handleUpgrade(plan.id)}
                >
                  {plan.cta}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border-2 p-6 text-center" style={{ borderColor: 'var(--claw-card-border)', background: 'var(--claw-gradient-soft)' }}>
        <p className="text-sm" style={{ color: 'var(--claw-caramel)' }}>
          企业采购、私有化部署、定制开发请联系：
        </p>
        <p className="mt-1 font-medium" style={{ color: 'var(--claw-rust)' }}>
          sales@clawcommerce.com
        </p>
        <Link href="/onboard">
          <Button variant="ghost" className="mt-4">
            先体验配置向导
          </Button>
        </Link>
      </div>
    </div>
  );
}
