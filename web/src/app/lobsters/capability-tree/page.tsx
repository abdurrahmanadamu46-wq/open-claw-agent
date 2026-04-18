'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, FolderKanban, Network, Sparkles } from 'lucide-react';
import { CompositionDepthPanel } from '@/components/operations/CompositionDepthPanel';
import {
  SurfaceHero,
  SurfaceMetric,
  SurfaceSection,
  SurfaceStateCard,
} from '@/components/operations/SurfacePrimitives';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { useTenant } from '@/contexts/TenantContext';
import { fetchControlPlaneSupervisorCapabilityGraph } from '@/services/endpoints/control-plane-overview';
import {
  getAllKnownLobsterRoles,
  getLobsterPipelineStage,
  getLobsterRoleMeta,
  LOBSTER_PIPELINE_STAGES,
  orderAgentIds,
  OUTPUT_FORMATS,
} from '@/lib/lobster-skills';
import type { ControlPlaneSupervisorCapabilityGraphResponse } from '@/types/control-plane-overview';

type CapabilityAgentRow = ControlPlaneSupervisorCapabilityGraphResponse['graph']['agents'][number];
type CollabKnowledgeItem = ControlPlaneSupervisorCapabilityGraphResponse['graph']['collab_summaries'][number];

export default function LobsterCapabilityTreePage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const graphQuery = useQuery({
    queryKey: ['lobsters', 'capability-tree', tenantId],
    queryFn: () => fetchControlPlaneSupervisorCapabilityGraph({ tenant_id: tenantId }),
    staleTime: 60_000,
    retry: false,
  });

  const capabilityGraph = graphQuery.data;
  const agents = useMemo(
    () => ((capabilityGraph?.graph.agents ?? []) as CapabilityAgentRow[]),
    [capabilityGraph?.graph.agents],
  );
  const collabKnowledgeItems = useMemo(
    () => capabilityGraph?.graph.collab_summaries ?? [],
    [capabilityGraph?.graph.collab_summaries],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, CapabilityAgentRow>();
    agents.forEach((row) => map.set(row.agent_id, row));
    return map;
  }, [agents]);

  const orderedAgentIds = useMemo(() => {
    const knownIds = getAllKnownLobsterRoles()
      .filter((role) => role.id !== 'commander')
      .map((role) => role.id);
    return orderAgentIds(Array.from(new Set([...knownIds, ...agents.map((item) => item.agent_id)])));
  }, [agents]);

  if (graphQuery.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="Loading supervisor capability graph"
          description="This page now waits for one aggregated capability-graph contract instead of separately loading skills overview and collab summary feeds."
        />
      </div>
    );
  }

  if (graphQuery.isError || !capabilityGraph) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="Capability graph is unavailable"
          description="The page could not read the aggregated control-plane capability graph. This page no longer falls back to multiple live queries."
          actionHref={LEARNING_LOOP_ROUTES.frontendGaps.href}
          actionLabel={LEARNING_LOOP_ROUTES.frontendGaps.title}
        />
      </div>
    );
  }

  const summary = capabilityGraph.summary;

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="Lobster Supervisors / Capability Graph"
        title="One graph to explain supervisor coverage, downstream roles, and what is still only presentation metadata"
        description="This page is the structural view of the supervisor zone. It now reads one aggregated capability graph contract, then applies local role and stage metadata only for presentation."
        actions={
          <>
            <Link
              href="/lobsters"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950"
            >
              Back To Supervisors
            </Link>
            <Link
              href="/operations/skills-pool"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100"
            >
              Open Skills Pool
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric label="Agents" value={String(summary.agents_total)} helper={`enabled ${summary.agents_enabled}`} icon={<Sparkles className="h-4 w-4" />} />
        <SurfaceMetric label="Skills" value={String(summary.skills_total)} helper={`avg ${(summary.skills_total / Math.max(summary.agents_total, 1)).toFixed(1)} per role`} icon={<BrainCircuit className="h-4 w-4" />} />
        <SurfaceMetric label="RAG Packs" value={String(summary.rag_packs_total)} helper={`kb profiles ${summary.kb_profiles_total}`} icon={<FolderKanban className="h-4 w-4" />} />
        <SurfaceMetric label="Output Formats" value={String(OUTPUT_FORMATS.length)} helper={OUTPUT_FORMATS.join(' / ')} icon={<Network className="h-4 w-4" />} />
      </section>

      <CompositionDepthPanel
        title="Capability Tree Wiring Depth"
        summary="This page now uses one live capability-graph contract. Stage and artifact semantics are still frontend-owned, but they now come from one shared semantic layer instead of being repeated inside this page."
        items={[
          {
            label: 'capability graph',
            mode: 'live',
            detail: 'Read from one live control-plane capability-graph endpoint.',
          },
          {
            label: 'tenant summaries',
            mode: 'live',
            detail: 'Tenant-private collaboration summaries now arrive through the same graph response.',
          },
          {
            label: 'stage semantics',
            mode: 'local',
            detail: 'Stage labels, edge summary, and artifact naming now come from one shared frontend semantic layer.',
          },
          {
            label: 'page assembly',
            mode: 'composed',
            detail: 'Presentation still combines one live graph payload with shared frontend stage semantics.',
          },
        ]}
      />

      <SurfaceSection
        title="Tenant-private collaboration summaries"
        description="These are de-sensitive supervisor-consumable collaboration summaries coming from the aggregated capability graph response."
      >
        {collabKnowledgeItems.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {collabKnowledgeItems.map((item, index) => (
              <CollabKnowledgeCard key={item.captureId || `capture-${index + 1}`} item={item} />
            ))}
          </div>
        ) : (
          <SurfaceStateCard
            kind="empty"
            title="No tenant-private summaries yet"
            description="The graph contract is live, but there are no collaboration summaries to project into the supervisor layer yet."
          />
        )}
      </SurfaceSection>

      <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <SurfaceSection
          title="Business loop by stage"
          description="Stage layout now comes from one shared frontend semantic layer, while counts and activation state come from the aggregated graph contract."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {LOBSTER_PIPELINE_STAGES.map((stage) => {
              const upstreamLabels = stage.upstreamStageKeys
                .map((stageKey) => getLobsterPipelineStage(stageKey)?.label)
                .filter(Boolean) as string[];
              const downstreamLabels = stage.downstreamStageKeys
                .map((stageKey) => getLobsterPipelineStage(stageKey)?.label)
                .filter(Boolean) as string[];
              const owners = stage.ownerIds.map((agentId) => {
                const meta = getLobsterRoleMeta(agentId);
                const row = agentById.get(agentId);
                return {
                  meta,
                  enabled: row?.enabled !== false,
                  skillsCount: row?.skills_count ?? 0,
                  ragPackCount: row?.rag_pack_count ?? 0,
                };
              });

              return (
                <div key={stage.key} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">{stage.label}</div>
                      <div className="mt-2 text-base font-semibold text-white">
                        {owners.map((owner) => owner.meta.zhName).join(' / ')}
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                      online {owners.filter((owner) => owner.enabled).length}/{owners.length}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-7 text-slate-300">{stage.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {stage.artifacts.map((artifact) => (
                      <span key={artifact} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                        {artifact}
                      </span>
                    ))}
                    {stage.representativeSkills.slice(0, 3).map((skill) => (
                      <span key={skill} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
                        {skill}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">upstream</div>
                      <div className="mt-2">{upstreamLabels.length ? upstreamLabels.join(' / ') : 'start of chain'}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">downstream</div>
                      <div className="mt-2">{downstreamLabels.length ? downstreamLabels.join(' / ') : 'end of chain'}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {owners.map((owner) => (
                      <div key={owner.meta.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div>
                          <div className="font-medium text-white">{owner.meta.zhName}</div>
                          <div className="mt-1 text-xs text-slate-400">{owner.meta.artifact}</div>
                        </div>
                        <div className="text-right text-xs text-slate-300">
                          <div>skills {owner.skillsCount}</div>
                          <div className="mt-1">packs {owner.ragPackCount}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceSection>

        <SurfaceSection
          title="What this graph can and cannot prove"
          description="This page is now contract-first, but not yet fully self-describing."
        >
          <div className="space-y-3 text-sm leading-7 text-slate-300">
            <ActionCard
              icon={<BrainCircuit className="h-4 w-4" />}
              title="What is now live"
              description="Agent counts, enablement, model bindings, rag-pack counts, and tenant-private summaries now come from one backend graph payload."
            />
            <ActionCard
              icon={<FolderKanban className="h-4 w-4" />}
              title="What is still frontend-owned"
              description="Stage labels, edge summary, artifact naming, and stage ordering still come from one shared frontend semantic layer."
            />
            <ActionCard
              icon={<Network className="h-4 w-4" />}
              title="Remaining graph gap"
              description={(capabilityGraph.graph.gaps || []).join(' ') || 'No explicit graph gaps reported.'}
            />
          </div>
        </SurfaceSection>
      </section>

      <SurfaceSection
        title="Role capability nodes"
        description="Each role card now consumes the aggregated graph response and only uses local metadata for presentation."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedAgentIds.map((agentId) => {
            const meta = getLobsterRoleMeta(agentId);
            const row = agentById.get(agentId);

            return (
              <article key={agentId} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{meta.stageIndex}</div>
                    <div className="mt-2 text-lg font-semibold text-white">{meta.zhName}</div>
                    <div className="mt-1 text-sm text-slate-400">{meta.stageLabel}</div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      row?.enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {row?.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>

                <div className="mt-4 text-sm leading-7 text-slate-300">{meta.summary}</div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniMetric label="Skills" value={String(row?.skills_count ?? 0)} />
                  <MiniMetric label="Nodes" value={String(row?.nodes_count ?? 0)} />
                  <MiniMetric label="RAG Packs" value={String(row?.rag_pack_count ?? 0)} />
                  <MiniMetric label="Model" value={row?.model_name || '-'} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {meta.representativeSkills.map((skill) => (
                    <span key={skill} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
                      {skill}
                    </span>
                  ))}
                </div>

                <Link
                  href={`/lobsters/${encodeURIComponent(agentId)}`}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950"
                >
                  Open Supervisor Detail
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            );
          })}
        </div>
      </SurfaceSection>
    </div>
  );
}

function CollabKnowledgeCard({ item }: { item: CollabKnowledgeItem }) {
  const evidenceRefs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">{String(item.sourceType ?? '-')}</div>
          <div className="mt-2 text-sm font-semibold text-white">{String(item.objectType ?? '-')}</div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {String(item.sourceLayer ?? 'tenant_private')}
        </span>
      </div>
      <div className="mt-3 text-sm leading-7 text-slate-300">{String(item.insight ?? '-')}</div>
      <div className="mt-4 text-xs text-slate-500">
        refs: {evidenceRefs.length}
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{description}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
