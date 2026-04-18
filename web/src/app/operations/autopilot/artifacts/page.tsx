'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { ArtifactRenderer, extractArtifactRenderableContent } from '@/components/ArtifactRenderer';
import {
  type ArtifactJobResponse,
  type ArtifactIndexRow,
  type ArtifactMissionJobRow,
  type ArtifactMissionResponse,
  type ArtifactRecentJobRow,
  fetchArtifactsIndex,
  fetchArtifactsByJob,
  fetchArtifactsByMission,
  type ArtifactEnvelope,
  type IndustryKnowledgePackReadiness,
  type PipelineExplainSummary,
} from '@/services/endpoints/ai-subservice';

const BORDER = 'rgba(71,85,105,0.4)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

const ARTIFACT_KEYS = [
  'mission_plan_artifact',
  'signal_brief_artifact',
  'strategy_route_artifact',
  'copy_pack_artifact',
  'storyboard_pack_artifact',
  'execution_plan_artifact',
  'lead_assessment_artifact',
  'value_score_card_artifact',
  'followup_action_plan_artifact',
] as const;

const STAGE_ORDER = [
  'MissionPlan',
  'SignalBrief',
  'StrategyRoute',
  'CopyPack',
  'StoryboardPack',
  'ExecutionPlan',
  'LeadAssessment',
  'ValueScoreCard',
  'FollowUpActionPlan',
] as const;

type ArtifactCenterData = Partial<ArtifactJobResponse & ArtifactMissionResponse>;

export default function ArtifactCenterPage() {
  return (
    <Suspense fallback={<ArtifactCenterFallback />}>
      <ArtifactCenterPageInner />
    </Suspense>
  );
}

