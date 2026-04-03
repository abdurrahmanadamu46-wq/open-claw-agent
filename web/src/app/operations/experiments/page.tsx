'use client';

import { useEffect, useState } from 'react';
import {
  compareAiExperiments,
  createPromptExperiment,
  diffAiPromptVersions,
  fetchPromptExperimentReport,
  fetchPromptExperiments,
  listAiExperiments,
  promotePromptExperiment,
  stopPromptExperiment,
} from '@/services/endpoints/experiments';
import type { ExperimentReport, PromptExperiment } from '@/types/prompt-experiment';
import type { AiExperimentCompareResponse, AiExperimentSummary, AiPromptDiffResponse } from '@/types/ai-experiments';

const BORDER = 'rgba(71,85,105,0.45)';
const IDENTIFIER_KEYS = ['id', 'experiment_id', 'experimentId', 'experimentName', 'name', 'key', 'slug'];
const DETAIL_IGNORE_KEYS = [
  'id',
  'experiment_id',
  'experimentId',
  'experimentName',
  'name',
  'key',
  'slug',
  'status',
  'state',
  'started_at',
  'created_at',
  'updated_at',
];
const DETAILS_LIMIT = 3;

function formatValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

function getExperimentIdentifier(experiment: AiExperimentSummary, fallback: string) {
  for (const key of IDENTIFIER_KEYS) {
    const value = experiment[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return fallback;
}

function getExperimentLabel(experiment: AiExperimentSummary) {
  return (
    formatValue(experiment.experimentName) ||
    formatValue(experiment.name) ||
    formatValue(experiment.experiment_id) ||
    formatValue(experiment.id) ||
    'Unnamed experiment'
  );
}

function getExperimentMeta(experiment: AiExperimentSummary) {
  const parts: string[] = [];
  if (experiment.status) {
    parts.push(String(experiment.status));
  }
  if (experiment.state) {
    parts.push(String(experiment.state));
  }
  if (experiment.started_at) {
    parts.push(`Started ${String(experiment.started_at)}`);
  } else if (experiment.created_at) {
    parts.push(`Created ${String(experiment.created_at)}`);
  }
  if (experiment.updated_at) {
    parts.push(`Updated ${String(experiment.updated_at)}`);
  }
  return parts.join(' • ');
}

function getExperimentHighlights(experiment: AiExperimentSummary) {
  return Object.entries(experiment)
    .filter(([key]) => !DETAIL_IGNORE_KEYS.includes(key))
    .map(([key, value]) => ({ key, value: formatValue(value) }))
    .filter((entry) => entry.value)
    .slice(0, DETAILS_LIMIT)
    .map((entry) => `${entry.key}: ${entry.value}`);
}

export default function ExperimentsPage() {
  const [items, setItems] = useState<PromptExperiment[]>([]);
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({
    lobster_name: 'inkwriter',
    skill_name: 'voiceover',
    rollout_percent: 10,
    experiment_variant: 'v2',
    prompt_text: '',
    environment: 'prod' as 'dev' | 'staging' | 'prod',
  });

  const [genericExperiments, setGenericExperiments] = useState<AiExperimentSummary[]>([]);
  const [genericMessage, setGenericMessage] = useState('');
  const [genericLoading, setGenericLoading] = useState(false);
  const [compareSelection, setCompareSelection] = useState({ baseId: '', compareId: '' });
  const [compareResult, setCompareResult] = useState<AiExperimentCompareResponse | null>(null);
  const [compareFeedback, setCompareFeedback] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [promptDiffRequest, setPromptDiffRequest] = useState({ name: '', versionA: '', versionB: '' });
  const [promptDiffResult, setPromptDiffResult] = useState<AiPromptDiffResponse | null>(null);
  const [promptDiffFeedback, setPromptDiffFeedback] = useState('');

  async function refresh() {
    try {
      const data = await fetchPromptExperiments();
      setItems(data.items ?? []);
      setMessage('Prompt 实验已同步。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败');
    }
  }

  async function refreshGenericExperiments() {
    try {
      setGenericLoading(true);
      const payload = await listAiExperiments();
      const normalized = payload.experiments ?? payload.items ?? payload.data?.experiments ?? [];
      setGenericExperiments(normalized);
      setGenericMessage('OPIK 实验列表已同步。');
    } catch (error) {
      setGenericMessage(error instanceof Error ? error.message : '加载 OPIK 实验失败');
    } finally {
      setGenericLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void refreshGenericExperiments();
  }, []);

  async function handleCreate() {
    try {
      await createPromptExperiment(draft);
      setDraft((prev) => ({ ...prev, prompt_text: '' }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建实验失败');
    }
  }

  async function handleReport(flagName: string) {
    try {
      const data = await fetchPromptExperimentReport(flagName);
      setReport(data.report);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '获取报告失败');
    }
  }

  async function handlePromote(flagName: string, winnerVariant: string) {
    try {
      await promotePromptExperiment(flagName, winnerVariant);
      await refresh();
      await handleReport(flagName);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '升级失败');
    }
  }

  async function handleStop(flagName: string) {
    try {
      await stopPromptExperiment(flagName);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停止失败');
    }
  }

  async function handleCompare() {
    if (!compareSelection.baseId || !compareSelection.compareId) {
      setCompareFeedback('请选择两个实验进行对比。');
      setCompareResult(null);
      return;
    }
    try {
      setCompareFeedback('');
      setCompareLoading(true);
      const data = await compareAiExperiments({
        a: compareSelection.baseId,
        b: compareSelection.compareId,
      });
      setCompareResult(data);
      setCompareFeedback('实验对比已完成。');
    } catch (error) {
      setCompareFeedback(error instanceof Error ? error.message : '实验对比失败');
    } finally {
      setCompareLoading(false);
    }
  }

  async function handlePromptDiff() {
    const normalizedName = promptDiffRequest.name.trim();
    if (!normalizedName) {
      setPromptDiffFeedback('Prompt 名称是必填项。');
      return;
    }
    try {
      setPromptDiffFeedback('');
      setPromptDiffResult(null);
      const payload = {
        version_a: promptDiffRequest.versionA.trim() || undefined,
        version_b: promptDiffRequest.versionB.trim() || undefined,
      };
      const data = await diffAiPromptVersions(normalizedName, payload);
      setPromptDiffResult(data);
      setPromptDiffFeedback('Prompt 差异已生成。');
    } catch (error) {
      setPromptDiffFeedback(error instanceof Error ? error.message : 'Prompt Diff 失败');
    }
  }

  const normalizedExperiments = genericExperiments.map((experiment, index) => ({
    experiment,
    id: getExperimentIdentifier(experiment, `exp-${index}`),
  }));

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <h1 className="text-2xl font-semibold text-white">Prompt Experiments</h1>
        <p className="mt-2 text-sm text-slate-300">
          通过 Prompt 实验向不同客户灰度投放，评估结果后决定是否全量推广。
        </p>
        <div className="mt-3 text-sm text-cyan-100">{message}</div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <h2 className="text-lg font-semibold text-white">创建 Prompt 实验</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <input
            value={draft.lobster_name}
            onChange={(e) => setDraft((prev) => ({ ...prev, lobster_name: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-white"
            style={{ borderColor: BORDER }}
            placeholder="lobster"
          />
          <input
            value={draft.skill_name}
            onChange={(e) => setDraft((prev) => ({ ...prev, skill_name: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-white"
            style={{ borderColor: BORDER }}
            placeholder="skill"
          />
          <input
            type="number"
            value={draft.rollout_percent}
            onChange={(e) => setDraft((prev) => ({ ...prev, rollout_percent: Number(e.target.value || 0) }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-white"
            style={{ borderColor: BORDER }}
            placeholder="10"
          />
          <input
            value={draft.experiment_variant}
            onChange={(e) => setDraft((prev) => ({ ...prev, experiment_variant: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-white"
            style={{ borderColor: BORDER }}
            placeholder="v2"
          />
        </div>
        <textarea
          value={draft.prompt_text}
          onChange={(e) => setDraft((prev) => ({ ...prev, prompt_text: e.target.value }))}
          rows={8}
          className="mt-4 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white"
          style={{ borderColor: BORDER }}
          placeholder="输入实验使用的 prompt 内容"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="mt-4 rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
        >
          创建实验
        </button>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">实验列表</h2>
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <div key={item.flag_name} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">{item.flag_name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {item.lobster_name} / {item.skill_name} 状态 {item.status}
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleReport(item.flag_name)}
                    className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200"
                  >
                    查看报告
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePromote(item.flag_name, item.variants?.[0]?.name || 'v2')}
                    className="rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-100"
                  >
                    推广最新版本
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStop(item.flag_name)}
                    className="rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-1.5 text-sm text-rose-100"
                  >
                    停止实验
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">实验报告</h2>
          {report ? (
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950/50 p-4 text-xs text-slate-200">
              {JSON.stringify(report, null, 2)}
            </pre>
          ) : (
            <div className="mt-4 text-sm text-slate-400">
              选择一个实验后查看投入产出数据和最佳变量。
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">OPIK Experiments</h2>
            <p className="text-sm text-slate-300">通用实验列表，与即将上线的 OPIK 后端保持同步。</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshGenericExperiments()}
            disabled={genericLoading}
            className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
          >
            {genericLoading ? '同步中...' : '刷新列表'}
          </button>
        </div>
        {genericMessage && <div className="text-xs text-cyan-100">{genericMessage}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          {normalizedExperiments.length ? (
            normalizedExperiments.map(({ id, experiment }) => (
              <div key={id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">{getExperimentLabel(experiment)}</div>
                <div className="text-xs text-slate-400">ID: {id}</div>
                {getExperimentMeta(experiment) && (
                  <div className="mt-1 text-xs text-slate-400">{getExperimentMeta(experiment)}</div>
                )}
                <div className="mt-2 space-y-1 text-xs text-slate-300">
                  {getExperimentHighlights(experiment).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="md:col-span-2 rounded-2xl border border-dashed border-white/20 p-4 text-sm text-slate-400">
              暂无通用实验记录，可点击刷新加载。
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <h3 className="text-sm font-semibold text-white">实验对比</h3>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <select
              value={compareSelection.baseId}
              onChange={(e) => setCompareSelection((prev) => ({ ...prev, baseId: e.target.value }))}
              className="flex-1 rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
              style={{ borderColor: BORDER }}
            >
              <option value="">选择基础实验</option>
              {normalizedExperiments.map(({ id, experiment }) => (
                <option key={`base-${id}`} value={id}>
                  {getExperimentLabel(experiment)}
                </option>
              ))}
            </select>
            <select
              value={compareSelection.compareId}
              onChange={(e) => setCompareSelection((prev) => ({ ...prev, compareId: e.target.value }))}
              className="flex-1 rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
              style={{ borderColor: BORDER }}
            >
              <option value="">选择对比实验</option>
              {normalizedExperiments.map(({ id, experiment }) => (
                <option key={`compare-${id}`} value={id}>
                  {getExperimentLabel(experiment)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCompare()}
              disabled={compareLoading}
              className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 disabled:opacity-60"
            >
              {compareLoading ? '对比中...' : '开始对比'}
            </button>
          </div>
          {compareFeedback && <div className="mt-2 text-xs text-cyan-100">{compareFeedback}</div>}
          {compareResult ? (
            <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-900/70 p-4 text-xs text-slate-200">
              {JSON.stringify(compareResult, null, 2)}
            </pre>
          ) : (
            <div className="mt-3 text-xs text-slate-400">选择两个实验后将自动显示差异结果。</div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Prompt Diff</h2>
            <p className="text-sm text-slate-300">对比 Prompt 不同版本的差异，辅助审查。</p>
          </div>
          <button
            type="button"
            onClick={() => void handlePromptDiff()}
            className="rounded-2xl border border-emerald-400/35 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100"
          >
            生成 Diff
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <input
            value={promptDiffRequest.name}
            onChange={(e) => setPromptDiffRequest((prev) => ({ ...prev, name: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
            style={{ borderColor: BORDER }}
            placeholder="Prompt 名称"
          />
          <input
            value={promptDiffRequest.versionA}
            onChange={(e) => setPromptDiffRequest((prev) => ({ ...prev, versionA: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
            style={{ borderColor: BORDER }}
            placeholder="版本 A"
          />
          <input
            value={promptDiffRequest.versionB}
            onChange={(e) => setPromptDiffRequest((prev) => ({ ...prev, versionB: e.target.value }))}
            className="rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
            style={{ borderColor: BORDER }}
            placeholder="版本 B"
          />
        </div>
        {promptDiffFeedback && <div className="text-xs text-cyan-100">{promptDiffFeedback}</div>}
        {promptDiffResult ? (
          <pre className="mt-2 overflow-x-auto rounded-2xl bg-slate-900/70 p-4 text-xs text-slate-200">
            {JSON.stringify(promptDiffResult, null, 2)}
          </pre>
        ) : (
          <div className="mt-2 text-xs text-slate-400">填写 Prompt 名称后点击「生成 Diff」。</div>
        )}
      </section>
    </div>
  );
}
