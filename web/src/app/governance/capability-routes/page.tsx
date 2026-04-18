'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Shield } from 'lucide-react';
import { SurfaceHero, SurfaceMetric, SurfaceSection, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { fetchCapabilityRoutes } from '@/services/endpoints/tenant-cockpit';

export default function CapabilityRoutesPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_demo';
  const routesQuery = useQuery({
    queryKey: ['governance', 'capability-routes', tenantId],
    queryFn: () => fetchCapabilityRoutes({ tenant_id: tenantId, limit: 50 }),
    retry: false,
    staleTime: 60 * 1000,
  });

  if (routesQuery.isLoading) {
    return <div className="p-6"><SurfaceStateCard kind="loading" title="正在加载能力路由预览" description="把 capability_routes_preview 从 cockpit 摊平成可点击列表。" /></div>;
  }

  if (routesQuery.isError || !routesQuery.data) {
    return <div className="p-6"><SurfaceStateCard kind="error" title="能力路由预览加载失败" description="后端已验证过 record/list/get capability route，前端现在直接走这套 schema。" /></div>;
  }

  const result = routesQuery.data;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Governance / Capability Routes"
        title="把 capability_routes_preview 做成可读、可点开的治理列表"
        description="这里展示的不是普通日志，而是主管能力路由决策快照。列表页先给 operator 判断方向，详情页再看 capability_plan 和 reasons。"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SurfaceMetric label="总记录" value={String(result.total)} helper="当前 tenant 下的 capability route 审计数" icon={<Shield className="h-4 w-4" />} />
        <SurfaceMetric label="租户" value={result.tenant_id} helper="按 tenant scope 拉取" />
        <SurfaceMetric label="当前页目的" value="列表 -> 详情" helper="先预览，再下钻 capability plan" />
      </section>

      <SurfaceSection title="能力路由列表" description="先看 workflow、goal、lobster sequence 和 reasons，再决定是否进入详情。">
        <div className="space-y-3">
          {result.items.map((item) => (
            <Link
              key={item.audit_id}
              href={`/governance/capability-routes/${encodeURIComponent(item.audit_id)}`}
              className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-400/25 hover:bg-white/[0.05]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{item.goal}</div>
                  <div className="mt-1 text-xs text-slate-400">{item.workflow_id} · {item.industry_tag || 'general'} · {item.created_at}</div>
                </div>
                <div className="inline-flex items-center gap-2 text-sm text-cyan-200">
                  详情
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.lobster_sequence.map((lobster) => (
                  <span key={`${item.audit_id}-${lobster}`} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                    {lobster}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-400">{item.reasons.slice(0, 2).join(' / ') || '暂无 reason'}</div>
            </Link>
          ))}
          {result.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-sm text-slate-400">
              当前没有 capability route 审计记录。
            </div>
          ) : null}
        </div>
      </SurfaceSection>
    </div>
  );
}
