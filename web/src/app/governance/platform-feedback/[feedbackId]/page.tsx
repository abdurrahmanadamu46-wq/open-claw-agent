'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SurfaceHero, SurfacePill, SurfaceSection, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { fetchPlatformFeedbackCandidateDetail } from '@/services/endpoints/tenant-cockpit';

export default function PlatformFeedbackDetailPage() {
  const params = useParams<{ feedbackId: string }>();
  const { currentTenantId } = useTenant();
  const feedbackId = String(params?.feedbackId || '');
  const tenantId = currentTenantId || 'tenant_demo';

  const detailQuery = useQuery({
    queryKey: ['governance', 'platform-feedback', 'detail', tenantId, feedbackId],
    queryFn: () => fetchPlatformFeedbackCandidateDetail(feedbackId, tenantId),
    enabled: Boolean(feedbackId),
    retry: false,
    staleTime: 60 * 1000,
  });

  if (detailQuery.isLoading) {
    return <div className="p-6"><SurfaceStateCard kind="loading" title="正在加载平台反馈详情" description="把 abstracted insight、evidence、violations 和 metadata 完整展开。" /></div>;
  }

  if (detailQuery.isError || !detailQuery.data?.item) {
    return <div className="p-6"><SurfaceStateCard kind="error" title="平台反馈详情加载失败" description="请检查 feedbackId 是否存在，或确认 tenant scope 是否正确。" /></div>;
  }

  const item = detailQuery.data.item;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Platform Feedback Detail"
        title={item.title}
        description="详情页直接展示平台层知识候选的抽象结论、证据、违规项和 metadata，不再让 operator 只能停在列表预览里。"
        aside={
          <>
            <SurfacePill label="eligible" value={item.eligible_for_platform ? 'yes' : 'no'} tone={item.eligible_for_platform ? 'ok' : 'warn'} />
            <SurfacePill label="review" value={item.requires_review ? 'required' : 'optional'} tone={item.requires_review ? 'warn' : 'neutral'} />
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfacePill label="source lobster" value={item.source_lobster} />
        <SurfacePill label="industry tag" value={item.industry_tag} />
        <SurfacePill label="source layer" value={item.source_layer} />
        <SurfacePill label="target layer" value={item.target_layer} />
      </section>

      <SurfaceSection title="抽象 insight" description="这是准备进入平台知识层的候选结论。">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-slate-200">
          {item.abstracted_insight}
        </div>
      </SurfaceSection>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <SurfaceSection title="Evidence" description="原始证据保留为 schema 原样结构，方便后续审阅。">
          <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
            {JSON.stringify(item.evidence, null, 2)}
          </pre>
        </SurfaceSection>

        <SurfaceSection title="Metadata / Violations" description="同时看 metadata 和违规项，判断是否适合进入平台层。">
          <div className="space-y-4">
            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
              {JSON.stringify(item.metadata, null, 2)}
            </pre>
            <div className="space-y-2">
              {item.violations.length > 0 ? (
                item.violations.map((violation) => (
                  <div key={`${item.feedback_id}-${violation}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    {violation}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  当前没有 violations。
                </div>
              )}
            </div>
          </div>
        </SurfaceSection>
      </div>
    </div>
  );
}
