'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpenText, MessageSquare, Radio, Shield, Sparkles } from 'lucide-react';
import type { LobsterCapabilityProfile } from '@/lib/lobster-capability-tree';

function statusTone(status: string) {
  if (status === 'active') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'growing') return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
  return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
}

function statusLabel(status: string) {
  if (status === 'active') return '已启用';
  if (status === 'growing') return '建设中';
  return '规划中';
}

export function SupervisorCapabilityTree({
  profile,
  compact = false,
}: {
  profile: LobsterCapabilityProfile;
  compact?: boolean;
}) {
  const capabilityRoute = `/lobsters/${encodeURIComponent(profile.role.id)}/capabilities`;
  const detailRoute = `/lobsters/${encodeURIComponent(profile.role.id)}`;

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <Sparkles className="h-4 w-4" />
            主管能力树
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">{profile.role.zhName} 的主管能力树</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">{profile.mission}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {compact ? (
            <Link
              href={capabilityRoute}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/15"
            >
              展开完整能力树
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
          {!compact ? (
            <Link
              href={detailRoute}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2 text-sm text-white"
            >
              返回主管详情
            </Link>
          ) : null}
        </div>
      </div>

      <div className={`mt-5 grid gap-4 ${compact ? 'xl:grid-cols-[1fr_1fr]' : 'xl:grid-cols-[1.05fr_0.95fr]'}`}>
        <div>
          <div className="mb-3 text-sm font-semibold text-white">主管 -&gt; 细化岗位</div>
          {profile.manages.length > 0 ? (
            <div className="space-y-3">
              {profile.manages.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{item.summary}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
              当前还没有配置细化岗位节点。
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SurfaceCard title="知识面" icon={<BookOpenText className="h-4 w-4" />} items={profile.knowledgeSurfaces} />
          <SurfaceCard title="执行面" icon={<Radio className="h-4 w-4" />} items={profile.executionSurfaces} />
          <SurfaceCard title="协作面" icon={<MessageSquare className="h-4 w-4" />} items={profile.collaborationSurfaces} />
          <SurfaceCard title="治理面" icon={<Shield className="h-4 w-4" />} items={profile.governanceSurfaces} />
        </div>
      </div>
    </section>
  );
}

function SurfaceCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <span key={`${title}-${item}`} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
              {item}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">当前暂无配置</span>
        )}
      </div>
    </div>
  );
}
