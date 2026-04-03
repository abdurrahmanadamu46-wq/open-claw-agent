import Link from 'next/link';
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';

const faqs = [
  {
    question: '龙虾池到底是什么？',
    answer:
      '龙虾池是一套面向中国本地商家与服务机构的 AI 增长操作系统。它不是单点内容工具，也不是纯人工代运营，而是把内容、分发、线索、审批和复盘组织成系统。',
  },
  {
    question: '它和普通 AI 文案工具有什么区别？',
    answer:
      '普通工具更偏生成，龙虾池更偏执行系统。我们关心的不只是生成一段内容，而是这段内容怎么进入工作流、怎么被审批、怎么形成线索、怎么继续复盘。',
  },
  {
    question: '边缘节点会不会拿到策略脑？',
    answer:
      '不会。边缘节点只执行，不持有策略脑。策略、治理和审批逻辑保留在云端控制面，这也是系统稳定性和安全边界的重要前提。',
  },
  {
    question: '高风险动作会自动执行吗？',
    answer:
      '默认不会。高风险动作进入 HITL 人机协同审批链路，并且会保留 trace、审批记录和回滚证据，方便企业治理。',
  },
  {
    question: '可以在中国大陆部署吗？',
    answer:
      '可以。当前默认架构假设就是中国大陆优先部署和存储，优先使用 cn-shanghai 这类区域，满足本地化和备案准备需求。',
  },
  {
    question: '现在可以自助注册和试用吗？',
    answer:
      '可以。注册、登录、找回密码、试用开通、套餐页和账单控制台都已经接到前端主路径里。',
  },
  {
    question: '支付已经完全切真了吗？',
    answer:
      '前端商业化链路已经可用，但真实支付切真仍然依赖生产商户密钥、签约与正式结算验证。系统会在 readiness cockpit 中明确提示阻塞项。',
  },
  {
    question: '这套系统适合谁先用？',
    answer:
      '最适合那些已经有明确获客需求、希望把增长流程标准化、又不想继续依赖纯人工交接的本地商家、服务团队和行业服务商。',
  },
];

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_26%),radial-gradient(circle_at_80%_12%,rgba(34,211,238,0.14),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-6xl px-6 py-14">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <Sparkles className="h-4 w-4" />
            FAQ：把“是什么、怎么用、能不能上生产”讲清楚
          </div>
          <h1 className="mt-5 text-5xl font-semibold leading-tight text-white">常见问题</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300">
            这不是一页堆答案的 FAQ，而是帮助客户快速判断：龙虾池是不是适合现在这个阶段、它的边界在哪里、它离正式商业化还有哪些真实门槛。
          </p>
        </section>

        <section className="mt-8 grid gap-4">
          {faqs.map((item) => (
            <article key={item.question} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-300" />
                <div>
                  <h2 className="text-xl font-semibold text-white">{item.question}</h2>
                  <p className="mt-3 text-sm leading-8 text-slate-300">{item.answer}</p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(245,158,11,0.12))] p-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-cyan-100" />
            <div>
              <h2 className="text-2xl font-semibold text-white">还想继续核对合规和上线准备？</h2>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-slate-100/90">
                法务、隐私、服务协议和备案准备页已经单独整理。对于企业客户来说，这些信息和产品能力同样重要。
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/legal/privacy" className="rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950">
                  隐私政策
                </Link>
                <Link href="/legal/terms" className="rounded-2xl border border-white/15 bg-slate-950/30 px-4 py-2.5 text-sm font-medium text-white">
                  服务协议
                </Link>
                <Link href="/legal/icp-ready" className="rounded-2xl border border-white/15 bg-slate-950/30 px-4 py-2.5 text-sm font-medium text-white">
                  ICP 准备情况
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
