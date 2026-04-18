'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SurfaceHero, SurfacePill, SurfaceSection, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { fetchCapabilityRouteDetail } from '@/services/endpoints/tenant-cockpit';

export default function CapabilityRouteDetailPage() {
  const params = useParams<{ auditId: string }>();
  const { currentTenantId } = useTenant();
  const auditId = String(params?.auditId || '');
  const tenantId = currentTenantId || 'tenant_demo';

  const detailQuery = useQuery({
    queryKey: ['governance', 'capability-routes', 'detail', tenantId, auditId],
    queryFn: () => fetchCapabilityRouteDetail(auditId, tenantId),
    enabled: Boolean(auditId),
    retry: false,
    staleTime: 60 * 1000,
  });

  if (detailQuery.isLoading) {
    return <div className="p-6"><SurfaceStateCard kind="loading" title="正在加载 capability route 详情" description="把 capability_plan 和 reasons 直接展开给 operator 看。" /></div>;
  }

  if (detailQuery.isError || !detailQuery.data?.item) {
    return <div className="p-6"><SurfaceStateCard kind="error" title="capability route 详情加载失败" description="请检查 auditId 是否存在，或确认 tenant scope 是否正确。" /></div>;
  }

  const item = detailQuery.data.item;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Capability Route Detail"
        title={item.goal}
        description="详情页不再只看一条字符串，而是把 capability_plan、lobster sequence 和 reasons 整体拉平，方便验证主管能力编排是否符合预期。"
        aside={
          <>
            <SurfacePill label="workflow" value={item.workflow_id} />
            <SurfacePill label="industry" value={item.industry_tag || 'general'} />
          </>
        }
      />

      <SurfaceSection title="主管能力路由顺序" description="这条链决定了主管龙虾如何按顺序接力。">
        <div className="flex flex-wrap gap-2">
          {item.lobster_sequence.map((lobster) => (
            <span key={`${item.audit_id}-${lobster}`} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-slate-200">
              {lobster}
            </span>
          ))}
        </div>
      </SurfaceSection>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <SurfaceSection title="Capability Plan" description="直接展示每个主管被分配到的 capability plan。">
          <div className="space-y-3">
            {Object.entries(item.capability_plan || {}).map(([lobster, plans]) => (
              <div key={`${item.audit_id}-${lobster}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">{lobster}</div>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                  {JSON.stringify(plans, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </SurfaceSection>

        <SurfaceSection title="Reasons" description="把路由原因从 schema 原样呈现，方便核对 explainability。">
          <div className="space-y-3">
            {item.reasons.map((reason, index) => (
              <div key={`${item.audit_id}-reason-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                {reason}
              </div>
            ))}
          </div>
        </SurfaceSection>
      </div>
    </div>
  );
}
