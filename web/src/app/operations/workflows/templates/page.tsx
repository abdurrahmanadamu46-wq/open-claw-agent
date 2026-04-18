'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus, RefreshCw, Sparkles } from 'lucide-react';
import { fetchWorkflowTemplates, useWorkflowTemplate as applyWorkflowTemplate } from '@/services/endpoints/ai-subservice';
import type { WorkflowTemplate } from '@/types/workflow-engine';

const BORDER = 'rgba(71,85,105,0.42)';
const PANEL_BG = '#16243b';

function normalizeError(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || fallback;
}

function durationLabel(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

export default function WorkflowTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');

  const loadTemplates = async () => {
    const data = await fetchWorkflowTemplates();
    setTemplates(data.templates || []);
  };

  useEffect(() => {
    void loadTemplates().catch((error) => setErrorText(normalizeError(error, '模板加载失败')));
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(templates.map((item) => item.category).filter(Boolean))).sort(),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return templates.filter((item) => {
      if (category && item.category !== category) return false;
      if (difficulty && item.difficulty !== difficulty) return false;
      if (!keyword) return true;
      return `${item.name} ${item.description} ${item.use_case} ${item.tags.join(' ')}`.toLowerCase().includes(keyword);
    });
  }, [category, difficulty, search, templates]);

  const featuredTemplates = useMemo(
    () => filteredTemplates.filter((item) => item.is_featured),
    [filteredTemplates],
  );

  const difficultyLabel = (value: string) => {
    if (value === 'advanced') return '高级';
    if (value === 'intermediate') return '进阶';
    return '入门';
  };

  const handleUseTemplate = async (template: WorkflowTemplate) => {
    const requestedName = window.prompt(`请输入新工作流名称，默认使用模板名：${template.name}`, template.name) ?? '';
    setBusyId(template.template_id);
    setErrorText('');
    try {
      const data = await applyWorkflowTemplate(template.template_id, {
        name: requestedName.trim() || template.name,
      });
      setNotice(`已创建工作流 ${data.workflow_id}`);
      router.push(`/operations/workflows/${encodeURIComponent(data.workflow_id)}/edit`);
    } catch (error) {
      setErrorText(normalizeError(error, '创建工作流失败'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(20,34,58,0.98), rgba(11,21,35,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Workflow Templates</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">工作流模板画廊</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">从官方精选模板起步，一键克隆为当前租户可编辑的工作流，降低新工作流的配置门槛。</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="模板总数" value={String(templates.length)} />
              <Metric label="精选模板" value={String(templates.filter((item) => item.is_featured).length)} />
              <Metric label="筛选结果" value={String(filteredTemplates.length)} />
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border p-5" style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">筛选器</div>
              <button
                type="button"
                onClick={() => void loadTemplates().catch((error) => setErrorText(normalizeError(error, '模板加载失败')))}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <Field label="搜索">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  placeholder="按名称、用途或标签搜索"
                />
              </Field>

              <Field label="分类">
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">全部分类</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="难度">
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">全部难度</option>
                  <option value="beginner">入门</option>
                  <option value="intermediate">进阶</option>
                  <option value="advanced">高级</option>
                </select>
              </Field>
            </div>

            {notice ? <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorText ? <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}
          </aside>

          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
                <Sparkles className="h-4 w-4" />
                精选模板
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {featuredTemplates.map((template) => (
                  <TemplateCard
                    key={template.template_id}
                    template={template}
                    busy={busyId === template.template_id}
                    onUse={() => void handleUseTemplate(template)}
                    useLabel="使用模板"
                    creatingLabel="创建中..."
                    featuredLabel="精选"
                    durationLabelText={`预计时长 ${durationLabel(template.estimated_duration_seconds)}`}
                    tokensLabelText={`预计 Tokens ${template.estimated_tokens}`}
                    useCountLabelText={`使用次数 ${template.use_count}`}
                    difficultyLabelText={difficultyLabel(template.difficulty)}
                  />
                ))}
                {!featuredTemplates.length ? <StateCard text="当前筛选条件下没有精选模板。" /> : null}
              </div>
            </section>

            <section>
              <div className="mb-3 text-sm font-semibold text-slate-200">全部模板</div>
              <div className="grid gap-4 lg:grid-cols-2">
                {filteredTemplates.map((template) => (
                  <TemplateCard
                    key={template.template_id}
                    template={template}
                    busy={busyId === template.template_id}
                    onUse={() => void handleUseTemplate(template)}
                    useLabel="使用模板"
                    creatingLabel="创建中..."
                    featuredLabel="精选"
                    durationLabelText={`预计时长 ${durationLabel(template.estimated_duration_seconds)}`}
                    tokensLabelText={`预计 Tokens ${template.estimated_tokens}`}
                    useCountLabelText={`使用次数 ${template.use_count}`}
                    difficultyLabelText={difficultyLabel(template.difficulty)}
                  />
                ))}
              </div>
              {!filteredTemplates.length ? <StateCard text="没有匹配当前筛选条件的模板。" /> : null}
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  busy,
  onUse,
  useLabel,
  creatingLabel,
  featuredLabel,
  durationLabelText,
  tokensLabelText,
  useCountLabelText,
  difficultyLabelText,
}: {
  template: WorkflowTemplate;
  busy: boolean;
  onUse: () => void;
  useLabel: string;
  creatingLabel: string;
  featuredLabel: string;
  durationLabelText: string;
  tokensLabelText: string;
  useCountLabelText: string;
  difficultyLabelText: string;
}) {
  return (
    <article className="rounded-[28px] border p-5" style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">{template.category}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">{difficultyLabelText}</span>
        {template.is_featured ? (
          <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs text-amber-200">{featuredLabel}</span>
        ) : null}
      </div>

      <div className="mt-4 text-xl font-semibold text-white">{template.name}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{template.description}</div>
      <div className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
        {template.use_case}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {template.lobsters_required.map((lobsterId) => (
          <span key={lobsterId} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">
            {lobsterId}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
        <span>{durationLabelText}</span>
        <span>{tokensLabelText}</span>
        <span>{useCountLabelText}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUse}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
        >
          <CopyPlus className="h-4 w-4" />
          {busy ? creatingLabel : useLabel}
        </button>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-center">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-slate-200">
      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function StateCard({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-slate-700/70 bg-slate-950/40 px-6 py-10 text-center text-sm text-slate-300">
      {text}
    </div>
  );
}
