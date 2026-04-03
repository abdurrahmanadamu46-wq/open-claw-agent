import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Radar,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';

const heroSignals = [
  { label: '组织方式', value: '9 个岗位龙虾 + 元老院总脑' },
  { label: '执行边界', value: '云脑决策，边缘只执行' },
  { label: '默认治理', value: '高风险动作默认进入 HITL 审批' },
];

const workflowSteps = [
  {
    title: '策略拆解',
    description: '总脑根据行业、目标和预算，把任务拆给不同岗位龙虾，而不是让一个通用 Agent 临场发挥。',
  },
  {
    title: '内容与知识调用',
    description: '策略、脚本、行业知识包、模板和历史 playbook 在同一条链路里协同工作。',
  },
  {
    title: '渠道与触点执行',
    description: '主脑在云端编排，边缘节点只拿到经过治理的执行指令，既稳定又可控。',
  },
  {
    title: '线索识别与跟进',
    description: '系统把响应、审批、跟进和回流串成闭环，而不是把结果散落在多个工具里。',
  },
  {
    title: '审计与复盘',
    description: '每次执行都能留下 trace、审批记录和回滚路径，方便持续优化和客户交付。',
  },
];

const productEdges = [
  {
    title: '不是内容工具',
    description: '龙虾池不只生成文案和视频，而是把内容、分发、线索和销售动作连成生产系统。',
  },
  {
    title: '不是人工代运营',
    description: '经验不会停留在某个运营个人身上，而会沉淀成行业知识、技能模块和治理策略。',
  },
  {
    title: '不是黑盒自动化',
    description: '高风险动作可审批、可审计、可回滚，企业可以清楚知道系统做了什么、为什么这么做。',
  },
];

const pricingPreview = [
  { name: 'Starter', highlight: '单店试点', price: '¥1,999 / 月', note: '适合先跑通一个租户的内容与线索闭环。' },
  { name: 'Pro', highlight: '团队扩张', price: '¥6,999 / 月', note: '适合服务团队、代运营团队和多门店协同。' },
  { name: 'Enterprise', highlight: '企业交付', price: '定制', note: '适合私有化、治理定制和多城市复制。' },
];

