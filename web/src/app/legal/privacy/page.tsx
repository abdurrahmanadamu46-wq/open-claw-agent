import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

const sections = [
  {
    title: '1. 数据驻留与本地化',
    body:
      '龙虾池按中国大陆优先部署原则设计。正式生产环境应优先使用中国大陆区域的计算、存储和网络资源，并把数据本地化要求作为默认前提。',
  },
  {
    title: '2. 多租户隔离',
    body:
      '租户数据、知识资产、账单数据、审批记录和审计证据应在逻辑上隔离。任何租户之间的数据都不应混用、混查或混写。',
  },
  {
    title: '3. 审批、审计与回滚',
    body:
      '高风险动作默认进入人机协同审批。系统保留 trace、审批记录、关键操作日志和回滚证据，用于治理、追责和问题复盘。',
  },
  {
    title: '4. 边缘执行边界',
    body:
      '边缘节点只负责执行，不持有策略脑。敏感策略、治理和决策逻辑保持在云端控制面，以减少泄漏风险和错误放大。',
  },
  {
    title: '5. 对外主体与联系信息',
    body:
      '在正式上线前，应使用真实主体信息、客服联系方式、备案信息和运营联系人替换当前占位字段。',
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_78%_14%,rgba(245,158,11,0.12),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-5xl px-6 py-14">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <ShieldCheck className="h-4 w-4" />
            Privacy & Data Governance
          </div>
          <h1 className="mt-5 text-5xl font-semibold leading-tight text-white">隐私政策</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300">
            这份页面不是最终法务定稿，而是面向 ICP、企业客户采购和部署交付的上线前版本。它的目标是清晰说明龙虾池的数据边界、租户隔离与治理原则。
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
          <Link href="/legal/terms" className="rounded-2xl bg-white px-4 py-2.5 font-medium text-slate-950">
            查看服务协议
          </Link>
          <Link href="/legal/icp-ready" className="rounded-2xl border border-white/15 bg-slate-950/30 px-4 py-2.5 font-medium text-white">
            查看 ICP 准备情况
          </Link>
        </div>
      </div>
    </div>
  );
}
