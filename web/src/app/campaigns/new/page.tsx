'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, BookOpen, ChevronDown, Rocket, Target, Users } from 'lucide-react';
import { useCreateCampaign } from '@/hooks/mutations/useCreateCampaign';
import { fetchLobsters } from '@/services/endpoints/ai-subservice';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

const PLATFORM_OPTIONS = [
  { id: 'douyin', label: '抖音', mark: 'DY' },
  { id: 'xiaohongshu', label: '小红书', mark: 'RED' },
  { id: 'kuaishou', label: '快手', mark: 'KS' },
  { id: 'wechat', label: '微信视频号', mark: 'WX' },
];

const LAUNCH_GOAL_OPTIONS = [
  {
    id: 'cold_start',
    label: '新号冷启动',
    desc: '从 0 粉账号开始，用内容测试和人群定位找到第一批精准用户。',
    badge: '7-14 天',
  },
  {
    id: 'reactivate',
    label: '老号激活',
    desc: '账号停更或流量下滑后，重新建立发布节奏，恢复系统推荐权重。',
    badge: '14-21 天',
  },
  {
    id: 'matrix_expand',
    label: '矩阵扩张',
    desc: '在已有主号基础上孵化子矩阵，扩大行业覆盖和内容测试面。',
    badge: '持续运营',
  },
];

const CONTENT_STYLE_OPTIONS = [
  {
    id: 'product_focus',
    label: '产品种草',
    desc: '围绕产品卖点和使用场景，快速建立品类认知。',
  },
  {
    id: 'persona_build',
    label: '人设建立',
    desc: '先建立可信人设，再承接转化，增强粉丝粘性和信任感。',
  },
  {
    id: 'local_service',
    label: '同城服务',
    desc: '聚焦本地地标、门店场景和服务半径，精准触达同城用户。',
  },
  {
    id: 'knowledge_share',
    label: '知识分享',
    desc: '输出行业干货，建立专业心智，吸引高意向用户。',
  },
];

type LobsterItem = {
  id: string;
  name: string;
  status?: string;
};

