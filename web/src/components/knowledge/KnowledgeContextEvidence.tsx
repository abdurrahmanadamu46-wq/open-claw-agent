'use client';

import type { ReactNode } from 'react';
import { Database, Eye, Layers3, ShieldCheck } from 'lucide-react';
import type {
  ControlPlaneKnowledgeSourceRef,
  KnowledgeLayer,
  RuntimeKnowledgeContext,
} from '@/types/control-plane-overview';

const LAYERS: Array<{ id: KnowledgeLayer; label: string; tone: string }> = [
  {
    id: 'platform_common',
    label: 'Platform common',
    tone: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
  },
  {
    id: 'platform_industry',
    label: 'Platform industry',
    tone: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100',
  },
  {
    id: 'tenant_private',
    label: 'Tenant private',
    tone: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asSourceRefArray(value: unknown): ControlPlaneKnowledgeSourceRef[] {
  return Array.isArray(value)
    ? value.filter((item): item is ControlPlaneKnowledgeSourceRef => Boolean(asRecord(item)))
    : [];
}

export function resolveKnowledgeContext(value: unknown): RuntimeKnowledgeContext | null {
  const direct = asRecord(value);
  if (!direct) return null;
  if (direct.layers || direct.resolved || direct.explainable_sources || direct.source_refs) {
    return direct as RuntimeKnowledgeContext;
  }
  for (const key of ['knowledge_context', 'runtime_knowledge_context']) {
    const nested = asRecord(direct[key]);
    if (nested) return nested as RuntimeKnowledgeContext;
  }
  return null;
}

function getLayerItems(context: RuntimeKnowledgeContext | null, layer: KnowledgeLayer) {
  if (!context) return [];
  const fromLayers = context.layers?.[layer]?.items;
  if (Array.isArray(fromLayers)) return fromLayers;
  const fromResolved = context.resolved?.[layer];
  if (Array.isArray(fromResolved)) return fromResolved;
  return [];
}

function getLayerCount(context: RuntimeKnowledgeContext | null, layer: KnowledgeLayer) {
  if (!context) return 0;
  const explicit = context.layers?.[layer]?.count;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return getLayerItems(context, layer).length;
}

function getSourceRefs(context: RuntimeKnowledgeContext | null) {
  if (!context) return [];
  const direct = asSourceRefArray(context.explainable_sources);
  if (direct.length) return direct;
  const sourceRefs = asSourceRefArray(context.source_refs);
  if (sourceRefs.length) return sourceRefs;
  return LAYERS.flatMap((layer) => getLayerItems(context, layer.id));
}

export function KnowledgeContextEvidence({
  context,
  title = 'Runtime knowledge evidence',
  compact = false,
}: {
  context: unknown;
  title?: string;
  compact?: boolean;
}) {
  const resolved = resolveKnowledgeContext(context);
  const sourceRefs = getSourceRefs(resolved).slice(0, compact ? 4 : 8);
  const tenantPrivateCount = getLayerCount(resolved, 'tenant_private');
  const policy = resolved?.policy ?? {};
  const isEmpty = !resolved || LAYERS.every((layer) => getLayerCount(resolved, layer.id) === 0);

  if (isEmpty) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
        No runtime knowledge context is attached to this task yet.
      </div>
    );
  }

  return (
    <section
      data-testid="knowledge-context-evidence"
      className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
            <Layers3 className="h-4 w-4" />
            {title}
          </div>
          <div className="mt-1 text-xs text-cyan-100/80">
            {resolved?.version || 'knowledge_context.v1'} · tenant {resolved?.tenant_id || '-'} · industry{' '}
            {resolved?.industry_tag || '-'}
          </div>
        </div>
        <div className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
          tenant_private summaries: {tenantPrivateCount}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {LAYERS.map((layer) => (
          <div key={layer.id} className={`rounded-2xl border px-4 py-3 ${layer.tone}`}>
            <div className="text-xs uppercase tracking-[0.18em] opacity-75">{layer.label}</div>
            <div className="mt-2 text-2xl font-semibold">{getLayerCount(resolved, layer.id)}</div>
          </div>
        ))}
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <PolicyPill
            icon={<ShieldCheck className="h-4 w-4" />}
            label="raw traces"
            value={policy.raw_group_collab_trace_included ? 'included' : 'excluded'}
            ok={!policy.raw_group_collab_trace_included}
            testId="knowledge-policy-raw-traces"
          />
          <PolicyPill
            icon={<Eye className="h-4 w-4" />}
            label="tenant private"
            value={policy.tenant_private_summary_only === false ? 'raw allowed' : 'summary only'}
            ok={policy.tenant_private_summary_only !== false}
            testId="knowledge-policy-tenant-private"
          />
          <PolicyPill
            icon={<Database className="h-4 w-4" />}
            label="platform backflow"
            value={policy.platform_backflow_allowed ? 'allowed' : 'blocked'}
            ok={!policy.platform_backflow_allowed}
            testId="knowledge-policy-platform-backflow"
          />
        </div>
      ) : null}

      {sourceRefs.length ? (
        <div className="mt-4 space-y-2">
          {sourceRefs.map((ref, index) => (
            <div
              key={`${ref.layer}-${ref.source_type}-${ref.source_id}-${index}`}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">
                  {ref.layer}
                </span>
                <span className="font-medium text-white">{ref.title || ref.source_id || ref.source_type}</span>
              </div>
              <div className="mt-1 text-slate-500">
                {ref.source_type} · {ref.source_id}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PolicyPill({
  icon,
  label,
  value,
  ok,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ok: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border px-4 py-3 ${
        ok
          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
          : 'border-rose-400/20 bg-rose-500/10 text-rose-100'
      }`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] opacity-75">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  );
}
