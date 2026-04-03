'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { OnboardingStep1Form, type OnboardingStep1Values } from '@/components/onboarding/OnboardingStep1Form';
import { useTenant } from '@/contexts/TenantContext';
import { INDUSTRY_TAXONOMY, findSubIndustryByTag } from '@/lib/industry-taxonomy';
import {
  bootstrapIndustryKbProfiles,
  fetchCommercialReadiness,
  fetchIndustryStarterTasks,
  generateIndustryStarterTasks,
} from '@/services/endpoints/ai-subservice';
import { triggerSuccessToast } from '@/services/api';
import { MainlineStageHeader } from '@/components/business/MainlineStageHeader';

const PROFILE_CACHE_KEY = 'clawcommerce.onboard.profile.v1';
const STEP1_CACHE_KEY = 'clawcommerce.onboard.step1.v1';

type ClientProfile = {
  pain_points: string;
  solutions: string;
  persona_background: string;
  advantages: string;
};

type PipelineStep = {
  id: number;
  title: string;
  detail: string;
  owners: string[];
  output: string;
  hitl?: boolean;
};

const EMPTY_PROFILE: ClientProfile = {
  pain_points: '',
  solutions: '',
  persona_background: '',
  advantages: '',
};

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 1,
    title: '确认行业标签',
    detail: '先把行业选对，后续 starter kit、知识包和策略骨架都会跟着这个标签走。',
    owners: ['策士虾', '记忆治理'],
    output: '行业路由结果',
  },
  {
    id: 2,
    title: '补齐客户画像',
    detail: '把客户痛点、可交付结果、品牌背景和差异化优势说清楚。',
    owners: ['策士虾'],
    output: '客户画像档案',
  },
  {
    id: 3,
    title: '生成 starter tasks',
    detail: '系统按行业和画像生成首批可执行任务，避免团队从零写 SOP。',
    owners: ['触须虾', '策士虾', '点兵虾'],
    output: '首批任务列表',
  },
  {
    id: 4,
    title: '进入治理链路',
    detail: '高风险动作进入审批与风控检查，再决定是否自动执行。',
    owners: ['治理内核', '边界守门'],
    output: '审批与风控结论',
    hitl: true,
  },
  {
    id: 5,
    title: '边缘执行与线索回流',
    detail: '云端负责策略，边缘只做执行，结果回流后继续评分、跟进和复盘。',
    owners: ['点兵虾', '捕手虾', '算盘虾', '回访虾'],
    output: '执行回执与线索结果',
    hitl: true,
  },
];

function industryLabel(tag: string | undefined | null) {
  const row = findSubIndustryByTag(tag);
  if (row?.name) return row.name;
  return String(tag || '-');
}

function categoryLabel(categoryTag: string | undefined | null) {
  const row = INDUSTRY_TAXONOMY.find((item) => item.category_tag === categoryTag);
  if (row?.category_name) return row.category_name;
  return String(categoryTag || '-');
}