export default function NewCampaignPage() {
  const router = useRouter();
  const create = useCreateCampaign();

  const [lobsters, setLobsters] = useState<LobsterItem[]>([]);
  const [selectedLobsterId, setSelectedLobsterId] = useState('');
  const [lobsterOpen, setLobsterOpen] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['douyin']);
  const [launchGoal, setLaunchGoal] = useState('cold_start');
  const [contentStyle, setContentStyle] = useState('product_focus');
  const [accountName, setAccountName] = useState('');
  const [targetNiche, setTargetNiche] = useState('');
  const [dailyPostCount, setDailyPostCount] = useState(1);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchLobsters()
      .then((res) => {
        const list: LobsterItem[] = (res.items ?? []).map((item) => ({
          id: item.id,
          name: item.zh_name || item.display_name || item.name || item.id,
          status: item.status,
        }));
        setLobsters(list);
        setSelectedLobsterId((current) => current || list[0]?.id || '');
      })
      .catch(() => null);
  }, []);

  const selectedLobster = lobsters.find((item) => item.id === selectedLobsterId);
  const selectedGoal = LAUNCH_GOAL_OPTIONS.find((item) => item.id === launchGoal);
  const selectedStyle = CONTENT_STYLE_OPTIONS.find((item) => item.id === contentStyle);
  const selectedPlatformLabels = useMemo(
    () =>
      selectedPlatforms
        .map((platformId) => PLATFORM_OPTIONS.find((item) => item.id === platformId)?.label)
        .filter(Boolean)
        .join('、'),
    [selectedPlatforms],
  );

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((item) => item !== id) : prev) : [...prev, id],
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedLobsterId) {
      triggerErrorToast('请先选择关联主管');
      return;
    }

    create.mutate(
      {
        industry_template_id: `launch_${launchGoal}`,
        target_urls: [],
        content_strategy: {
          template_type: contentStyle,
          min_clips: dailyPostCount,
          max_clips: dailyPostCount * 2,
        },
        bind_accounts: selectedPlatforms,
      },
      {
        onSuccess: () => {
          triggerSuccessToast('起号任务已创建，已进入执行链路');
          router.push('/campaigns');
        },
        onError: (error) => {
          triggerErrorToast(error instanceof Error ? error.message : '创建失败');
        },
      },
    );
  };

  return (
    <div className="relative min-h-full text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.1),transparent_25%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-3xl space-y-5 p-6">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
            <Rocket className="h-3.5 w-3.5" />
            创建起号任务
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">把账号启动目标交给执行链路</h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            先选择负责承接的主管角色，再确定平台、目标和内容风格。提交后会进入 Campaign 执行链路，后续结果继续回到任务列表和线索跟进区。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <Link href="/operations/leads" className="rounded-full border border-white/10 px-3 py-1 hover:text-slate-300">
              线索管理
            </Link>
            <Link href="/crm/leads" className="rounded-full border border-white/10 px-3 py-1 hover:text-slate-300">
              CRM 线索
            </Link>
            <Link href="/campaigns" className="rounded-full border border-white/10 px-3 py-1 hover:text-slate-300">
              任务列表
            </Link>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Users className="h-4 w-4 text-cyan-300" />
              <div className="text-sm font-semibold text-white">1. 选择承接主管</div>
              <div className="ml-auto text-xs text-slate-500">任务结果会回到执行链路和复盘区</div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setLobsterOpen((value) => !value)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100"
              >
                <span>
                  {selectedLobster ? (
                    <>
                      <span className="text-cyan-200">{selectedLobster.name}</span>
                      <span className="ml-2 text-slate-500">{selectedLobster.id}</span>
                    </>
                  ) : (
                    <span className="text-slate-500">选择负责本次任务的主管角色</span>
                  )}
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${lobsterOpen ? 'rotate-180' : ''}`} />
              </button>

              {lobsterOpen ? (
                <div className="absolute top-full z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-2xl border border-white/12 bg-slate-900 shadow-xl">
                  {lobsters.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-500">暂无主管运行数据，请先确认龙虾主管服务可用。</div>
                  ) : (
                    lobsters.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedLobsterId(item.id);
                          setLobsterOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-white/[0.06] ${
                          selectedLobsterId === item.id ? 'text-cyan-200' : 'text-slate-200'
                        }`}
                      >
                        <span>{item.name}</span>
                        <span className="text-xs text-slate-500">{item.status || item.id}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {selectedLobster ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-2.5 text-xs text-cyan-200">
                <span>已关联：{selectedLobster.name}</span>
                <Link href={`/lobsters/${selectedLobster.id}`} className="ml-auto rounded-lg border border-cyan-400/20 px-2 py-1 hover:bg-cyan-400/10">
                  查看主管详情
                </Link>
              </div>
            ) : null}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-300" />
              <div className="text-sm font-semibold text-white">2. 选择发布平台</div>
              <div className="ml-auto text-xs text-slate-500">至少保留一个平台</div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PLATFORM_OPTIONS.map((platform) => {
                const active = selectedPlatforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => togglePlatform(platform.id)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border py-4 text-sm transition ${
                      active
                        ? 'border-amber-400/50 bg-amber-400/10 text-amber-100'
                        : 'border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20'
                    }`}
                  >
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] tracking-[0.14em]">{platform.mark}</span>
                    <span>{platform.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center gap-2">
              <Rocket className="h-4 w-4 text-emerald-300" />
              <div className="text-sm font-semibold text-white">3. 选择起号目标</div>
            </div>
            <div className="space-y-3">
              {LAUNCH_GOAL_OPTIONS.map((goal) => {
                const active = launchGoal === goal.id;
                return (
                  <label
                    key={goal.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${
                      active ? 'border-emerald-400/45 bg-emerald-400/10' : 'border-white/10 bg-slate-950/40 hover:border-white/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="launch_goal"
                      value={goal.id}
                      checked={active}
                      onChange={() => setLaunchGoal(goal.id)}
                      className="mt-0.5 h-4 w-4"
                      style={{ accentColor: '#10b981' }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                        {goal.label}
                        <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[11px] text-emerald-300">{goal.badge}</span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">{goal.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-cyan-300" />
              <div className="text-sm font-semibold text-white">4. 选择内容风格</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {CONTENT_STYLE_OPTIONS.map((style) => {
                const active = contentStyle === style.id;
                return (
                  <label
                    key={style.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${
                      active ? 'border-cyan-400/45 bg-cyan-400/10' : 'border-white/10 bg-slate-950/40 hover:border-white/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="content_style"
                      value={style.id}
                      checked={active}
                      onChange={() => setContentStyle(style.id)}
                      className="mt-0.5 h-4 w-4"
                      style={{ accentColor: '#22d3ee' }}
                    />
                    <div>
                      <div className="text-sm font-medium text-white">{style.label}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">{style.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 text-sm font-semibold text-white">5. 补充账号与执行参数</div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-400">账号名称，可选，用于区分同一客户的多个账号</span>
                <input
                  data-testid="campaign-new-account-name"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  placeholder="例如：品牌主号 / 本地生活矩阵 01"
                  className="w-full rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-400">目标细分领域，可选，让 AI 生成更精准的内容方向</span>
                <input
                  data-testid="campaign-new-target-niche"
                  value={targetNiche}
                  onChange={(event) => setTargetNiche(event.target.value)}
                  placeholder="例如：同城餐饮 / 家居装修 / 本地家政服务"
                  className="w-full rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40"
                />
              </label>
              <div>
                <div className="mb-1.5 block text-xs text-slate-400">每日发布条数</div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setDailyPostCount(count)}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm transition ${
                        dailyPostCount === count
                          ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100'
                          : 'border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-400">备注，可选，会作为额外上下文传给执行网络</span>
                <textarea
                  data-testid="campaign-new-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="例如：客户要求不出人脸，只做产品镜头；竞品账号参考 @xxx"
                  className="w-full rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-amber-400/20 bg-amber-400/5 p-5">
            <div className="text-sm font-semibold text-amber-100">任务摘要</div>
            <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
              <div>
                主管：<span className="text-white">{selectedLobster?.name || '未选择'}</span>
              </div>
              <div>
                平台：<span className="text-white">{selectedPlatformLabels || '-'}</span>
              </div>
              <div>
                目标：<span className="text-white">{selectedGoal?.label}</span>
              </div>
              <div>
                内容风格：<span className="text-white">{selectedStyle?.label}</span>
              </div>
              <div>
                每日发布：<span className="text-white">{dailyPostCount} 条</span>
              </div>
              <div>
                预计周期：<span className="text-white">{selectedGoal?.badge}</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-500">
              创建后任务会进入 Campaign 执行链路，执行结果、线索和复盘数据会继续回写到后续页面。
            </div>
          </section>

          <div className="flex items-center justify-between gap-4">
            <Link href="/campaigns" className="rounded-2xl border border-white/12 px-5 py-3 text-sm text-slate-300 hover:bg-white/[0.04]">
              取消
            </Link>
            <button
              data-testid="campaign-new-submit"
              type="submit"
              disabled={create.isPending || !selectedLobsterId}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 px-6 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {create.isPending ? '创建中...' : '创建起号任务'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
