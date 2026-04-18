import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="max-w-xl rounded-[32px] border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/30">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">OpenClaw Console</div>
        <h1 className="mt-4 text-4xl font-semibold text-white">页面没有找到</h1>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          这个入口可能已经迁移，或者当前租户还没有开启对应模块。你可以回到总控台继续排查链路。
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
        >
          回到总控台
        </Link>
      </section>
    </main>
  );
}