function ownerBadge(owner: string): string {
  if (owner.includes('触须虾')) return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200';
  if (owner.includes('策士虾')) return 'border-amber-400/35 bg-amber-500/10 text-amber-200';
  if (owner.includes('点兵虾')) return 'border-sky-400/35 bg-sky-500/10 text-sky-200';
  if (owner.includes('捕手虾')) return 'border-orange-400/35 bg-orange-500/10 text-orange-200';
  if (owner.includes('算盘虾')) return 'border-yellow-400/35 bg-yellow-500/10 text-yellow-200';
  if (owner.includes('回访虾')) return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200';
  if (owner.includes('治理内核') || owner.includes('边界守门')) return 'border-rose-400/35 bg-rose-500/10 text-rose-200';
  if (owner.includes('记忆治理')) return 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200';
  return 'border-slate-600 bg-slate-800/60 text-slate-200';
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[,\n，；;。|\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function getProfileCache(): Record<string, ClientProfile> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setProfileCache(data: Record<string, ClientProfile>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
}

function profileCompletion(profile: ClientProfile) {
  const fields = [profile.pain_points, profile.solutions, profile.persona_background, profile.advantages];
  const completed = fields.filter((item) => item.trim().length > 0).length;
  return {
    completed,
    total: fields.length,
    percent: Math.round((completed / fields.length) * 100),
  };
}

export default function OnboardPage() {
  const { currentTenant, currentTenantId, updateTenant } = useTenant();
  const defaultCategory = INDUSTRY_TAXONOMY[0]?.category_tag ?? '';
  const defaultIndustry = INDUSTRY_TAXONOMY[0]?.sub_industries[0]?.tag ?? '';

  const readinessQuery = useQuery({
    queryKey: ['onboard', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
  });

  const [selectedCategoryTag, setSelectedCategoryTag] = useState<string>(currentTenant?.industryCategoryTag || defaultCategory);
  const [selectedIndustryTag, setSelectedIndustryTag] = useState<string>(currentTenant?.industryType || defaultIndustry);
  const [profile, setProfile] = useState<ClientProfile>(EMPTY_PROFILE);
  const [savingIndustry, setSavingIndustry] = useState(false);
  const [starterKitBusy, setStarterKitBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const selectedCategory = useMemo(
    () => INDUSTRY_TAXONOMY.find((group) => group.category_tag === selectedCategoryTag) ?? INDUSTRY_TAXONOMY[0],
    [selectedCategoryTag],
  );
  const selectedIndustry = useMemo(() => findSubIndustryByTag(selectedIndustryTag), [selectedIndustryTag]);
  const profileKey = `${currentTenantId || 'default'}::${selectedIndustryTag || 'general'}`;
  const readiness = readinessQuery.data?.readiness;
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const readinessScore = Number(readiness?.score ?? 0);
  const launchBlocked = blockerCount > 0;
  const profileProgress = profileCompletion(profile);

  const starterKitQuery = useQuery({
    queryKey: ['onboard', 'starter-kit', currentTenantId, selectedIndustryTag],
    queryFn: () =>
      fetchIndustryStarterTasks({
        tenant_id: currentTenantId,
        industry_tag: selectedIndustryTag,
        status: 'accepted',
        limit: 12,
      }),
    enabled: !!currentTenantId && !!selectedIndustryTag,
    retry: false,
  });

  useEffect(() => {
    const cache = getProfileCache();
    setProfile(cache[profileKey] ?? EMPTY_PROFILE);
  }, [profileKey]);

  async function handleConfirmIndustry() {
    if (!currentTenantId || !selectedIndustryTag) {
      setSaveError('请先确认当前租户和目标行业。');
      return;
    }

    setSavingIndustry(true);
    setSaveError('');
    setSaveMessage('');

    try {
      updateTenant(currentTenantId, {
        industryType: selectedIndustryTag,
        industryCategoryTag: selectedCategoryTag,
      });
      const result = await bootstrapIndustryKbProfiles({
        tenant_id: currentTenantId,
        selected_industry_tag: selectedIndustryTag,
        force: true,
      });
      setSaveMessage(`已绑定行业：${industryLabel(selectedIndustryTag)}，并刷新 ${result.saved_count} 条行业知识配置。`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '行业知识初始化失败');
    } finally {
      setSavingIndustry(false);
    }
  }

  function handleSaveProfile() {
    if (!currentTenantId) {
      setProfileError('未找到当前租户，请先登录。');
      return;
    }

    setProfileError('');
    const cache = getProfileCache();
    cache[profileKey] = profile;
    setProfileCache(cache);

    updateTenant(currentTenantId, {
      businessKeywords: parseKeywords(`${profile.pain_points}\n${profile.solutions}\n${profile.advantages}`),
    });
    setProfileMessage('客户画像已保存，后续策略和 starter kit 会优先使用这些业务描述。');
  }

  function handleStartFlow() {
    if (!profile.pain_points || !profile.solutions || !profile.persona_background || !profile.advantages) {
      setProfileError('请先补齐客户画像，再启动完整流程。');
      return;
    }
    setProfileError('');
    setProfileMessage('首启准备已完成，接下来可以进入策略与任务主线。');
  }

  async function handleGenerateStarterKit() {
    if (!currentTenantId || !selectedIndustryTag) {
      setSaveError('请先确认租户和行业标签。');
      return;
    }

    setStarterKitBusy(true);
    setSaveError('');

    try {
      const result = await generateIndustryStarterTasks({
        tenant_id: currentTenantId,
        industry_tag: selectedIndustryTag,
        force: true,
        max_tasks: 12,
      });
      setSaveMessage(`Starter kit 已生成：${result.accepted_count} 条 accepted / ${result.rejected_count} 条 rejected。`);
      await starterKitQuery.refetch();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Starter kit 生成失败');
    } finally {
      setStarterKitBusy(false);
    }
  }

  async function handleOnboardingStep1(values: OnboardingStep1Values) {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(STEP1_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[currentTenantId || 'tenant_main'] = values;
      window.localStorage.setItem(STEP1_CACHE_KEY, JSON.stringify(cache));
    }
    if (currentTenantId) {
      updateTenant(currentTenantId, {
        name: values.brand_name,
        businessKeywords: parseKeywords(`${values.business_type}\n${values.team_size}\n${values.referral_code || ''}`),
      });
    }
    triggerSuccessToast('首启基础信息已保存');
  }

  return (
    <div className="space-y-6">
      <MainlineStageHeader
        currentKey="onboard"
        step="主线第 1 步 · 首启"
        title="先把行业和客户画像定清楚"
        description="首启页只做前置准备。先选行业，再补客户画像，最后生成第一批 starter tasks，把交付起点收得干净。"
        next={{ href: '/operations/strategy', label: '前往策略工作台' }}
        actions={
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            当前租户：{currentTenant?.name || currentTenantId || '未识别'}
          </div>
        }
      />

      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-white">0. 基础信息</h2>
          <p className="mt-1 text-sm text-slate-400">先用统一表单把代理商 / 团队的基础信息补齐，后面的行业和 starter kit 才会更贴近真实业务。</p>
        </div>
        <OnboardingStep1Form tenant={currentTenant} onNext={handleOnboardingStep1} />
      </section>

      <section
        className="rounded-[28px] border px-6 py-5"
        style={{
          borderColor: launchBlocked ? 'rgba(251,146,60,0.35)' : 'rgba(34,197,94,0.35)',
          background:
            'radial-gradient(circle at top right, rgba(34,211,238,0.14), transparent 34%), linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.9) 100%)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <ShieldCheck size={16} className="text-cyan-300" />
              商业化闸门
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
              在首启流程进入真实客户前，系统会统一检查支付、通知、Feishu callback 和 ICP readiness。首启不是孤立页面，而是对外交付前的前置闸门。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-center">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">score</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{readinessScore}</div>
            </div>
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                launchBlocked
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              }`}
            >
              {launchBlocked ? `${blockerCount} 个阻塞项` : '可以进入下一阶段'}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/settings/commercial-readiness" className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-cyan-200">
            打开就绪度面板
          </Link>
          <Link href="/pricing" className="rounded-xl border border-slate-600 px-4 py-2 text-slate-200">
            查看套餐
          </Link>
          <Link href="/settings/billing" className="rounded-xl border border-slate-600 px-4 py-2 text-slate-200">
            打开账单中心
          </Link>
        </div>
        {launchBlocked && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>当前仍有真实切真阻塞，建议先解决外部依赖，再把这套首启流程用于正式交付。</span>
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">1. 先选分类，再选行业</h2>
              <p className="mt-1 text-sm text-slate-400">行业很多时，不要平铺所有卡片。先缩小到当前分类，再在这一组里做选择。</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              当前：{industryLabel(selectedIndustryTag)}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {INDUSTRY_TAXONOMY.map((group) => {
              const active = selectedCategoryTag === group.category_tag;
              return (
                <button
                  key={group.category_tag}
                  type="button"
                  onClick={() => setSelectedCategoryTag(group.category_tag)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    active
                      ? 'border-cyan-400/45 bg-cyan-500/12 text-cyan-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {group.category_name || categoryLabel(group.category_tag)}
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-[24px] border border-white/8 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">{selectedCategory?.category_name || categoryLabel(selectedCategoryTag)}</div>
              <div className="text-xs text-slate-500">{selectedCategory?.sub_industries.length || 0} 个行业</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {selectedCategory?.sub_industries.map((sub) => {
                const active = selectedIndustryTag === sub.tag;
                return (
                  <button
                    key={sub.tag}
                    type="button"
                    onClick={() => {
                      setSelectedCategoryTag(selectedCategory.category_tag);
                      setSelectedIndustryTag(sub.tag);
                    }}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      active
                        ? 'border-cyan-400/55 bg-cyan-500/14 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]'
                        : 'border-slate-700 bg-slate-950/60 hover:border-cyan-400/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={`font-medium ${active ? 'text-cyan-100' : 'text-slate-100'}`}>
                          {sub.name || industryLabel(sub.tag)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{sub.tag}</div>
                      </div>
                      {active ? (
                        <span className="rounded-full border border-cyan-400/35 bg-cyan-500/12 px-2 py-1 text-[11px] text-cyan-100">
                          当前选中
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleConfirmIndustry()}
              disabled={savingIndustry}
              className="rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {savingIndustry ? '正在绑定行业...' : '绑定并初始化行业知识'}
            </button>
            {saveMessage ? <span className="text-xs text-emerald-300">{saveMessage}</span> : null}
            {saveError ? <span className="text-xs text-rose-300">{saveError}</span> : null}
          </div>
        </article>

        <article className="space-y-4">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">当前选择摘要</div>
                <div className="mt-1 text-sm text-slate-400">当前行业会决定 starter kit、行业知识包和策略骨架的加载方向。</div>
              </div>
              <div className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                {selectedIndustry?.schema?.industry_name || industryLabel(selectedIndustryTag)}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SummaryField label="行业分类" value={selectedCategory?.category_name || categoryLabel(selectedCategoryTag)} />
              <SummaryField label="行业标签" value={selectedIndustry?.name || industryLabel(selectedIndustryTag)} />
              <SummaryField label="知识加载" value="starter kit、行业知识包、策略骨架" />
              <SummaryField label="当前目标" value="先把行业语境绑定正确，再进入客户画像和首批任务生成" />
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">2. 客户画像</h2>
                <p className="mt-1 text-sm text-slate-400">把这块当成一张可填写的画像工作卡，而不是普通表单。</p>
              </div>
              <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-right">
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">完成度</div>
                <div className="mt-1 text-xl font-semibold text-white">{profileProgress.completed}/{profileProgress.total}</div>
              </div>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800/70">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${profileProgress.percent}%` }} />
            </div>

            <div className="mt-5 space-y-4">
              <ProfileModule
                title="客户常见痛点"
                helper="先写真实业务中的阻塞，而不是空泛问题。"
                value={profile.pain_points}
                onChange={(value) => setProfile((prev) => ({ ...prev, pain_points: value }))}
                placeholder="例如：获客成本高、到店少、成交流程慢、复购低"
              />
              <ProfileModule
                title="你能解决什么问题"
                helper="这部分会直接影响后续策略与 starter tasks 的目标表述。"
                value={profile.solutions}
                onChange={(value) => setProfile((prev) => ({ ...prev, solutions: value }))}
                placeholder="例如：7 天内跑通同城获客，把线索回访做成标准流程"
              />
              <ProfileModule
                title="品牌 / 团队背景"
                helper="告诉系统你是谁，避免生成过于泛化的表达。"
                value={profile.persona_background}
                onChange={(value) => setProfile((prev) => ({ ...prev, persona_background: value }))}
                placeholder="例如：本地商家增长顾问 / 连锁门店运营负责人 / 行业服务商"
                singleLine
              />
              <ProfileModule
                title="相对同行的优势"
                helper="这里会被系统用来强化你的交付差异。"
                value={profile.advantages}
                onChange={(value) => setProfile((prev) => ({ ...prev, advantages: value }))}
                placeholder="例如：行业知识更深、审批更稳、线索评分和跟进更系统"
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSaveProfile}
                className="rounded-2xl border border-cyan-400/35 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100"
              >
                保存客户画像
              </button>
              <button
                type="button"
                onClick={handleStartFlow}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950"
              >
                启动完整流程
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {profileMessage ? <div className="mt-3 text-xs text-emerald-300">{profileMessage}</div> : null}
            {profileError ? <div className="mt-3 text-xs text-rose-300">{profileError}</div> : null}
          </section>
        </article>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">3. starter kit</h2>
            <p className="mt-1 text-sm text-slate-400">每张卡都只保留“做什么、在哪里做、治理要求、值不值得现在就执行”。</p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateStarterKit()}
            disabled={starterKitBusy || !currentTenantId || !selectedIndustryTag}
            className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 disabled:opacity-50"
          >
            {starterKitBusy ? '正在生成...' : '生成首批任务'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(starterKitQuery.data?.items ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-400">
              当前还没有 accepted starter tasks。先确认行业标签，再生成第一批任务骨架。
            </div>
          ) : (
            (starterKitQuery.data?.items ?? []).map((item) => {
              const task = item.task || {};
              const verifier = item.verifier || {};
              return (
                <article key={item.task_key} className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{String(task.title ?? item.task_key)}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                        <span className="rounded-full border border-white/10 px-2 py-1">{String(task.channel ?? '-')}</span>
                        <span className="rounded-full border border-white/10 px-2 py-1">{String(task.touchpoint ?? '-')}</span>
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-cyan-100">
                          {String(task.governance_mode ?? '-')}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                      accepted
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <TaskRow label="目标" value={String(task.objective ?? '—')} />
                    <TaskRow label="执行判断" value="建议先进入任务列表，由点兵虾安排实际执行顺序。" />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <ScoreCell label="可执行" value={Number(verifier.feasibility_score ?? 0).toFixed(2)} />
                    <ScoreCell label="可观测" value={Number(verifier.observability_score ?? 0).toFixed(2)} />
                    <ScoreCell label="治理匹配" value={Number(verifier.governance_fit_score ?? 0).toFixed(2)} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/campaigns" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white">
                      进入任务列表
                    </Link>
                    <Link href="/operations/strategy" className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                      回看策略
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-slate-950/45 p-5">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-white">4. 首启之后怎么走</h2>
          <p className="mt-1 text-sm text-slate-400">压成更短的流程说明，只保留“做什么 / 谁负责 / 是否 HITL / 产出”。</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PIPELINE_STEPS.map((step) => (
            <article key={step.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">步骤 {step.id}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{step.title}</div>
                </div>
                {step.hitl ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200">
                    <AlertTriangle size={12} />
                    HITL
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
                    <CheckCircle2 size={12} />
                    自动
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-300">{step.detail}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {step.owners.map((owner) => (
                  <span key={owner} className={`rounded-full border px-2 py-1 text-[11px] ${ownerBadge(owner)}`}>
                    {owner}
                  </span>
                ))}
              </div>

              <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{step.output}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm leading-7 text-white">{value}</div>
    </div>
  );
}

function ProfileModule({
  title,
  helper,
  value,
  onChange,
  placeholder,
  singleLine = false,
}: {
  title: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  singleLine?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">{helper}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400">
          {value.trim() ? '已填写' : '待填写'}
        </div>
      </div>
      {singleLine ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-700/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
          placeholder={placeholder}
        />
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="w-full rounded-2xl border border-slate-700/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40"
          placeholder={placeholder}
        />
      )}
    </section>
  );
}

function TaskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm leading-6 text-slate-200">{value}</div>
    </div>
  );
}

function ScoreCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
