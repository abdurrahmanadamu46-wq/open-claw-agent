'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Layers3, ShieldCheck, Sparkles, Waypoints } from 'lucide-react';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';
import { previewPipelineMode } from '@/services/endpoints/ai-subservice';
import { previewIndustryWorkflow } from '@/services/endpoints/industry-workflow';
import {
  buildIndustryWorkflowRequest,
  clearIndustryWorkflowHandoff,
  getIndustryCategoryOption,
  storeIndustryWorkflowHandoff,
  type IndustryChannel,
  listIndustryCategoryOptions,
} from '@/lib/industry-workflow';

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const CHANNEL_LABELS: Record<IndustryChannel, string> = {
  douyin: 'Douyin',
  xiaohongshu: 'Xiaohongshu',
  kuaishou: 'Kuaishou',
  video_account: 'Video Account',
};

const categoryOptions = listIndustryCategoryOptions();

export default function IndustryWorkflowPage() {
  const router = useRouter();
  const [workflowId, setWorkflowId] = useState('industry-workflow-demo');
  const [categoryId, setCategoryId] = useState(categoryOptions[0]?.id ?? 'food_service');
  const [subIndustryId, setSubIndustryId] = useState(categoryOptions[0]?.subindustries[0]?.id ?? 'chinese_restaurant');
  const [brandName, setBrandName] = useState('龙虾池行业样板');
  const [tenantId, setTenantId] = useState('tenant_demo');
  const [bindAccountsText, setBindAccountsText] = useState('');
  const [painPointsText, setPainPointsText] = useState('发了内容没有有效私信\n评论很多但无法快速分辨高意向客户');
  const [solvedProblemsText, setSolvedProblemsText] = useState('把内容生产、发布、承接和转化做成闭环\n让高意向客户更快进入预约和电话推进');
  const [personaBackground, setPersonaBackground] = useState('长期服务本地商家增长与获客的行业顾问。');
  const [advantagesText, setAdvantagesText] = useState('不是单点 AI 工具，而是云边协同增长系统\n高风险动作默认审批、可审计、可回滚');
  const [callScoreThreshold, setCallScoreThreshold] = useState('85');
  const [selectedChannels, setSelectedChannels] = useState<IndustryChannel[]>([]);

  const category = useMemo(() => getIndustryCategoryOption(categoryId), [categoryId]);
  const subIndustryOptions = category?.subindustries ?? [];

  const request = useMemo(() => {
    const defaultChannels = category?.defaultChannels ?? [];
    return buildIndustryWorkflowRequest({
      workflowId,
      categoryId,
      subIndustryId,
      channels: selectedChannels.length ? selectedChannels : defaultChannels,
      callScoreThreshold: Number(callScoreThreshold) || 85,
      merchantProfile: {
        brandName,
        tenantId,
        bindAccounts: splitLines(bindAccountsText),
        customerPainPoints: splitLines(painPointsText),
        solvedProblems: splitLines(solvedProblemsText),
        personaBackground,
        competitiveAdvantages: splitLines(advantagesText),
      },
    });
  }, [
    advantagesText,
    bindAccountsText,
    brandName,
    callScoreThreshold,
    category?.defaultChannels,
    categoryId,
    painPointsText,
    personaBackground,
    selectedChannels,
    solvedProblemsText,
    subIndustryId,
    tenantId,
    workflowId,
  ]);

  const workflowPreviewQuery = useQuery({
    queryKey: ['industry-workflow', 'preview', request],
    queryFn: () => previewIndustryWorkflow(request),
    staleTime: 30 * 1000,
  });

  const blueprint = workflowPreviewQuery.data?.blueprint;
  const taskDescription = workflowPreviewQuery.data?.task_description ?? '';

  const modePreviewQuery = useQuery({
    queryKey: ['industry-workflow', 'mode-preview', request, taskDescription],
    queryFn: () =>
      previewPipelineMode({
        task_description: taskDescription,
        industry_tag: `${request.categoryId}.${request.subIndustryId}`,
        competitor_handles: request.merchantProfile.bindAccounts ?? [],
        edge_targets: [],
      }),
    enabled: taskDescription.trim().length > 0,
    staleTime: 30 * 1000,
  });

  function toggleChannel(channel: IndustryChannel) {
    setSelectedChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    );
  }

  function resetChannelsToDefault() {
    setSelectedChannels([]);
  }

  function sendToStrategySubmit() {
    if (!blueprint || !taskDescription.trim()) {
      return;
    }
    clearIndustryWorkflowHandoff();
    storeIndustryWorkflowHandoff({
      request,
      blueprint,
      taskDescription,
      createdAt: new Date().toISOString(),
    });
    router.push('/operations/strategy');
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="strategy"
        step="Mainline Stage 2A / Industry Workflow"
        title="Industry Workflow Intake"
        description="Collect the industry-specific merchant brief first, then turn it into a canonical IndustryWorkflowRequest and a blueprint preview before execution."
        previous={{ href: '/operations/strategy', label: 'Back To Strategy' }}
        next={{ href: '/operations/strategy', label: 'Use In Strategy Submit' }}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <HintCard icon={<Layers3 className="h-4 w-4" />} title="Canonical Request" description="This form builds a clean IndustryWorkflowRequest instead of hiding business facts inside a free-form prompt." />
        <HintCard icon={<Sparkles className="h-4 w-4" />} title="Blueprint Preview" description="Show the expected business steps, cloud outputs, edge outputs, and approval summary before anything runs." />
        <HintCard icon={<ShieldCheck className="h-4 w-4" />} title="Mode Preview" description="Feed the compiled merchant brief into the current pipeline mode preview so the mainline can explain sync/async and approval pressure." />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Industry Intake</div>

          <div className="space-y-4">
            <Field label="Workflow ID" value={workflowId} onChange={setWorkflowId} helper="Required. This becomes the canonical workflow request id." />

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Industry Category"
                value={categoryId}
                onChange={(value) => {
                  setCategoryId(value);
                  const nextCategory = getIndustryCategoryOption(value);
                  setSubIndustryId(nextCategory?.subindustries[0]?.id ?? '');
                  resetChannelsToDefault();
                }}
                options={categoryOptions.map((item) => ({ value: item.id, label: item.label }))}
              />
              <SelectField
                label="Sub Industry"
                value={subIndustryId}
                onChange={setSubIndustryId}
                options={subIndustryOptions.map((item) => ({ value: item.id, label: item.label }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Brand Name" value={brandName} onChange={setBrandName} helper="Recommended. Used in merchant digest and later cloud output naming." />
              <Field label="Tenant ID" value={tenantId} onChange={setTenantId} helper="Recommended. Used for workspace/tenant alignment." />
            </div>

            <Field
              label="Bind Accounts"
              value={bindAccountsText}
              onChange={setBindAccountsText}
              multiline
              helper="Recommended. One line per account handle. These feed mode preview and later edge/runtime dispatch."
            />

            <Field
              label="Customer Pain Points"
              value={painPointsText}
              onChange={setPainPointsText}
              multiline
              helper="Required. One line per pain point."
            />

            <Field
              label="Solved Problems"
              value={solvedProblemsText}
              onChange={setSolvedProblemsText}
              multiline
              helper="Required. One line per solved problem."
            />

            <Field
              label="Persona Background"
              value={personaBackground}
              onChange={setPersonaBackground}
              multiline
              helper="Required. This becomes part of the merchant profile and later copy/strategy context."
            />

            <Field
              label="Competitive Advantages"
              value={advantagesText}
              onChange={setAdvantagesText}
              multiline
              helper="Required. One line per advantage."
            />

            <Field
              label="Call Score Threshold"
              value={callScoreThreshold}
              onChange={setCallScoreThreshold}
              helper="Recommended. High-score leads above this threshold are candidates for outbound call approval."
            />

            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Channels</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(category?.defaultChannels ?? ['douyin', 'xiaohongshu']).map((channel) => {
                  const active = selectedChannels.length ? selectedChannels.includes(channel) : true;
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => toggleChannel(channel)}
                      className="rounded-full border px-3 py-1.5 text-xs transition"
                      style={{
                        borderColor: active ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)',
                        backgroundColor: active ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                        color: active ? '#cffafe' : '#cbd5e1',
                      }}
                    >
                      {CHANNEL_LABELS[channel]}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                If you do not manually choose channels, the category defaults are used.
              </div>
            </div>
          </div>
        </article>

        <article className="space-y-4">
          <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5">
            <div className="text-lg font-semibold text-white">Mainline Mode Preview</div>
            {modePreviewQuery.isLoading ? (
              <div className="mt-4 text-sm text-slate-400">Previewing current runtime mode...</div>
            ) : modePreviewQuery.isError ? (
              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
                Could not load pipeline preview. The request assembly is still available below.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <PreviewMetric label="Mode" value={String(modePreviewQuery.data?.preview?.mode || '-')} />
                <PreviewMetric label="Recommended Path" value={String(modePreviewQuery.data?.preview?.recommended_submit_path || '-')} />
                <PreviewMetric label="Estimated Duration" value={`${String(modePreviewQuery.data?.preview?.estimated_duration_sec || '-') }s`} />
                <PreviewMetric label="Approval Likely" value={modePreviewQuery.data?.preview?.approval_likely ? 'Yes' : 'No'} />
                <PreviewMetric label="Awakened Roles" value={String(modePreviewQuery.data?.preview?.awakened_roles?.length || 0)} />
                <PreviewMetric label="Estimated Artifacts" value={String(modePreviewQuery.data?.preview?.estimated_artifact_count || 0)} />
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-lg font-semibold text-white">IndustryWorkflowRequest</div>
            <pre className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-6 text-slate-200">
              {JSON.stringify(request, null, 2)}
            </pre>
          </section>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">Blueprint Summary</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewMetric label="Workflow ID" value={blueprint?.workflowId ?? 'Loading...'} />
            <PreviewMetric
              label="Industry"
              value={blueprint ? `${blueprint.industry.categoryLabel} / ${blueprint.industry.subIndustryLabel}` : 'Loading...'}
            />
            <PreviewMetric label="Channels" value={blueprint ? blueprint.channels.join(', ') : 'Loading...'} />
            <PreviewMetric label="Business Steps" value={String(blueprint?.businessSteps.length ?? 0)} />
            <PreviewMetric label="Cloud Outputs" value={String(blueprint?.cloudOutputs.length ?? 0)} />
            <PreviewMetric label="Edge Outputs" value={String(blueprint?.edgeOutputs.length ?? 0)} />
            <PreviewMetric label="Approval Steps" value={String(blueprint?.approvalSummary.length ?? 0)} />
            <PreviewMetric label="Topic Rubrics" value={String(blueprint?.topicScoringRubric.length ?? 0)} />
          </div>

          <div className="mt-5 space-y-3">
            <SummaryBlock
              title="Merchant Digest"
              items={
                blueprint
                  ? [
                      blueprint.merchantDigest.brandName,
                      ...blueprint.merchantDigest.customerPainPoints.slice(0, 2),
                      ...blueprint.merchantDigest.competitiveAdvantages.slice(0, 2),
                    ]
                  : ['Loading...']
              }
            />
            <SummaryBlock title="Cloud Outputs" items={blueprint?.cloudOutputs ?? ['Loading...']} />
            <SummaryBlock title="Edge Outputs" items={blueprint?.edgeOutputs ?? ['Loading...']} />
            <SummaryBlock
              title="Approval Summary"
              items={
                blueprint?.approvalSummary.map((item) => `${item.stepNumber}. ${item.stepId}: ${item.actions.join(', ')}`) ?? [
                  'Loading...',
                ]
              }
            />
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Business Steps</div>
          <div className="space-y-3">
            {(blueprint?.businessSteps ?? []).map((step) => (
              <div key={step.stepId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {step.stepNumber}. {step.label}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">{step.goal}</div>
                  </div>
                  <div className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                    {step.ownerRole}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <MiniField label="Bridge" value={step.runtimeAction.bridgeTarget} />
                  <MiniField label="Operation" value={step.runtimeAction.operation} />
                  <MiniField label="Approval" value={step.approval.required ? step.approval.actions.join(', ') : 'None'} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6">
        <div className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Use In Mainline</div>
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-medium text-white">Composed Task Description</div>
            <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{taskDescription}</pre>
          </div>
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
            <div className="text-sm leading-7 text-cyan-50">
              This page gives the main framework a stable place to collect industry facts first, then preview both the canonical workflow request and the current runtime mode before sending the mission into execution.
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={sendToStrategySubmit}
                disabled={!blueprint || !taskDescription.trim()}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                Use In Strategy Submit
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  helper,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper: string;
  multiline?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <div className="text-sm font-medium text-white">{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
        />
      )}
      <div className="text-xs leading-6 text-slate-400">{helper}</div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-2">
      <div className="text-sm font-medium text-white">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function SummaryBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-3 space-y-2 text-sm text-slate-200">
        {items.map((item, index) => (
          <div key={`${title}-${index}`}>• {item}</div>
        ))}
      </div>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-100">{value}</div>
    </div>
  );
}

function HintCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
        {icon}
      </div>
      <div className="mt-4 text-base font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{description}</div>
    </div>
  );
}
