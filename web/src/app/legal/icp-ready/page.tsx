import Link from 'next/link';

const checklist = [
  'legal entity certificates',
  'domain ownership and real-name verification',
  'privacy policy and terms page published',
  'contact and operator information confirmed',
  'ICP material pack generated from repository docs',
  'production payment contracts and merchant documents',
];

export default function IcpReadyPage() {
  return (
    <div className="min-h-screen bg-[#0F172A] px-6 py-14 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-4xl font-semibold">ICP Readiness</h1>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-sm text-slate-300">
          This page tracks what is already ready in the codebase and what still depends on offline legal or domain resources.
        </div>
        <div className="space-y-3">
          {checklist.map((item) => (
            <div key={item} className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm">
              {item}
            </div>
          ))}
        </div>
        <div className="text-sm text-slate-400">
          Generated material pack:
          {' '}
          <code className="rounded bg-slate-900 px-2 py-0.5 text-slate-200">tmp/icp_materials</code>
          {' · '}
          <Link href="/legal/privacy" className="underline">Privacy Policy</Link>
          {' · '}
          <Link href="/legal/terms" className="underline">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}
