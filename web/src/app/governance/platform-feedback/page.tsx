'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Database } from 'lucide-react';
import { SurfaceHero, SurfaceMetric, SurfaceSection, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { useTenant } from '@/contexts/TenantContext';
import { fetchPlatformFeedbackCandidates } from '@/services/endpoints/tenant-cockpit';

export default function PlatformFeedbackPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_demo';
  const feedbackQuery = useQuery({
    queryKey: ['governance', 'platform-feedback', tenantId],
    queryFn: () => fetchPlatformFeedbackCandidates({ tenant_id: tenantId, limit: 50 }),
    retry: false,
    staleTime: 60 * 1000,
  });

  if (feedbackQuery.isLoading) {
    return <div className="p-6"><SurfaceStateCard kind="loading" title="正在加载平台反馈预览" description="把 governance.platform_feedback_preview 摊平成可点击列表。" /></div>;
  }

  if (feedbackQuery.isError || !feedbackQuery.data) {
    return <div className="p-6"><SurfaceStateCard kind="error" title="平台反馈预览加载失败" description="后端 record/list/get platform feedback 已验证正常，前端现在直接消费这套 schema。" /></div>;
  }

  const result = feedbackQuery.data;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Governance / Platform Feedback"
        title="把 platform_feedback_preview 做成可筛、可点开的反馈候选列表"
        description="平台反馈预览不是一段摘要，而是平台层知识沉淀候选。列表页负责先做筛面，详情页再看 insight、evidence、violations 和 metadata。"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SurfaceMetric label="总候选数" value={String(result.total)} helper="当前 tenant 下可见的反馈候选" icon={<Database className="h-4 w-4" />} />
        <SurfaceMetric label="tenant" value={result.tenant_id} helper="tenant scoped" />
        <SurfaceMetric label="当前目的" value="列表 -> 详情" helper="先看是否 eligible，再下钻证据" />
      </section>

      <SurfaceSection title="平台反馈候选" description="先看 source / target layer、review 状态和平台可入库资格。">
        <div className="space-y-3">
          {result.items.map((item) => (
            <Link
              key={item.feedback_id}
              href={`/governance/platform-feedback/${encodeURIComponent(item.feedback_id)}`}
              className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-400/25 hover:bg-white/[0.05]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {item.source_lobster} · {item.source_layer} -&gt; {item.target_layer} · {item.industry_tag}
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 text-sm text-cyan-200">
                  详情
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3 text-sm leading-6 text-slate-300">{item.abstracted_insight}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <span key={`${item.feedback_id}-${tag}`} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                    {tag}
                  </span>
                ))}
                <span className={`rounded-full px-3 py-1 text-xs ${item.eligible_for_platform ? 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border border-amber-400/25 bg-amber-400/10 text-amber-200'}`}>
                  {item.eligible_for_platform ? '可入平台层' : '暂不入平台层'}
                </span>
              </div>
            </Link>
          ))}
          {result.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-sm text-slate-400">
              当前没有平台反馈候选。
            </div>
          ) : null}
        </div>
      </SurfaceSection>
    </div>
  );
}