function ArtifactCenterPageInner() {
  const searchParams = useSearchParams();
  const [jobIdInput, setJobIdInput] = useState(searchParams?.get('job_id') || '');
  const [activeJobId, setActiveJobId] = useState(searchParams?.get('job_id') || '');
  const [missionIdInput, setMissionIdInput] = useState(searchParams?.get('mission_id') || '');
  const [activeMissionId, setActiveMissionId] = useState(searchParams?.get('mission_id') || '');

  const jobQuery = useQuery({
    queryKey: ['artifact-center', 'job', activeJobId],
    queryFn: () => fetchArtifactsByJob(activeJobId),
    enabled: activeJobId.trim().length > 0,
    refetchInterval: 5000,
  });

  const missionQuery = useQuery({
    queryKey: ['artifact-center', 'mission', activeMissionId],
    queryFn: () => fetchArtifactsByMission(activeMissionId),
    enabled: activeMissionId.trim().length > 0,
    refetchInterval: 5000,
  });

  const indexQuery = useQuery({
    queryKey: ['artifact-center', 'index'],
    queryFn: () => fetchArtifactsIndex(20),
    refetchInterval: 10000,
  });

  const activeData = (missionQuery.data || jobQuery.data || null) as ArtifactCenterData | null;

  const artifacts = useMemo(() => {
    const artifactMap = activeData?.artifacts || {};
    return ARTIFACT_KEYS.map((key) => ({
      key,
      artifact: artifactMap[key] as ArtifactEnvelope | undefined,
    })).filter((item) => item.artifact && typeof item.artifact === 'object');
  }, [activeData]);

  const orderedStages = useMemo(() => {
    const items = activeData?.artifact_index || [];
    return [...items].sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(String(a.artifact_type || '') as (typeof STAGE_ORDER)[number]);
      const bi = STAGE_ORDER.indexOf(String(b.artifact_type || '') as (typeof STAGE_ORDER)[number]);
      const av = ai >= 0 ? ai : 999;
      const bv = bi >= 0 ? bi : 999;
      return av - bv;
    });
  }, [activeData]);

  const missionSummary = useMemo(() => {
    if (!activeData?.artifact_index?.length) return null;
    const items = orderedStages;
    const riskRank: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
    const highestRisk = items.reduce<ArtifactIndexRow | null>((prev, item) => {
      if (!prev) return item;
      const prevRank = riskRank[String(prev.risk_level || 'L0')] ?? 0;
      const nextRank = riskRank[String(item.risk_level || 'L0')] ?? 0;
      return nextRank > prevRank ? item : prev;
    }, null);
    const finalStage = items[items.length - 1];
    const completedCount = items.filter((item) => String(item.status || '').toLowerCase() === 'final').length;
    const progressRatio = items.length ? Math.round((completedCount / items.length) * 100) : 0;
    return {
      stageCount: items.length,
      progressRatio,
      highestRisk,
      finalStage,
      missionId: activeData.mission_id || '-',
      pipelineMode: String(activeData.pipeline_mode || 'unknown'),
      pipelineExplain: activeData.pipeline_explain || {},
      nextAction: String(finalStage?.next_action || '-'),
    };
  }, [activeData, orderedStages]);
  const industryKnowledgePacks = (activeData?.industry_knowledge_packs || {}) as IndustryKnowledgePackReadiness;
  const rolePackRows = useMemo(() => {
    const rolePacks = industryKnowledgePacks.role_packs ?? {};
    return Object.entries(rolePacks).map(([roleId, row]) => {
      const packs = row?.packs ?? {};
      const packCount = Object.keys(packs).length;
      const itemCount = Object.values(packs).reduce((sum, pack) => sum + Number(pack?.item_count ?? 0), 0);
      const caseCount = Object.values(packs).reduce((sum, pack) => sum + Number(pack?.case_count ?? 0), 0);
      return {
        roleId,
        ready: Boolean(row?.ready),
        path: String(row?.path ?? ''),
        packCount,
        itemCount,
        caseCount,
      };
    });
  }, [industryKnowledgePacks.role_packs]);
  const rolePackMap = useMemo(() => {
    const rolePacks = industryKnowledgePacks.role_packs ?? {};
    return rolePacks;
  }, [industryKnowledgePacks.role_packs]);

  function loadJob() {
    setActiveJobId(jobIdInput.trim());
    setActiveMissionId('');
  }

  function loadMission() {
    setActiveMissionId(missionIdInput.trim());
    setActiveJobId('');
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-50">Artifact Center</h1>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>
              查看 Commander 与 9 个元老在一次任务中的标准工件，以及 mission 级聚合结果。
            </p>
          </div>
          <Link href="/operations/autopilot" className="text-sm" style={{ color: GOLD }}>
            返回 Autopilot
          </Link>
        </div>

        <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
            <Boxes className="h-4 w-4" />
            Load artifacts
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <input
                value={jobIdInput}
                onChange={(e) => setJobIdInput(e.target.value)}
                placeholder="粘贴 async job id"
                className="min-w-[220px] flex-1 rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                style={{ borderColor: BORDER }}
              />
              <button
                type="button"
                onClick={loadJob}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-900"
                style={{ backgroundColor: GOLD }}
              >
                按 Job 加载
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={missionIdInput}
                onChange={(e) => setMissionIdInput(e.target.value)}
                placeholder="粘贴 mission id / trace id"
                className="min-w-[220px] flex-1 rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100"
                style={{ borderColor: BORDER }}
              />
              <button
                type="button"
                onClick={loadMission}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-900"
                style={{ backgroundColor: GOLD }}
              >
                按 Mission 加载
              </button>
            </div>
          </div>
          {activeData ? (
            <div className="mt-3 text-xs" style={{ color: MUTED }}>
              job_id: {activeData.job_id || '-'} | mission_id: {activeData.mission_id || '-'} | mode: {String(activeData.pipeline_mode || '-')} | artifacts: {activeData.artifact_count ?? 0}
            </div>
          ) : null}
        </section>

        {missionQuery.data?.jobs?.length ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Mission jobs
            </div>
            <div className="space-y-2">
                {missionQuery.data.jobs.map((job) => (
                <div key={String(job.job_id || '')} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <div>job_id: {String(job.job_id || '-')}</div>
                  <div className="mt-1">status: {String(job.status || '-')}</div>
                  <div className="mt-1">mode: {String(job.pipeline_mode || '-')}</div>
                  <div className="mt-1">updated_at: {String(job.updated_at || '-')}</div>
                  <div className="mt-1">artifact_count: {String(job.artifact_count || 0)}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {missionSummary ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Mission summary
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Mission" value={String(missionSummary.missionId)} />
              <SummaryCard label="Mode" value={missionSummary.pipelineMode} />
              <SummaryCard label="Stages" value={`${missionSummary.stageCount}`} detail={`完成度 ${missionSummary.progressRatio}%`} />
              <SummaryCard
                label="Highest Risk"
                value={String(missionSummary.highestRisk?.risk_level || '-')}
                detail={String(missionSummary.highestRisk?.artifact_type || '-')}
              />
              <SummaryCard
                label="Next Action"
                value={missionSummary.nextAction}
                detail={String(missionSummary.finalStage?.artifact_type || '-')}
              />
            </div>
            {Array.isArray(missionSummary.pipelineExplain?.skipped_nodes) && missionSummary.pipelineExplain.skipped_nodes.length ? (
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-4 text-xs text-slate-300">
                <div className="text-slate-100 font-medium">Mode explain</div>
                <div className="mt-2">description: {String(missionSummary.pipelineExplain?.description || '-')}</div>
                <div className="mt-2">skipped_nodes: {missionSummary.pipelineExplain.skipped_nodes.map((item) => String(item)).join(', ')}</div>
                <div className="mt-2">
                  reasons:{' '}
                  {Array.isArray(missionSummary.pipelineExplain?.reasons) && missionSummary.pipelineExplain.reasons.length
                    ? missionSummary.pipelineExplain.reasons.map((item) => String(item)).join(' | ')
                    : '-'}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeData?.industry_knowledge_packs ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Industry knowledge packs
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Matched Industry" value={String(industryKnowledgePacks.matched_industry || '-')} />
              <SummaryCard label="Lobsters" value={`${Number(industryKnowledgePacks.roles_ready ?? 0)}/${Number(industryKnowledgePacks.roles_total ?? 9)}`} />
              <SummaryCard label="Files" value={`${Number(industryKnowledgePacks.files_ready ?? 0)}/${Number(industryKnowledgePacks.files_expected ?? 36)}`} />
              <SummaryCard
                label="Status"
                value={industryKnowledgePacks.ok ? 'Ready' : 'Need attention'}
                detail={Array.isArray(industryKnowledgePacks.missing) ? `缺口 ${industryKnowledgePacks.missing.length}` : '-'}
              />
            </div>
            {rolePackRows.length ? (
              <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-700 bg-slate-950/60">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-950/95 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Ready</th>
                      <th className="px-3 py-2 font-medium">Packs</th>
                      <th className="px-3 py-2 font-medium">Items/Cases</th>
                      <th className="px-3 py-2 font-medium">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolePackRows.map((row) => (
                      <tr key={row.roleId} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-2 font-medium text-slate-100">{row.roleId}</td>
                        <td className="px-3 py-2">{row.ready ? 'ready' : 'missing'}</td>
                        <td className="px-3 py-2">{row.packCount}</td>
                        <td className="px-3 py-2">{row.itemCount}/{row.caseCount}</td>
                        <td className="max-w-[240px] truncate px-3 py-2 text-slate-400" title={row.path}>{row.path || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {!activeData && indexQuery.data?.items?.length ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Recent jobs
            </div>
            <div className="grid gap-3">
              {indexQuery.data.items.map((item) => {
                const jobId = String(item.job_id || '');
                const missionId = String(item.mission_id || '');
                return (
                  <button
                    key={jobId}
                    type="button"
                    onClick={() => {
                      setJobIdInput(jobId);
                      setActiveJobId(jobId);
                      setMissionIdInput(missionId);
                      setActiveMissionId('');
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/5"
                  >
                    <div className="font-medium text-slate-100">{String(item.task_description || jobId || 'Untitled mission')}</div>
                    <div className="mt-1 text-xs" style={{ color: MUTED }}>
                      job_id: {jobId} | mission_id: {missionId || '-'} | mode: {String(item.pipeline_mode || '-')} | status: {String(item.status || '-')} | artifacts:{' '}
                      {String(item.artifact_count || 0)}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeData?.artifact_index?.length ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Stage sequence
            </div>
            <div className="flex flex-wrap gap-2">
              {orderedStages.map((item, index) => (
                <div key={String(item.key || item.artifact_id || index)} className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">
                  <span className="font-medium text-slate-100">{index + 1}. {String(item.artifact_type || '-')}</span>
                  <span className="ml-2 text-slate-400">[{String(item.role_id || '-')} / {String(item.status || '-')} / {String(item.risk_level || '-')} ]</span>
                  <span className="ml-2 text-slate-500">→ {String(item.next_action || '-')}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeData?.artifact_index?.length ? (
          <section className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
              Artifact dependency map
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {activeData.artifact_index.map((item) => (
                <div key={String(item.key || item.artifact_id || '')} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <div className="font-medium text-slate-100">
                    {String(item.artifact_type || '-')} | {String(item.role_id || '-')}
                  </div>
                  <div className="mt-1">artifact_id: {String(item.artifact_id || '-')}</div>
                  <div className="mt-1">status: {String(item.status || '-')}</div>
                  <div className="mt-1">risk_level: {String(item.risk_level || '-')}</div>
                  <div className="mt-1">dependencies: {Array.isArray(item.dependencies) && item.dependencies.length ? item.dependencies.map((x) => String(x)).join(', ') : '-'}</div>
                  <div className="mt-1">next_action: {String(item.next_action || '-')}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4">
          {artifacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              当前没有可展示的 artifact。先提交 async mission，再按 job_id 或 mission_id 加载。
            </div>
          ) : (
            artifacts.map(({ key, artifact }) => (
              <details key={key} className="rounded-xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-100">
                  {artifact?.artifact_type || key} | {artifact?.produced_by?.role_id || '-'}
                </summary>
                {(() => {
                  const roleId = String(artifact?.produced_by?.role_id || '');
                  const rolePack = rolePackMap[roleId];
                  const packs = rolePack?.packs ?? {};
                  const packCount = Object.keys(packs).length;
                  const itemCount = Object.values(packs).reduce((sum, pack) => sum + Number(pack?.item_count ?? 0), 0);
                  const caseCount = Object.values(packs).reduce((sum, pack) => sum + Number(pack?.case_count ?? 0), 0);
                  return roleId ? (
                    <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-xs text-emerald-100">
                      <div className="font-medium text-emerald-50">Artifact industry knowledge support</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-4">
                        <SummaryCard label="Role" value={roleId} />
                        <SummaryCard label="Ready" value={rolePack?.ready ? 'ready' : 'missing'} />
                        <SummaryCard label="Packs" value={String(packCount)} detail={`${itemCount} items / ${caseCount} cases`} />
                        <SummaryCard label="Path" value={String(rolePack?.path || '-')} />
                      </div>
                    </div>
                  ) : null;
                })()}
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                    <div>artifact_id: {artifact?.artifact_id || '-'}</div>
                    <div className="mt-1">mission_id: {artifact?.mission_id || '-'}</div>
                    <div className="mt-1">risk_level: {artifact?.risk_level || '-'}</div>
                    <div className="mt-1">confidence: {String(artifact?.confidence ?? '-')}</div>
                    <div className="mt-1">next_action: {artifact?.next_action || '-'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                    <div>goal: {artifact?.goal || '-'}</div>
                    <div className="mt-1">owner: {artifact?.owner_role || artifact?.produced_by?.role_id || '-'}</div>
                    <div className="mt-1">dependencies: {(artifact?.dependencies || []).join(', ') || '-'}</div>
                    <div className="mt-1">fallback_plan: {artifact?.fallback_plan || '-'}</div>
                  </div>
                </div>
                <details className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <summary className="cursor-pointer text-slate-100">payload</summary>
                  <div className="mt-3 space-y-3">
                    <ArtifactRenderer content={extractArtifactRenderableContent(artifact?.payload || {})} />
                    <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/30 p-3 text-[11px] text-slate-400">
                      {JSON.stringify(artifact?.payload || {}, null, 2)}
                    </pre>
                  </div>
                </details>
              </details>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function ArtifactCenterFallback() {
  return (
    <div className="p-6 text-slate-300">
      <div className="mx-auto max-w-6xl rounded-xl border border-slate-700 bg-slate-900/70 p-6">
        正在加载 artifact center...
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-4">
      <div className="text-xs uppercase tracking-[0.25em]" style={{ color: MUTED }}>
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
