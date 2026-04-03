'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusCard } from '@/components/lobster/StatusCard';
import { fetchTemporalGraphSnapshot, fetchTemporalGraphTimeline } from '@/services/endpoints/temporal-graph';
import { getCurrentUser } from '@/services/endpoints/user';

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/25 p-6 text-center">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-2 text-sm text-slate-400">{description}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm text-white">{value}</div>
    </div>
  );
}

export default function CrmGraphPage() {
  const t = useTranslations('crm.graph');
  const common = useTranslations('common');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [relationFilter, setRelationFilter] = useState('all');

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
  });
  const tenantId = currentUserQuery.data?.tenantId || '';

  const snapshotQuery = useQuery({
    queryKey: ['crm-graph', 'snapshot', tenantId],
    queryFn: () => fetchTemporalGraphSnapshot(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: false,
  });

  const entities = useMemo(() => snapshotQuery.data?.data.entities ?? [], [snapshotQuery.data?.data.entities]);
  const edges = useMemo(() => snapshotQuery.data?.data.edges ?? [], [snapshotQuery.data?.data.edges]);
  const entityTypes = useMemo(() => Array.from(new Set(entities.map((item) => item.entity_type))).sort(), [entities]);
  const relationTypes = useMemo(() => Array.from(new Set(edges.map((item) => item.relation))).sort(), [edges]);
  const entityNameMap = useMemo(() => Object.fromEntries(entities.map((item) => [item.entity_id, item.name])), [entities]);

  const filteredEntities = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return entities.filter((entity) => {
      if (typeFilter !== 'all' && entity.entity_type !== typeFilter) return false;
      if (!normalized) return true;
      return `${entity.name} ${entity.entity_type}`.toLowerCase().includes(normalized);
    });
  }, [entities, search, typeFilter]);

  useEffect(() => {
    if (!filteredEntities.length) {
      setSelectedEntityId('');
      return;
    }
    if (!selectedEntityId || !filteredEntities.some((item) => item.entity_id === selectedEntityId)) {
      setSelectedEntityId(filteredEntities[0].entity_id);
    }
  }, [filteredEntities, selectedEntityId]);

  const selectedEntity =
    filteredEntities.find((item) => item.entity_id === selectedEntityId) ||
    entities.find((item) => item.entity_id === selectedEntityId) ||
    null;

  const relatedEdges = useMemo(() => {
    if (!selectedEntity) return [];
    const nextEdges = edges.filter(
      (edge) => edge.source_id === selectedEntity.entity_id || edge.target_id === selectedEntity.entity_id,
    );
    if (relationFilter !== 'all') {
      return nextEdges.filter((edge) => edge.relation === relationFilter);
    }
    return nextEdges;
  }, [edges, relationFilter, selectedEntity]);

  const timelineQuery = useQuery({
    queryKey: ['crm-graph', 'timeline', tenantId, selectedEntity?.name],
    queryFn: () =>
      fetchTemporalGraphTimeline({
        tenantId,
        entityName: selectedEntity?.name || '',
        limit: 20,
      }),
    enabled: Boolean(tenantId && selectedEntity?.name),
    staleTime: 30_000,
    retry: false,
  });

  const timelineItems = timelineQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
          <Network className="h-4 w-4" />
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: tenantId || '-' })}</span>
          <span>{t('meta.operator', { operator: currentUserQuery.data?.name ?? currentUserQuery.data?.id ?? '-' })}</span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard title={t('summary.entities')} value={String(entities.length)} />
        <StatusCard title={t('summary.edges')} value={String(edges.length)} />
        <StatusCard title={t('summary.types')} value={String(entityTypes.length)} />
        <StatusCard title={t('summary.referenceTime')} value={snapshotQuery.data?.data.reference_time || '-'} />
      </section>

      {selectedEntity ? (
        <section className="grid gap-4 md:grid-cols-3">
          <StatusCard title={t('summary.relatedEdges')} value={String(relatedEdges.length)} />
          <StatusCard title={t('summary.timelineEvents')} value={String(timelineItems.length)} />
          <StatusCard title={t('summary.selectedEntity')} value={selectedEntity.name} subtitle={selectedEntity.entity_type} />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">{t('list.title')}</div>
              <div className="mt-1 text-sm text-slate-400">{t('list.description')}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                void snapshotQuery.refetch();
                void timelineQuery.refetch();
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200"
            >
              <RefreshCw className={`h-4 w-4 ${snapshotQuery.isFetching ? 'animate-spin' : ''}`} />
              {common('refresh')}
            </button>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
            placeholder={t('list.searchPlaceholder')}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setTypeFilter('all')} className={`rounded-full px-3 py-1.5 text-xs ${typeFilter === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{t('list.all')}</button>
            {entityTypes.map((type) => (
              <button key={type} type="button" onClick={() => setTypeFilter(type)} className={`rounded-full px-3 py-1.5 text-xs ${typeFilter === type ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{type}</button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setRelationFilter('all')} className={`rounded-full px-3 py-1.5 text-xs ${relationFilter === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{t('detail.allRelations')}</button>
            {relationTypes.map((relation) => (
              <button key={relation} type="button" onClick={() => setRelationFilter(relation)} className={`rounded-full px-3 py-1.5 text-xs ${relationFilter === relation ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{relation}</button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {filteredEntities.length ? (
              filteredEntities.map((entity) => (
                <button key={entity.entity_id} type="button" onClick={() => setSelectedEntityId(entity.entity_id)} className={`w-full rounded-2xl border px-4 py-4 text-left ${selectedEntityId === entity.entity_id ? 'border-cyan-300/60 bg-cyan-500/10' : 'border-white/10 bg-black/20'}`}>
                  <div className="text-sm font-semibold text-white">{entity.name}</div>
                  <div className="mt-1 text-xs text-slate-400">{entity.entity_type}</div>
                </button>
              ))
            ) : (
              <EmptyState title={t('list.title')} description={t('list.empty')} />
            )}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          {selectedEntity ? (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-white">{t('detail.title')}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{selectedEntity.name}</div>
                <div className="mt-1 text-sm text-slate-400">{selectedEntity.entity_type}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <InfoRow label={common('created_at')} value={selectedEntity.created_at} />
                <InfoRow label={t('summary.referenceTime')} value={snapshotQuery.data?.data.reference_time || '-'} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('detail.attributes')}</div>
                <pre className="mt-3 overflow-x-auto text-xs text-slate-300">{JSON.stringify(selectedEntity.attributes, null, 2)}</pre>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('detail.relations')}</div>
                <div className="mt-3 space-y-2">
                  {relatedEdges.length ? (
                    relatedEdges.map((edge) => (
                      <div key={edge.edge_id} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200">
                        <div>{edge.relation}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {t('detail.connectedEntity')}: {edge.source_id === selectedEntity.entity_id ? entityNameMap[edge.target_id] || edge.target_id : entityNameMap[edge.source_id] || edge.source_id}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {edge.fact || `${entityNameMap[edge.source_id] || edge.source_id} → ${entityNameMap[edge.target_id] || edge.target_id}`}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t('detail.confidence')}: {Number(edge.confidence || 0).toFixed(2)} · {t('detail.validAt')}: {edge.valid_at}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState title={t('detail.relations')} description={t('detail.timelineEmpty')} />
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('detail.timeline')}</div>
                <div className="mt-3 space-y-2">
                  {timelineItems.length ? (
                    timelineItems.map((item) => (
                      <div key={item.edge_id} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200">
                        <div>{item.relation}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {entityNameMap[item.source_id] || item.source_id} → {entityNameMap[item.target_id] || item.target_id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{item.valid_at}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyState title={t('detail.timeline')} description={t('detail.timelineEmpty')} />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title={t('detail.emptyTitle')} description={t('detail.emptyDescription')} />
          )}
        </article>
      </section>
    </div>
  );
}
