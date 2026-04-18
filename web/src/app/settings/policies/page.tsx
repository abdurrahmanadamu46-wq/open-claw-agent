'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookLock, GitBranchPlus, Play, RefreshCw, Scale, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusCard } from '@/components/lobster/StatusCard';
import { triggerSuccessToast } from '@/services/api';
import {
  createPolicy,
  deletePolicy,
  evaluatePolicy,
  fetchCurrentPolicyBundle,
  fetchPolicies,
  publishPolicyBundle,
  updatePolicy,
} from '@/services/endpoints/policy-engine';
import { getCurrentUser } from '@/services/endpoints/user';
import type { PolicyCondition, PolicyDecision, PolicyEvaluatePayload, PolicyRulePayload } from '@/types/policy-engine';

type DraftState = {
  ruleId: string;
  policyPath: string;
  name: string;
  description: string;
  effect: 'allow' | 'deny' | 'dispatch';
  target: string;
  priority: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  tags: string;
  conditionsText: string;
};

function emptyDraft(): DraftState {
  return {
    ruleId: '',
    policyPath: 'dispatch',
    name: '',
    description: '',
    effect: 'deny',
    target: '',
    priority: '100',
    enabled: true,
    conditionLogic: 'AND',
    tags: '',
    conditionsText: '[{"field":"lead.score","op":"gte","value":80}]',
  };
}

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

