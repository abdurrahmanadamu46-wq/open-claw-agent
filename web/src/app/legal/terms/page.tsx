import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

const sections = [
  {
    title: '1. 产品性质',
    body:
      '龙虾池提供的是一套可治理的 AI 增长操作系统，覆盖策略编排、知识调用、审批治理、执行路由和客户工作流，而不是“保证结果”的黑盒自动化。',
  },
  {
    title: '2. 客户责任',
    body:
      '客户仍需对其账户、渠道、内容、联系方式和业务合规性负责。平台不替代客户对真实业务行为的合法性判断。',
  },
  {
    title: '3. 自动化边界',
    body:
      '平台不承诺所有高风险动作都可全自动执行。涉及审批、外呼、敏感触点或高不确定性的场景，系统可能要求人工确认后再继续。',
  },
  {
    title: '4. 商业条款',
    body:
      '订阅套餐、用量限制、账单规则、服务范围以及交付边界，以客户购买的套餐或双方签署的商业协议为准。',
  },
  {
    title: '5. 风险控制与暂停权',
    body:
      '为保护平台和租户整体安全，龙虾池有权暂停存在明显风险、违规倾向或第三方供应商异常的工作流、适配器和自动化动作。',
  },
];

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_28%),radial-gradient(circle_at_78%_14%,rgba(34,211,238,0.12),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-5xl px-6 py-14">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <ShieldCheck className="h-4 w-4" />
            Product Boundary & Commercial Terms
          </div>
          <h1 className="mt-5 text-5xl font-semibold leading-tight text-white">服务协议</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300">
            这份协议页主要帮助客户理解龙虾池的产品边界、责任划分和商业约束。它强调的是“可治理的 AI 系统”，而不是不受约束的自动化承诺。
          </p>
        </section>

        <section className="mt-8 space-y-4">
          {sections.map((section) => (
            <article key={section.title} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-2xl font-semibold text-white">{section.title}</h2>
              <p className="mt-4 text-sm leading-8 text-slate-300">{section.body}</p>
            </article>
          ))}
        </section>

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link href="/legal/privacy" className="rounded-2xl bg-white px-4 py-2.5 font-medium text-slate-950">
            查看隐私政策
          </Link>
          <Link href="/faq" className="rounded-2xl border border-white/15 bg-slate-950/30 px-4 py-2.5 font-medium text-white">
            返回 FAQ
          </Link>
        </div>
      </div>
    </div>
  );
}
