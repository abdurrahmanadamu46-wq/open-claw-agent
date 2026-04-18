'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { RefreshCw, Shield, Wrench, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  fetchLobsterConfigDetail,
  fetchLobsterConfigs,
  updateLobsterConfig,
} from '@/services/endpoints/ai-subservice';
import type { LobsterConfigDetail, LobsterConfigSummary, LobsterConfigUpdatePayload } from '@/types/lobster-config-center';

export default function LobsterConfigPage() {
  const t = useTranslations('operations.lobsterConfig');
  const common = useTranslations('common');
  const [configs, setConfigs] = useState<LobsterConfigSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<LobsterConfigDetail | null>(null);
  const [strategyDraft, setStrategyDraft] = useState('');
  const [autonomyDraft, setAutonomyDraft] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const loadConfigs = async () => {
    setLoadingList(true);
    setErrorMessage('');
    try {
      const data = await fetchLobsterConfigs();
      const nextList = data.lobsters ?? [];
      setConfigs(nextList);
      if (!selectedId && nextList.length > 0) {
        setSelectedId(nextList[0].lobsterId);
      }
    } catch (error) {
      setErrorMessage(String((error as Error).message || t('messages.requestFailed')));
    } finally {
      setLoadingList(false);
    }
  };

  const loadDetail = async (lobsterId: string) => {
    setLoadingDetail(true);
    setErrorMessage('');
    try {
      const data = await fetchLobsterConfigDetail(lobsterId);
      setDetail(data.config);
      setStrategyDraft(data.config.strategyLevel ?? '');
      setAutonomyDraft(data.config.autonomyLevel ?? '');
      setPromptDraft(data.config.customPrompt ?? '');
    } catch (error) {
      setDetail(null);
      setErrorMessage(String((error as Error).message || t('messages.requestFailed')));
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setErrorMessage('');
    try {
      const payload: LobsterConfigUpdatePayload = {};
      if (strategyDraft.trim()) payload.strategy_level = strategyDraft.trim();
      if (autonomyDraft.trim()) payload.autonomy_level = autonomyDraft.trim();
      payload.custom_prompt = promptDraft.trim();
      const data = await updateLobsterConfig(selectedId, payload);
      setDetail(data.config);
      setNotice(t('messages.saved'));
      setPromptDraft(data.config.customPrompt ?? '');
    } catch (error) {
      setErrorMessage(String((error as Error).message || t('messages.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  const metrics = useMemo(
    () => ({
      total: configs.length,
      strategyReady: configs.filter((item) => Boolean(item.strategyLevel)).length,
      autonomyReady: configs.filter((item) => Boolean(item.autonomyLevel)).length,
    }),
    [configs],
  );

  const detailTools = detail?.tools ?? detail?.defaultTools ?? [];
  const detailSkills = detail?.skills ?? detail?.defaultSkills ?? [];

  return (
    <div className="px-6 py-6 text-slate-100">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-[#0c1628] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-cyan-300">{t('badge')}</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">{t('title')}</h1>
              <p className="mt-1 text-sm text-slate-300">{t('description')}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadConfigs()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-cyan-400 hover:text-cyan-100"
            >
              <RefreshCw className={`${loadingList ? 'animate-spin' : ''} h-4 w-4`} />
              {common('refresh')}
            </button>
          </div>

          <div className="mt-6 grid gap-3">
            <div className="grid gap-2 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3 text-xs text-slate-400">
              <div className="flex items-center justify-between text-white">
                <span>{t('list.title')}</span>
                <span className="text-slate-400">{metrics.total} {t('list.total')}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
                <span>{t('list.strategyReady')}</span>
                <span>{metrics.strategyReady}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
                <span>{t('list.autonomyReady')}</span>
                <span>{metrics.autonomyReady}</span>
              </div>
            </div>

            {configs.length > 0 ? configs.map((item) => (
              <button
                key={item.lobsterId}
                type="button"
                onClick={() => setSelectedId(item.lobsterId)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selectedId === item.lobsterId
                    ? 'border-cyan-300/70 bg-cyan-500/10 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500 hover:bg-slate-900/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{item.displayName || item.name || item.lobsterId}</div>
                    {item.status ? <div className="text-xs text-slate-400">{item.status}</div> : null}
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{item.lifecycle || '-'}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  {item.strategyLevel ? <span className="rounded-full border border-cyan-400/40 px-2 py-1">{t('fields.strategyLevel')}: {item.strategyLevel}</span> : null}
                  {item.autonomyLevel ? <span className="rounded-full border border-emerald-400/30 px-2 py-1">{t('fields.autonomyLevel')}: {item.autonomyLevel}</span> : null}
                </div>
              </button>
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-500">
                {loadingList ? t('list.loading') : t('list.empty')}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-gradient-to-b from-[#0e1729] to-[#050a14] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('detail.badge')}</div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {detail?.displayName || detail?.name || t('detail.placeholder')}
                </div>
                <div className="text-xs text-slate-400">
                  {detail?.description || t('detail.about')}
                </div>
              </div>
              <div className="text-right text-xs uppercase tracking-[0.3em] text-slate-400">
                {loadingDetail ? t('detail.loading') : detail?.lastUpdatedAt || t('detail.updated')}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Metric label={t('metrics.strategyLevel')} value={detail?.strategyLevel || t('metrics.empty')} icon={Zap} />
              <Metric label={t('metrics.autonomyLevel')} value={detail?.autonomyLevel || t('metrics.empty')} icon={Shield} />
              <Metric label={t('metrics.tools')} value={String(detailTools.length)} icon={Wrench} />
            </div>
          </div>

          <section className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('sections.configuration')}</h2>
              <button
                type="button"
                disabled={saving || !detail}
                onClick={() => void handleSave()}
                className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 disabled:opacity-60"
              >
                {saving ? t('buttons.saving') : common('save')}
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">
                {t('fields.strategyLevel')}
                <input
                  value={strategyDraft}
                  onChange={(event) => setStrategyDraft(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  placeholder={t('fields.strategyPlaceholder')}
                />
              </label>
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">
                {t('fields.autonomyLevel')}
                <input
                  value={autonomyDraft}
                  onChange={(event) => setAutonomyDraft(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  placeholder={t('fields.autonomyPlaceholder')}
                />
              </label>
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">
                {t('fields.customPrompt')}
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  placeholder={t('fields.customPromptPlaceholder')}
                />
              </label>
            </div>
            {notice ? <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorMessage ? <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorMessage}</div> : null}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('sections.tools')}</h2>
              <span className="text-xs text-slate-400">{detailTools.length} {t('sections.count')}</span>
            </div>
            <div className="mt-3 space-y-3">
              {detailTools.length > 0 ? detailTools.map((tool) => (
                <div key={`${tool.toolId}-${tool.name}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-3">
                  <div className="text-sm font-semibold text-white">{tool.name || tool.toolId}</div>
                  <div className="mt-1 text-xs text-slate-400">{tool.description || t('sections.unknown')}</div>
                </div>
              )) : (
                <div className="text-sm text-slate-400">{t('sections.empty')}</div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('sections.skills')}</h2>
              <span className="text-xs text-slate-400">{detailSkills.length} {t('sections.count')}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {detailSkills.length > 0 ? detailSkills.map((skill) => (
                <div key={skill.skillId} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-3">
                  <div className="text-sm font-semibold text-white">{skill.name || skill.skillId}</div>
                  <div className="mt-1 text-xs text-slate-400">{skill.capability || skill.status || t('sections.unknown')}</div>
                </div>
              )) : (
                <div className="text-sm text-slate-400">{t('sections.empty')}</div>
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-950/50 px-4 py-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2 text-cyan-200">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{label}</div>
        <div className="text-lg font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}