export default function PoliciesPage() {
  const t = useTranslations('settings.policyEngine');
  const common = useTranslations('common');
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [search, setSearch] = useState('');
  const [pathFilter, setPathFilter] = useState('all');
  const [effectFilter, setEffectFilter] = useState<'all' | 'allow' | 'deny' | 'dispatch'>('all');
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [notice, setNotice] = useState('');
  const [publishVersion, setPublishVersion] = useState('');
  const [publishNotes, setPublishNotes] = useState('');
  const [evaluatePolicyPath, setEvaluatePolicyPath] = useState('dispatch');
  const [evaluateInputText, setEvaluateInputText] = useState(
    JSON.stringify({ lead: { score: 82, blacklisted: false }, channel: 'wechat' }, null, 2),
  );
  const [defaultDecision, setDefaultDecision] = useState('deny');
  const [evalTrace, setEvalTrace] = useState(true);
  const [decisionResult, setDecisionResult] = useState<PolicyDecision | null>(null);
  const [decisionLogId, setDecisionLogId] = useState('');
  const conditionsPlaceholder = '[{"field":"lead.score","op":"gte","value":80}]';

  const currentUserQuery = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser, staleTime: 60_000 });
  const currentUser = currentUserQuery.data;
  const isAdmin = Boolean(
    currentUser?.isAdmin ||
      currentUser?.roles?.some((role) => String(role).toLowerCase() === 'admin'),
  );

  const policiesQuery = useQuery({
    queryKey: ['policy-engine', 'rules'],
    queryFn: fetchPolicies,
    enabled: Boolean(currentUser),
    staleTime: 30_000,
    retry: false,
  });
  const bundleQuery = useQuery({
    queryKey: ['policy-engine', 'bundle'],
    queryFn: fetchCurrentPolicyBundle,
    enabled: Boolean(currentUser),
    staleTime: 30_000,
    retry: false,
  });

  const rules = useMemo(() => policiesQuery.data?.items ?? [], [policiesQuery.data?.items]);
  const policyPaths = useMemo(() => Array.from(new Set(rules.map((item) => item.policy_path))).sort(), [rules]);
  const filteredRules = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (pathFilter !== 'all' && rule.policy_path !== pathFilter) return false;
      if (effectFilter !== 'all' && rule.effect !== effectFilter) return false;
      if (!normalized) return true;
      return [rule.rule_id, rule.name, rule.policy_path, rule.description, ...(rule.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [effectFilter, pathFilter, rules, search]);
  const selectedRule = filteredRules.find((item) => item.rule_id === selectedRuleId) ?? rules.find((item) => item.rule_id === selectedRuleId) ?? null;

  useEffect(() => {
    if (!filteredRules.length) {
      setSelectedRuleId('');
      return;
    }
    if (!selectedRuleId || !filteredRules.some((item) => item.rule_id === selectedRuleId)) {
      setSelectedRuleId(filteredRules[0].rule_id);
    }
  }, [filteredRules, selectedRuleId]);

  useEffect(() => {
    if (!selectedRule) {
      setDraft(emptyDraft());
      return;
    }
    setDraft({
      ruleId: selectedRule.rule_id,
      policyPath: selectedRule.policy_path,
      name: selectedRule.name,
      description: selectedRule.description || '',
      effect: selectedRule.effect === 'allow' || selectedRule.effect === 'dispatch' ? selectedRule.effect : 'deny',
      target: selectedRule.target || '',
      priority: String(selectedRule.priority ?? 100),
      enabled: selectedRule.enabled !== false,
      conditionLogic: selectedRule.condition_logic === 'OR' ? 'OR' : 'AND',
      tags: (selectedRule.tags || []).join(', '),
      conditionsText: JSON.stringify(selectedRule.conditions || [], null, 2),
    });
    setEvaluatePolicyPath(selectedRule.policy_path);
  }, [selectedRule]);

  const summary = {
    total: rules.length,
    enabled: rules.filter((item) => item.enabled !== false).length,
    paths: policyPaths.length,
    bundle: bundleQuery.data?.bundle?.version || '-',
  };
  const effectSummary = useMemo(
    () => ({
      allow: rules.filter((item) => item.effect === 'allow').length,
      deny: rules.filter((item) => item.effect === 'deny').length,
      dispatch: rules.filter((item) => item.effect === 'dispatch').length,
    }),
    [rules],
  );
  const parsedDraftConditions = useMemo(() => {
    try {
      const parsed = JSON.parse(draft.conditionsText) as PolicyCondition[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [draft.conditionsText]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let parsedConditions: PolicyCondition[] = [];
      try {
        const parsed = JSON.parse(draft.conditionsText);
        parsedConditions = Array.isArray(parsed) ? parsed : [];
      } catch {
        throw new Error(t('messages.invalidConditions'));
      }
      const payload: PolicyRulePayload = {
        rule_id: draft.ruleId.trim() || undefined,
        policy_path: draft.policyPath.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        conditions: parsedConditions,
        condition_logic: draft.conditionLogic,
        effect: draft.effect,
        target: draft.effect === 'dispatch' ? draft.target.trim() || undefined : undefined,
        priority: Number.isFinite(Number(draft.priority)) ? Number(draft.priority) : 100,
        enabled: draft.enabled,
        tags: draft.tags.split(',').map((item) => item.trim()).filter(Boolean),
      };
      return selectedRule ? updatePolicy(selectedRule.rule_id, payload) : createPolicy(payload);
    },
    onSuccess: async (result) => {
      await Promise.all([policiesQuery.refetch(), bundleQuery.refetch()]);
      setSelectedRuleId(result.rule.rule_id);
      const message = selectedRule ? t('editor.updateSuccess') : t('editor.createSuccess');
      setNotice(message);
      triggerSuccessToast(message);
    },
    onError: (error) => setNotice(String((error as Error).message || t('messages.requestFailed'))),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deletePolicy(selectedRuleId),
    onSuccess: async () => {
      await Promise.all([policiesQuery.refetch(), bundleQuery.refetch()]);
      setSelectedRuleId('');
      const message = t('editor.deleteSuccess');
      setNotice(message);
      triggerSuccessToast(message);
    },
    onError: (error) => setNotice(String((error as Error).message || t('messages.requestFailed'))),
  });

  const publishMutation = useMutation({
    mutationFn: async () => publishPolicyBundle({ version: publishVersion || undefined, notes: publishNotes || undefined, force: true }),
    onSuccess: async () => {
      await bundleQuery.refetch();
      const message = t('bundle.publishSuccess');
      setNotice(message);
      triggerSuccessToast(message);
    },
    onError: (error) => setNotice(String((error as Error).message || t('messages.requestFailed'))),
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      let parsedInput: PolicyEvaluatePayload['input'] = {};
      try {
        parsedInput = JSON.parse(evaluateInputText) as PolicyEvaluatePayload['input'];
      } catch {
        throw new Error(t('messages.invalidInput'));
      }
      return evaluatePolicy({
        policy_path: evaluatePolicyPath.trim() || 'dispatch',
        input: parsedInput,
        default_decision: defaultDecision.trim() || 'deny',
        trace: evalTrace,
      });
    },
    onSuccess: (result) => {
      setDecisionResult(result.decision);
      setDecisionLogId(result.decision_log_id);
      setNotice('');
    },
    onError: (error) => setNotice(String((error as Error).message || t('messages.requestFailed'))),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100"><Scale className="h-4 w-4" />{t('badge')}</div>
        <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{t('description')}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t('meta.tenant', { tenant: currentUser?.tenantId ?? '-' })}</span>
          <span>{t('meta.operator', { operator: currentUser?.name ?? currentUser?.id ?? '-' })}</span>
        </div>
      </section>

      {!isAdmin ? <section className="rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">{t('states.readonly')}</section> : null}
      {notice ? <section className="rounded-[24px] border border-white/10 bg-black/20 p-4 text-sm text-slate-200">{notice}</section> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard title={t('summary.rules')} value={String(summary.total)} />
        <StatusCard title={t('summary.enabled')} value={String(summary.enabled)} />
        <StatusCard title={t('summary.paths')} value={String(summary.paths)} />
        <StatusCard title={t('summary.bundleVersion')} value={summary.bundle} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard title={t('summary.allow')} value={String(effectSummary.allow)} />
        <StatusCard title={t('summary.deny')} value={String(effectSummary.deny)} />
        <StatusCard title={t('summary.dispatch')} value={String(effectSummary.dispatch)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-semibold text-white">{t('list.title')}</div><div className="mt-1 text-sm text-slate-400">{t('list.description')}</div></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { void policiesQuery.refetch(); void bundleQuery.refetch(); }} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200"><RefreshCw className={`h-4 w-4 ${policiesQuery.isFetching ? 'animate-spin' : ''}`} />{common('refresh')}</button>
              {isAdmin ? <button type="button" onClick={() => { setSelectedRuleId(''); setDraft(emptyDraft()); }} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100"><GitBranchPlus className="h-4 w-4" />{t('editor.create')}</button> : null}
            </div>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white" placeholder={t('list.searchPlaceholder')} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setPathFilter('all')} className={`rounded-full px-3 py-1.5 text-xs ${pathFilter === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{t('list.all')}</button>
            {policyPaths.map((path) => <button key={path} type="button" onClick={() => setPathFilter(path)} className={`rounded-full px-3 py-1.5 text-xs ${pathFilter === path ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{path}</button>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['all', 'allow', 'deny', 'dispatch'] as const).map((effect) => (
              <button key={effect} type="button" onClick={() => setEffectFilter(effect)} className={`rounded-full px-3 py-1.5 text-xs ${effectFilter === effect ? 'bg-cyan-400/15 text-cyan-100' : 'border border-white/10 bg-black/20 text-slate-300'}`}>{effect === 'all' ? t('list.effectsAll') : effect}</button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {filteredRules.length ? filteredRules.map((rule) => (
              <button key={rule.rule_id} type="button" onClick={() => setSelectedRuleId(rule.rule_id)} className={`w-full rounded-2xl border px-4 py-4 text-left ${selectedRuleId === rule.rule_id ? 'border-cyan-300/60 bg-cyan-500/10' : 'border-white/10 bg-black/20'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-sm font-semibold text-white">{rule.name}</div><div className="mt-1 text-xs text-slate-400">{rule.policy_path} · {t('list.priority')} {rule.priority}{rule.enabled ? '' : ` · ${t('list.disabled')}`}</div></div>
                  <div className={`rounded-full px-2.5 py-1 text-xs ${rule.effect === 'allow' ? 'bg-emerald-500/15 text-emerald-200' : rule.effect === 'dispatch' ? 'bg-cyan-500/15 text-cyan-100' : 'bg-rose-500/15 text-rose-200'}`}>{rule.effect}</div>
                </div>
              </button>
            )) : <EmptyState title={t('states.empty')} description={t('list.empty')} />}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-semibold text-white">{selectedRule ? t('editor.editing', { name: selectedRule.name }) : t('editor.title')}</div><div className="mt-1 text-sm text-slate-400">{selectedRule ? t('editor.readonly') : t('editor.create')}</div></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDraft(selectedRule ? {
                ruleId: selectedRule.rule_id, policyPath: selectedRule.policy_path, name: selectedRule.name, description: selectedRule.description || '', effect: selectedRule.effect === 'allow' || selectedRule.effect === 'dispatch' ? selectedRule.effect : 'deny', target: selectedRule.target || '', priority: String(selectedRule.priority ?? 100), enabled: selectedRule.enabled !== false, conditionLogic: selectedRule.condition_logic === 'OR' ? 'OR' : 'AND', tags: (selectedRule.tags || []).join(', '), conditionsText: JSON.stringify(selectedRule.conditions || [], null, 2),
              } : emptyDraft())} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200">{t('editor.reset')}</button>
              {selectedRule && isAdmin ? <button type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"><Trash2 className="h-4 w-4" />{deleteMutation.isPending ? t('editor.deleting') : t('editor.delete')}</button> : null}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">{t('fields.ruleId')}<input value={draft.ruleId} onChange={(event) => setDraft((prev) => ({ ...prev, ruleId: event.target.value }))} disabled={!isAdmin || Boolean(selectedRule)} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.ruleId')} /></label>
            <label className="text-sm text-slate-300">{t('fields.policyPath')}<input value={draft.policyPath} onChange={(event) => setDraft((prev) => ({ ...prev, policyPath: event.target.value }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.policyPath')} /></label>
            <label className="text-sm text-slate-300">{t('fields.name')}<input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.name')} /></label>
            <label className="text-sm text-slate-300">{t('fields.priority')}<input value={draft.priority} onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value }))} disabled={!isAdmin} type="number" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" /></label>
          </div>
          <label className="mt-4 block text-sm text-slate-300">{t('fields.descriptionField')}<textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} disabled={!isAdmin} rows={3} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.descriptionField')} /></label>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">{t('fields.effect')}<select value={draft.effect} onChange={(event) => setDraft((prev) => ({ ...prev, effect: event.target.value as DraftState['effect'] }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60"><option value="allow">allow</option><option value="deny">deny</option><option value="dispatch">dispatch</option></select></label>
            <label className="text-sm text-slate-300">{t('fields.target')}<input value={draft.target} onChange={(event) => setDraft((prev) => ({ ...prev, target: event.target.value }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.target')} /></label>
            <label className="text-sm text-slate-300">{t('fields.conditionLogic')}<select value={draft.conditionLogic} onChange={(event) => setDraft((prev) => ({ ...prev, conditionLogic: event.target.value as 'AND' | 'OR' }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60"><option value="AND">AND</option><option value="OR">OR</option></select></label>
            <label className="text-sm text-slate-300">{t('fields.tags')}<input value={draft.tags} onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))} disabled={!isAdmin} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-60" placeholder={t('placeholders.tags')} /></label>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))} disabled={!isAdmin} />{t('fields.enabled')}</label>
          <label className="mt-4 block text-sm text-slate-300">{t('fields.conditions')}<textarea value={draft.conditionsText} onChange={(event) => setDraft((prev) => ({ ...prev, conditionsText: event.target.value }))} disabled={!isAdmin} rows={10} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-sm text-white disabled:opacity-60" placeholder={conditionsPlaceholder} /></label>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('fields.conditionsPreview')}</div>
            <div className="mt-3 space-y-2">
              {parsedDraftConditions.length ? (
                parsedDraftConditions.map((condition, index) => (
                  <div key={`condition-${index}`} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200">
                    {String(condition.field || '-')} {String(condition.op || 'eq')} {JSON.stringify(condition.value ?? null)}
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-400">{t('fields.conditionsPreviewEmpty')}</div>
              )}
            </div>
          </div>
          {selectedRule ? <div className="mt-4 grid gap-3 md:grid-cols-2"><InfoRow label={common('created_at')} value={selectedRule.created_at} /><InfoRow label={common('status')} value={selectedRule.enabled ? common('enabled') : t('list.disabled')} /></div> : null}
          {isAdmin ? <button type="button" onClick={() => void saveMutation.mutateAsync()} disabled={saveMutation.isPending} className="mt-4 rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">{saveMutation.isPending ? t('editor.saving') : t('editor.save')}</button> : null}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-white">{t('bundle.title')}</div><div className="mt-1 text-sm text-slate-400">{t('bundle.description')}</div></div><BookLock className="h-4 w-4 text-slate-500" /></div>
          {bundleQuery.data?.bundle ? (
            <div className="mt-4 space-y-3">
              <InfoRow label={t('bundle.version')} value={bundleQuery.data.bundle.version} />
              <InfoRow label={t('bundle.checksum')} value={bundleQuery.data.bundle.checksum} />
              <InfoRow label={t('bundle.ruleCount')} value={String(bundleQuery.data.bundle.rule_count)} />
              <InfoRow label={t('bundle.publishedBy')} value={bundleQuery.data.bundle.published_by || '-'} />
              <InfoRow label={t('bundle.publishedAt')} value={bundleQuery.data.bundle.created_at} />
              <InfoRow label={t('bundle.notes')} value={bundleQuery.data.bundle.notes || '-'} />
            </div>
          ) : <div className="mt-4"><EmptyState title={t('states.loading')} description={t('states.emptyDescription')} /></div>}
          {isAdmin ? (
            <div className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <label className="block text-sm text-slate-300">{t('fields.version')}<input value={publishVersion} onChange={(event) => setPublishVersion(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white" /></label>
              <label className="block text-sm text-slate-300">{t('fields.notes')}<textarea value={publishNotes} onChange={(event) => setPublishNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white" placeholder={t('placeholders.notes')} /></label>
              <button type="button" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending} className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">{publishMutation.isPending ? t('bundle.publishing') : t('bundle.publish')}</button>
            </div>
          ) : null}
        </article>

        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-white">{t('evaluate.title')}</div><div className="mt-1 text-sm text-slate-400">{t('evaluate.description')}</div></div><button type="button" onClick={() => evaluateMutation.mutate()} disabled={evaluateMutation.isPending} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"><Play className="h-4 w-4" />{evaluateMutation.isPending ? t('evaluate.running') : t('evaluate.run')}</button></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">{t('fields.policyPath')}<input value={evaluatePolicyPath} onChange={(event) => setEvaluatePolicyPath(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white" /></label>
            <label className="text-sm text-slate-300">{t('evaluate.defaultDecision')}<input value={defaultDecision} onChange={(event) => setDefaultDecision(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white" /></label>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={evalTrace} onChange={(event) => setEvalTrace(event.target.checked)} />{t('evaluate.trace')}</label>
          <label className="mt-4 block text-sm text-slate-300">{t('evaluate.input')}<textarea value={evaluateInputText} onChange={(event) => setEvaluateInputText(event.target.value)} rows={10} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-sm text-white" /></label>
          {decisionResult ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-2"><InfoRow label={t('evaluate.decision')} value={decisionResult.decision} /><InfoRow label={t('evaluate.decisionLogId')} value={decisionLogId || '-'} /></div>
              <InfoRow label={t('evaluate.reason')} value={decisionResult.reason} />
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('evaluate.matchedRules')}</div><pre className="mt-3 overflow-x-auto text-xs text-slate-300">{JSON.stringify(decisionResult.matched_rules, null, 2)}</pre></div>
              {decisionResult.trace?.length ? <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500"><ShieldAlert className="h-4 w-4" />{t('evaluate.trace')}</div><pre className="mt-3 overflow-x-auto text-xs text-slate-300">{JSON.stringify(decisionResult.trace, null, 2)}</pre></div> : null}
            </div>
          ) : <div className="mt-4"><EmptyState title={t('evaluate.title')} description={t('evaluate.noResult')} /></div>}
        </article>
      </section>
    </div>
  );
}
