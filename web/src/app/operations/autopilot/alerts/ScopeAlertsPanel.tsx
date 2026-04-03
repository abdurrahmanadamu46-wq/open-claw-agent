'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Clock3, ShieldAlert, Wifi, WifiOff, X } from 'lucide-react';

import type { ScopeAlertFeedItem, ScopeRolloutTrendItem } from '@/services/endpoints/agent-dashboard';
import { useScopeAlertFeed } from '@/hooks/useScopeAlertFeed';
import { useScopeRolloutTrend } from '@/hooks/useScopeRolloutTrend';

type ScopeSeverityFilter = 'all' | 'high' | 'medium' | 'low';
type ScopeViewFilter = 'all' | 'stale' | 'failed' | 'live' | 'shadow';
type ScopeSortOption = 'priority' | 'severity' | 'latest' | 'failed' | 'liveWeight' | 'alphabetical';

type SavedScopeView = {
  id: string;
  name: string;
  severity: ScopeSeverityFilter;
  view: ScopeViewFilter;
  role: string;
  search: string;
  sort: ScopeSortOption;
};

const STORAGE_KEY = 'clawcommerce.scope-alert-saved-views.v1';
const BUILTIN_VIEWS = [
  { id: 'all', label: 'All', severity: 'all', view: 'all', role: 'all', search: '', sort: 'priority' },
  { id: 'dispatcher', label: 'Dispatcher', severity: 'all', view: 'all', role: 'dispatcher', search: '', sort: 'priority' },
  { id: 'internal', label: 'Internal Execute', severity: 'all', view: 'live', role: 'dispatcher', search: 'internal_execute', sort: 'liveWeight' },
  { id: 'stale', label: 'Stale', severity: 'all', view: 'stale', role: 'all', search: '', sort: 'latest' },
  { id: 'failed', label: 'Failed', severity: 'all', view: 'failed', role: 'all', search: '', sort: 'failed' },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  severity: ScopeSeverityFilter;
  view: ScopeViewFilter;
  role: string;
  search: string;
  sort: ScopeSortOption;
}>;

function loadSavedViews(): SavedScopeView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? ((JSON.parse(raw) as SavedScopeView[]) ?? []) : [];
  } catch {
    return [];
  }
}

function severityClass(severity: string): string {
  if (severity === 'high') return 'text-rose-300';
  if (severity === 'medium') return 'text-amber-300';
  return 'text-emerald-300';
}

function severityRank(severity: string): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  if (severity === 'low') return 1;
  return 0;
}

function actionRank(action: string): number {
  if (action === 'promote_to_limited_live') return 3;
  if (action === 'promote_with_guardrails') return 2;
  if (action === 'stay_shadow_only') return 1;
  return 0;
}

function ts(value: string | null | undefined): number {
  if (!value) return 0;
  const out = new Date(value).getTime();
  return Number.isFinite(out) ? out : 0;
}

function compareScopes(
  left: ScopeAlertFeedItem,
  right: ScopeAlertFeedItem,
  trendMap: Map<string, ScopeRolloutTrendItem>,
  sortBy: ScopeSortOption,
): number {
  const leftTrend = trendMap.get(left.title);
  const rightTrend = trendMap.get(right.title);
  const leftFailed = Number(left.stats.failedCount ?? 0);
  const rightFailed = Number(right.stats.failedCount ?? 0);
  const leftLatest = ts(String(left.latest.resultAt ?? left.generatedAt));
  const rightLatest = ts(String(right.latest.resultAt ?? right.generatedAt));
  const leftWeight = leftTrend?.recommendedLiveWeight ?? 0;
  const rightWeight = rightTrend?.recommendedLiveWeight ?? 0;

  switch (sortBy) {
    case 'severity':
      return severityRank(right.severity) - severityRank(left.severity) || left.title.localeCompare(right.title);
    case 'latest':
      return rightLatest - leftLatest || left.title.localeCompare(right.title);
    case 'failed':
      return rightFailed - leftFailed || left.title.localeCompare(right.title);
    case 'liveWeight':
      return rightWeight - leftWeight || left.title.localeCompare(right.title);
    case 'alphabetical':
      return left.title.localeCompare(right.title);
    default:
      return (
        severityRank(right.severity) - severityRank(left.severity) ||
        rightFailed - leftFailed ||
        (right.alertType === 'stale_scope' ? 1 : 0) - (left.alertType === 'stale_scope' ? 1 : 0) ||
        actionRank(right.recommendedAction) - actionRank(left.recommendedAction) ||
        rightWeight - leftWeight ||
        rightLatest - leftLatest ||
        left.title.localeCompare(right.title)
      );
  }
}

