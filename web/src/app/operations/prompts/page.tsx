'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getCurrentUser } from '@/services/endpoints/user';
import { fetchPromptDiff, fetchPromptRegistry, fetchPromptVersions } from '@/services/endpoints/prompt-registry';

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/25 p-6 text-center">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-2 text-sm text-slate-400">{description}</div>
    </div>
  );
}

export default function PromptsPage() {
  const t = useTranslations('operations.promptsRegistry');
  const common = useTranslations('common');
  const [search, setSearch] = useState('');
  const [lobsterFilter, setLobsterFilter] = useState('all');
  const [selectedPromptName, setSelectedPromptName] = useState('');
  const [leftVersion, setLeftVersion] = useState('');
  const [rightVersion, setRightVersion] = useState('');

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
  });

  const currentUser = currentUserQuery.data;
  const isAdmin = Boolean(
    currentUser?.isAdmin ||
      currentUser?.roles?.some((role) => String(role).toLowerCase() === 'admin'),
  );

  const promptsQuery = useQuery({
    queryKey: ['prompt-registry', lobsterFilter],
    queryFn: () => fetchPromptRegistry(lobsterFilter === 'all' ? undefined : lobsterFilter),
    enabled: isAdmin,
    staleTime: 30_000,
    retry: false,
  });

  const promptItems = useMemo(() => promptsQuery.data?.items ?? [], [promptsQuery.data?.items]);
  const lobsterOptions = useMemo(
    () => Array.from(new Set(promptItems.map((item) => item.lobster).filter(Boolean))).sort(),
    [promptItems],
  );

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return promptItems.filter((item) => {
      if (lobsterFilter !== 'all' && item.lobster !== lobsterFilter) return false;
      if (!normalized) return true;
      return [item.name, item.lobster, item.skill].join(' ').toLowerCase().includes(normalized);
    });
  }, [lobsterFilter, promptItems, search]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedPromptName('');
      return;
    }
    if (!selectedPromptName || !filteredItems.some((item) => item.name === selectedPromptName)) {
      setSelectedPromptName(filteredItems[0].name);
    }
  }, [filteredItems, selectedPromptName]);

  const versionsQuery = useQuery({
    queryKey: ['prompt-registry', 'versions', selectedPromptName],
    queryFn: () => fetchPromptVersions(selectedPromptName),
    enabled: isAdmin && Boolean(selectedPromptName),
    staleTime: 30_000,
    retry: false,
  });

  const versionItems = useMemo(() => versionsQuery.data?.items ?? [], [versionsQuery.data?.items]);

  useEffect(() => {
    if (versionItems.length >= 2) {
      setLeftVersion(String(versionItems[1]?.version ?? ''));
      setRightVersion(String(versionItems[0]?.version ?? ''));
    } else if (versionItems.length === 1) {
      setLeftVersion(String(versionItems[0].version));
      setRightVersion(String(versionItems[0].version));
    } else {
      setLeftVersion('');
      setRightVersion('');
    }
  }, [selectedPromptName, versionItems]);

  const diffQuery = useQuery({
    queryKey: ['prompt-registry', 'diff', selectedPromptName, leftVersion, rightVersion],
    queryFn: () => fetchPromptDiff(selectedPromptName, Number(leftVersion), Number(rightVersion)),
    enabled: isAdmin && Boolean(selectedPromptName && leftVersion && rightVersion),
    staleTime: 30_000,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
          <FileText className="h-4 w-4" />
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: currentUser?.tenantId ?? '-' })}</span>
          <span>{t('meta.operator', { operator: currentUser?.name ?? currentUser?.id ?? '-' })}</span>
        </div>
      </section>

      {!isAdmin ? (
        <EmptyState title={t('states.readonly')} description={t('states.readonly')} />
      ) : (
        <>
          {promptsQuery.isError ? (
            <EmptyState
              title={t('states.blockedTitle')}
              description={t('states.blockedDescription')}
            />
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{t('list.title')}</div>
                  <div className="mt-1 text-sm text-slate-400">{t('list.description')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void promptsQuery.refetch();
                    void versionsQuery.refetch();
                    void diffQuery.refetch();
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200"
                >
                  <RefreshCw className={`h-4 w-4 ${promptsQuery.isFetching ? 'animate-spin' : ''}`} />
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
                <button
                  type="button"
                  onClick={() => setLobsterFilter('all')}
                  className={`rounded-full px-3 py-1.5 text-xs ${lobsterFilter === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}
                >
                  {t('list.all')}
                </button>
                {lobsterOptions.map((lobster) => (
                  <button
                    key={lobster}
                    type="button"
                    onClick={() => setLobsterFilter(lobster)}
                    className={`rounded-full px-3 py-1.5 text-xs ${lobsterFilter === lobster ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}
                  >
                    {lobster}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                {filteredItems.length ? (
                  filteredItems.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setSelectedPromptName(item.name)}
                      className={`w-full rounded-2xl border px-4 py-4 text-left ${selectedPromptName === item.name ? 'border-cyan-300/60 bg-cyan-500/10' : 'border-white/10 bg-black/20'}`}
                    >
                      <div className="text-sm font-semibold text-white">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.lobster || '-'} · {item.skill || '-'}</div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.production')}: {item.production_version ?? '-'}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.preview')}: {item.preview_version ?? '-'}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.latest')}: {item.latest_version}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t('list.versions')}: {item.total_versions}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState title={t('states.loading')} description={t('states.empty')} />
                )}
              </div>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="text-sm font-semibold text-white">{t('versions.title')}</div>
              <div className="mt-1 text-sm text-slate-400">{t('versions.description')}</div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  {t('versions.left')}
                  <select
                    value={leftVersion}
                    onChange={(event) => setLeftVersion(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  >
                    <option value="">-</option>
                    {versionItems.map((item) => (
                      <option key={`left-${item.prompt_id}`} value={String(item.version)}>
                        v{item.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  {t('versions.right')}
                  <select
                    value={rightVersion}
                    onChange={(event) => setRightVersion(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  >
                    <option value="">-</option>
                    {versionItems.map((item) => (
                      <option key={`right-${item.prompt_id}`} value={String(item.version)}>
                        v{item.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-white">{t('diff.title')}</div>
                  <div className="mt-1 text-sm text-slate-400">{t('diff.description')}</div>
                </div>

                {diffQuery.data ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                        {t('diff.stats')}: +{diffQuery.data.stats.added} / -{diffQuery.data.stats.removed}
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                        {t('diff.variables')}: +{diffQuery.data.added_vars.length} / -{diffQuery.data.removed_vars.length}
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                        {t('diff.config')}: {Object.keys(diffQuery.data.config_diff || {}).length}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('diff.content')}</div>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-300">
                        {diffQuery.data.content_diff || t('diff.noSelection')}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <EmptyState title={t('diff.title')} description={t('diff.noSelection')} />
                )}
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
