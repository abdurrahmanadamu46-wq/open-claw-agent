'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Boxes, Clock3, GitBranchPlus, Radar, ShieldCheck } from 'lucide-react';
import { triggerErrorToast } from '@/services/api';
import { previewPipelineMode } from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.4)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

export default function PipelineModesPage() {
  const [taskDescription, setTaskDescription] = useState('做一轮本地生活增长方案，只做策略和内容规划，不做外部执行');
  const [industryTag, setIndustryTag] = useState('local-services');
  const [competitorHandles, setCompetitorHandles] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePreview() {
    if (!taskDescription.trim()) {
      triggerErrorToast('请先填写任务描述');
      return;
    }
    setLoading(true);
    try {
      const data = await previewPipelineMode({
        task_description: taskDescription.trim(),
        industry_tag: industryTag.trim() || undefined,
        competitor_handles: competitorHandles
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        edge_targets: [],
      });
      setPreview(data.preview ?? null);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '模式预览失败');
    } finally {
      setLoading(false);
    }
  }

  const skippedNodes = Array.isArray(preview?.skipped_nodes) ? preview?.skipped_nodes : [];
  const selectedLineup = Array.isArray(preview?.selected_lineup) ? preview?.selected_lineup : [];
  const awakenedRoles = Array.isArray(preview?.awakened_roles) ? preview?.awakened_roles : [];
  const stagePath = Array.isArray(preview?.stage_path) ? preview?.stage_path : [];
  const reasons = Array.isArray(preview?.reasons) ? preview?.reasons : [];

  return (
    <div className="min-h-[calc(100vh-6rem)] p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-50">Pipeline Mode Preview</h1>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>
              在不真正跑任务的前提下，预览这次任务会走 `planning_only` 还是 `full_pipeline`，以及会唤醒哪些龙虾、跳过哪些节点。
            </p>
          </div>
          <Link href="/operations/autopilot" className="text-sm" style={{ color: GOLD }}>
            返回 Autopilot
          </Link>
        </div>

        <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <label className="space-y-2 text-sm text-slate-200">
              <span className="font-medium">任务描述</span>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                rows={5}
                className="w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                style={{ borderColor: BORDER }}
              />
            </label>
            <div className="space-y-4">
              <label className="space-y-2 text-sm text-slate-200">
                <span className="font-medium">行业标签</span>
                <input
                  value={industryTag}
                  onChange={(e) => setIndustryTag(e.target.value)}
                  className="w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="space-y-2 text-sm text-slate-200">
                <span className="font-medium">竞品句柄</span>
                <textarea
                  value={competitorHandles}
                  onChange={(e) => setCompetitorHandles(e.target.value)}
                  rows={4}
                  placeholder="每行一个，可留空"
                  className="w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading}
                className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-60"
                style={{ backgroundColor: GOLD }}
              >
                {loading ? '预览中...' : '生成模式预览'}
              </button>
            </div>
          </div>
        </section>

        {preview ? (
          <>
            <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
              <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Preview summary
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Mode" value={String(preview.mode || '-')} icon={<Boxes className="h-4 w-4" />} />
                <SummaryCard
                  label="Lineup"
                  value={`${selectedLineup.length}`}
                  detail={selectedLineup.map((item) => String(item)).join(', ') || '-'}
                  icon={<GitBranchPlus className="h-4 w-4" />}
                />
                <SummaryCard
                  label="Skipped"
                  value={`${skippedNodes.length}`}
                  detail={skippedNodes.map((item) => String(item)).join(', ') || '-'}
                  icon={<Radar className="h-4 w-4" />}
                />
                <SummaryCard
                  label="Industry"
                  value={String(preview.industry_tag || '-')}
                  detail={`competitors: ${String(preview.competitor_handle_count || 0)}`}
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Est. Duration"
                  value={`${String(preview.estimated_duration_sec || '-')}s`}
                  detail={`band ${String((preview.estimated_duration_band_sec as Record<string, unknown> | undefined)?.low ?? '-')}-${String((preview.estimated_duration_band_sec as Record<string, unknown> | undefined)?.high ?? '-') }s`}
                  icon={<Clock3 className="h-4 w-4" />}
                />
                <SummaryCard
                  label="Approval"
                  value={Boolean(preview.approval_likely) ? 'Likely' : 'Not likely'}
                  detail={`submit via ${String(preview.recommended_submit_path || '-')}`}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
                <SummaryCard
                  label="Artifacts"
                  value={`${String(preview.estimated_artifact_count || 0)}`}
                  detail={`cost tier ${String(preview.estimated_cost_tier || '-')}`}
                />
                <SummaryCard
                  label="Awakened"
                  value={`${awakenedRoles.length}`}
                  detail={awakenedRoles.map((item) => String(item)).join(', ') || '-'}
                />
              </div>
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
                {String(preview.description || '-')}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
                <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                  Selected lineup
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedLineup.map((item) => (
                    <span key={String(item)} className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">
                      {String(item)}
                    </span>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
                <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                  Stage path
                </div>
                <div className="space-y-2">
                  {stagePath.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">
                      {index + 1}. {String(item)}
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
              <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Why this mode
              </div>
              <div className="space-y-2">
                {reasons.map((item, index) => (
                  <div key={index} className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    {String(item)}
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]" style={{ color: MUTED }}>
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-100 break-all">{value}</div>
      {detail ? (
        <div className="mt-2 text-xs" style={{ color: MUTED }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}