export function ScopeAlertsPanel() {
  const scopeAlerts = useScopeAlertFeed();
  const scopeTrend = useScopeRolloutTrend();
  const [severity, setSeverity] = useState<ScopeSeverityFilter>('all');
  const [view, setView] = useState<ScopeViewFilter>('all');
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<ScopeSortOption>('priority');
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScopeView[]>([]);

  useEffect(() => setSaved(loadSavedViews()), []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
  }, [saved]);

  const trendMap = useMemo(
    () => new Map(scopeTrend.scopes.map((scope) => [`${scope.roleId}.${scope.scopeId}`, scope])),
    [scopeTrend.scopes],
  );
  const roleOptions = useMemo(() => ['all', ...Array.from(new Set(scopeAlerts.items.map((i) => i.title.split('.')[0] ?? i.title))).sort()], [scopeAlerts.items]);
  const filtered = useMemo(() => scopeAlerts.items.filter((item) => {
    const roleId = item.title.split('.')[0] ?? item.title;
    const latestStatus = String(item.latest.resultStatus ?? '').toLowerCase();
    const haystack = [item.title, item.message, item.alertType, item.recommendedAction].join(' ').toLowerCase();
    if (severity !== 'all' && item.severity !== severity) return false;
    if (role !== 'all' && roleId !== role) return false;
    if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false;
    if (view === 'stale' && item.alertType !== 'stale_scope') return false;
    if (view === 'failed' && Number(item.stats.failedCount ?? 0) <= 0 && latestStatus !== 'failed') return false;
    if (view === 'live' && item.recommendedAction === 'stay_shadow_only') return false;
    if (view === 'shadow' && item.recommendedAction !== 'stay_shadow_only') return false;
    return true;
  }), [role, scopeAlerts.items, search, severity, view]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => compareScopes(a, b, trendMap, sortBy)), [filtered, sortBy, trendMap]);
  const selectedItem = useMemo(() => sorted.find((item) => item.title === selected) ?? null, [selected, sorted]);
  const selectedTrend = useMemo(() => (selected ? trendMap.get(selected) ?? null : null), [selected, trendMap]);

  useEffect(() => {
    if (!sorted.length) {
      setSelected(null);
      return;
    }
    if (!selected || !sorted.some((item) => item.title === selected)) {
      setSelected(sorted[0]!.title);
    }
  }, [selected, sorted]);

  function applyView(next: { severity: ScopeSeverityFilter; view: ScopeViewFilter; role: string; search: string; sort: ScopeSortOption }) {
    setSeverity(next.severity);
    setView(next.view);
    setRole(next.role);
    setSearch(next.search);
    setSortBy(next.sort);
  }

  function saveView() {
    const name = [role !== 'all' ? role : null, view !== 'all' ? view : null, severity !== 'all' ? severity : null, search || null, sortBy !== 'priority' ? `sort:${sortBy}` : null].filter(Boolean).join(' · ') || `Saved ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    setSaved((prev) => [{ id: `saved-${Date.now()}`, name, severity, view, role, search, sort: sortBy }, ...prev].slice(0, 8));
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold text-white"><ShieldAlert className="h-5 w-5 text-rose-300" />Scope drift alerts</div>
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">total {scopeAlerts.items.length}</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
            {scopeAlerts.streamConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-300" /> : <WifiOff className="h-3.5 w-3.5 text-amber-300" />}
            {scopeAlerts.streamConnected ? 'live stream' : 'snapshot mode'}
          </span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {BUILTIN_VIEWS.map((preset) => {
          const active = severity === preset.severity && view === preset.view && role === preset.role && search === preset.search && sortBy === preset.sort;
          return <button key={preset.id} type="button" onClick={() => applyView(preset)} className={`rounded-full px-3 py-2 text-xs font-medium transition ${active ? 'bg-cyan-400/20 text-cyan-100 ring-1 ring-cyan-400/30' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{preset.label}</button>;
        })}
        <button type="button" onClick={saveView} className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-950">Save view</button>
      </div>

      {saved.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {saved.map((entry) => (
            <div key={entry.id} className="inline-flex items-center rounded-full border border-white/10 bg-white/5">
              <button type="button" onClick={() => applyView(entry)} className="px-3 py-2 text-xs font-medium text-slate-300 hover:text-cyan-100">{entry.name}</button>
              <button type="button" onClick={() => setSaved((prev) => prev.filter((item) => item.id !== entry.id))} className="border-l border-white/10 px-2 py-2 text-xs text-slate-500 hover:text-white">×</button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 xl:grid-cols-[1.1fr_0.85fr_0.8fr_0.85fr]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scope, alert type, message" className="w-full rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none">{roleOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as ScopeSortOption)} className="rounded-2xl border border-slate-700/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none">
          <option value="priority">Sort by priority</option>
          <option value="severity">Sort by severity</option>
          <option value="latest">Sort by latest result</option>
          <option value="failed">Sort by failed count</option>
          <option value="liveWeight">Sort by live weight</option>
          <option value="alphabetical">Sort alphabetically</option>
        </select>
        <div className="flex flex-wrap gap-2">
          {(['all', 'high', 'medium', 'low'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setSeverity(value)} className={`rounded-full px-3 py-2 text-xs font-medium ${severity === value ? 'bg-cyan-400/20 text-cyan-100 ring-1 ring-cyan-400/30' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{value}</button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'stale', 'failed', 'live', 'shadow'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setView(value)} className={`rounded-full px-3 py-2 text-xs font-medium ${view === value ? 'bg-rose-400/15 text-rose-100 ring-1 ring-rose-400/30' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{value}</button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.9fr)]">
        <div className="space-y-3">
          {sorted.map((item) => (
            <button key={`${item.title}:${item.generatedAt}`} type="button" onClick={() => setSelected(item.title)} className={`w-full rounded-2xl border p-4 text-left ${item.title === selected ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/8 bg-slate-950/45 hover:border-white/15'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{item.alertType}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${severityClass(item.severity as never)}`}>{item.severity}</span>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">{item.recommendedAction}</span>
                </div>
              </div>
              <div className="mt-3 text-sm leading-7 text-slate-300">{item.message}</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <MiniStat label="queued" value={String(item.stats.queuedCount ?? 0)} />
                <MiniStat label="handled" value={String(item.stats.handledCount ?? 0)} />
                <MiniStat label="failed" value={String(item.stats.failedCount ?? 0)} />
                <MiniStat label="latest" value={String(item.latest.resultStatus ?? '-')} />
              </div>
            </button>
          ))}
          {sorted.length === 0 ? (
            <EmptyNotice text={scopeAlerts.streamError ? `Scope alert stream unavailable (${scopeAlerts.streamError}), and the current filters returned no scope items.` : 'No scope alerts match the current filters.'} />
          ) : null}
        </div>

        <ScopeDetailDrawer item={selectedItem} trend={selectedTrend} streamConnected={scopeAlerts.streamConnected} streamError={scopeAlerts.streamError} onClose={() => setSelected(null)} />
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function EmptyNotice({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
      {text}
    </div>
  );
}

function ScopeDetailDrawer({
  item,
  trend,
  streamConnected,
  streamError,
  onClose,
}: {
  item: ScopeAlertFeedItem | null;
  trend: ScopeRolloutTrendItem | null;
  streamConnected: boolean;
  streamError: string | null;
  onClose: () => void;
}) {
  if (!item) {
    return (
      <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
        Select a scope alert card to inspect its latest context, trend buckets, and rollout posture.
      </div>
    );
  }

  return (
    <aside className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Scope detail</div>
          <div className="mt-2 text-2xl font-semibold text-white">{item.title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium ${severityClass(item.severity)}`}>{item.severity}</span>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">{item.recommendedAction}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
          aria-label="Close scope detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-slate-300">
          {item.message}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MiniStat label="queued" value={String(item.stats.queuedCount ?? 0)} />
          <MiniStat label="handled" value={String(item.stats.handledCount ?? 0)} />
          <MiniStat label="failed" value={String(item.stats.failedCount ?? 0)} />
          <MiniStat label="simulated" value={String(item.stats.simulatedCount ?? 0)} />
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Stream + latest</div>
            <div className="inline-flex items-center gap-2 text-xs text-slate-300">
              {streamConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-300" /> : <WifiOff className="h-3.5 w-3.5 text-amber-300" />}
              {streamConnected ? 'live stream' : 'snapshot mode'}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniStat label="latest status" value={String(item.latest.resultStatus ?? '-')} />
            <MiniStat label="latest at" value={String(item.latest.resultAt ?? '-')} />
          </div>
          {streamError ? <div className="mt-3 text-xs text-amber-300">stream note: {streamError}</div> : null}
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Scope timeline</div>
            <div className="text-[11px] text-slate-500">{trend ? `live ${trend.recommendedLiveWeight}` : 'no scope trend'}</div>
          </div>
          {trend?.buckets.length ? (
            <div className="flex items-end gap-2">
              {trend.buckets.map((bucket) => {
                const total = bucket.queuedCount + bucket.handledCount + bucket.failedCount + bucket.simulatedCount;
                const height = Math.max(12, total * 16);
                return (
                  <div key={bucket.bucketStart} className="flex min-w-[74px] flex-col items-center gap-2">
                    <div className="flex h-28 items-end">
                      <div className="flex w-10 flex-col justify-end overflow-hidden rounded-t-xl border border-white/10 bg-slate-900/70" style={{ height }}>
                        {bucket.failedCount > 0 ? <div className="bg-rose-400/80" style={{ height: `${bucket.failedCount * 18}px` }} /> : null}
                        {bucket.simulatedCount > 0 ? <div className="bg-amber-300/70" style={{ height: `${bucket.simulatedCount * 18}px` }} /> : null}
                        {bucket.handledCount > 0 ? <div className="bg-emerald-400/80" style={{ height: `${bucket.handledCount * 18}px` }} /> : null}
                        {bucket.queuedCount > 0 ? <div className="bg-cyan-400/70" style={{ height: `${bucket.queuedCount * 18}px` }} /> : null}
                      </div>
                    </div>
                    <div className="text-center text-[11px] text-slate-400">
                      {new Date(bucket.bucketStart).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No rollout buckets yet.</div>
          )}
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Rollout context</div>
          <div className="space-y-3 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-slate-500" />
              latest note: {trend?.latestResultNote ?? 'n/a'}
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-slate-500" />
              bridge targets: {trend?.bridgeTargets.join(', ') || 'n/a'}
            </div>
            <div className="break-all text-xs text-slate-500">feed source: {item.sourcePath}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