const proofBands = [
  '中国大陆优先部署与存储',
  '多租户隔离、审批与审计并行',
  '异步指挥入口，避免长链同步阻塞',
  '内容、策略、执行、复盘统一在一个控制面',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(34,211,238,0.18),transparent_24%),linear-gradient(180deg,rgba(10,15,28,0.96),rgba(7,17,31,1))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)]" />

      <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-red-500 text-sm font-semibold text-slate-950">
              LP
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.24em] text-amber-200">LOBSTER POOL</div>
              <div className="text-xs text-slate-400">AI 增长操作系统</div>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <Link href="/pricing" className="rounded-full px-4 py-2 transition hover:bg-white/8 hover:text-white">
              套餐
            </Link>
            <Link href="/faq" className="rounded-full px-4 py-2 transition hover:bg-white/8 hover:text-white">
              常见问题
            </Link>
            <Link href="/login" className="rounded-full border border-white/12 px-4 py-2 transition hover:border-cyan-400/40 hover:text-cyan-100">
              打开控制台
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 px-4 py-2 font-medium text-slate-950 shadow-lg shadow-amber-500/20"
            >
              立即试用
            </Link>
          </nav>
        </header>

        <section className="grid gap-10 pb-16 pt-14 lg:grid-cols-[1.15fr_0.95fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Sparkles className="h-4 w-4" />
              把商家增长从手工作坊升级成可复制生产系统
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] text-white md:text-6xl">
              更像一个有组织的增长团队，
              <br />
              而不是一个会聊天的 AI 工具。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              龙虾池把策略拆解、内容生产、渠道分发、线索识别、审批治理和复盘进化放进一套统一操作系统。
              对商家来说，它不是“多一个工具”，而是让增长开始稳定运转的基础设施。
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 px-5 py-3 font-medium text-slate-950 shadow-xl shadow-amber-500/20 transition hover:translate-y-[-1px]"
              >
                开始免费试用
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 font-medium text-white transition hover:bg-white/10"
              >
                查看商业化套餐
              </Link>
              <Link
                href="/client-center"
                className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 font-medium text-cyan-100 transition hover:bg-cyan-400/15"
              >
                预览客户工作台
              </Link>
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {heroSignals.map((signal) => (
                <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <div className="text-sm text-slate-400">{signal.label}</div>
                  <div className="mt-2 text-base font-semibold text-white">{signal.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#091524]/90 p-5 shadow-[0_28px_120px_-30px_rgba(8,145,178,0.55)] backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">实时指挥快照</div>
                <div className="mt-1 text-xl font-semibold text-white">今日增长运行快照</div>
              </div>
              <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                审批优先
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              <SignalRow icon={<Bot className="h-4 w-4" />} title="元老院总脑" value="生成行业策略并裁剪执行路径" />
              <SignalRow icon={<Radar className="h-4 w-4" />} title="研究雷达" value="发现同城增长信号并进入策略评审" />
              <SignalRow icon={<Waypoints className="h-4 w-4" />} title="任务编排图" value="编排内容、审批、分发、线索回流" />
              <SignalRow icon={<ShieldCheck className="h-4 w-4" />} title="治理内核" value="执行前校验风险、置信度和回滚预案" />
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>执行信号</span>
                <span className="text-emerald-200">证据已留痕</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MiniMetric label="当前模式" value="云脑 + 边缘执行" />
                <MiniMetric label="审批链路" value="HITL / 可审计 / 可回滚" />
                <MiniMetric label="记忆治理" value="岗位 / 任务 / 策略卡" />
                <MiniMetric label="商业状态" value="套餐 / 试用 / 账单 / 对账" />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 lg:grid-cols-4">
          {proofBands.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-4 text-sm text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{item}</span>
            </div>
          ))}
        </section>

        <section className="grid gap-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="text-sm uppercase tracking-[0.24em] text-amber-200/80">为什么是现在</div>
            <h2 className="mt-3 text-3xl font-semibold text-white">大多数本地商家真正缺的，不是更多工具，而是一套能对结果负责的生产系统。</h2>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-300">
              通用 AI 可以生成内容，却不擅长进业务流程；传统代运营能干活，却很难复制和规模化。
              龙虾池的价值在于，把“组织能力、知识能力、治理能力和执行能力”同时做成产品。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {productEdges.map((item) => (
              <article key={item.title} className="rounded-3xl border border-white/10 bg-[#0b182a] p-5">
                <div className="text-lg font-semibold text-white">{item.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="py-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">增长链路</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">从策略到线索，不再靠人盯着流程跑。</h2>
            </div>
            <Link href="/operations/strategy" className="text-sm font-medium text-cyan-200 underline-offset-4 hover:underline">
              查看策略工作台
            </Link>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <article key={step.title} className="rounded-3xl border border-white/10 bg-[#0b182a] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-amber-200/80">步骤 {index + 1}</div>
                <div className="mt-3 text-lg font-semibold text-white">{step.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-amber-200/80">商业化套餐</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">先让试点跑起来，再把知识包和行业复制速度放大。</h2>
            </div>
            <Link href="/pricing" className="text-sm font-medium text-cyan-200 underline-offset-4 hover:underline">
              查看完整套餐说明
            </Link>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {pricingPreview.map((plan) => (
              <article key={plan.name} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  {plan.highlight}
                </div>
                <div className="mt-4 text-2xl font-semibold text-white">{plan.name}</div>
                <div className="mt-2 text-3xl font-semibold text-amber-200">{plan.price}</div>
                <p className="mt-4 text-sm leading-7 text-slate-300">{plan.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(8,145,178,0.12))] p-8 md:p-10">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-amber-100/80">准备上线</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">如果你要的不是“写几篇内容”，而是把增长真正跑成系统，龙虾池就是那个操作面。</h2>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-200/90">
                先用 Starter 或 Pro 跑通业务闭环，再根据行业复制、审批治理和私有部署需求逐步扩大。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className="rounded-2xl bg-white px-5 py-3 font-medium text-slate-950 transition hover:translate-y-[-1px]">
                注册并试用
              </Link>
              <Link href="/pricing" className="rounded-2xl border border-white/15 bg-slate-950/30 px-5 py-3 font-medium text-white transition hover:bg-slate-950/50">
                看套餐细节
              </Link>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 py-10 text-sm text-slate-400">
          <div>龙虾池 Lobster Pool · 更智能、更稳定、可治理、可规模化的增长操作系统</div>
          <div className="flex flex-wrap gap-4">
            <Link href="/faq" className="hover:text-white">FAQ</Link>
            <Link href="/legal/privacy" className="hover:text-white">隐私政策</Link>
            <Link href="/legal/terms" className="hover:text-white">服务协议</Link>
            <Link href="/legal/icp-ready" className="hover:text-white">ICP备案准备</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SignalRow({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-1 text-sm leading-6 text-slate-300">{value}</div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/30 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-100">{value}</div>
    </div>
  );
}
