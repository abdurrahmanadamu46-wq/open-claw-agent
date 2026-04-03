'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateCampaign } from '@/hooks/mutations/useCreateCampaign';
import { Button } from '@/components/ui/Button';
import { triggerSuccessToast } from '@/services/api';

const STRATEGY_OPTIONS = [
  { id: '10秒短打', label: '10 秒爆款短视频（3-6 分镜）', min_clips: 3, max_clips: 6 },
  { id: '15秒带货', label: '15 秒故事带货（5-9 分镜）', min_clips: 5, max_clips: 9 },
  { id: '30秒深种草', label: '30 秒深度种草（10-18 分镜）', min_clips: 10, max_clips: 18 },
];

export default function NewCampaignPage() {
  const router = useRouter();
  const [targetUrlsText, setTargetUrlsText] = useState('');
  const [strategyId, setStrategyId] = useState('15秒带货');
  const create = useCreateCampaign();

  const strategy = useMemo(
    () => STRATEGY_OPTIONS.find((s) => s.id === strategyId) ?? STRATEGY_OPTIONS[1],
    [strategyId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const urls = targetUrlsText
      .trim()
      .split(/[\n\s]+/)
      .filter(Boolean);

    if (urls.length === 0) {
      return;
    }

    create.mutate(
      {
        industry_template_id: strategy.id,
        target_urls: urls.slice(0, 20),
        content_strategy: {
          template_type: strategy.id,
          min_clips: strategy.min_clips,
          max_clips: strategy.max_clips,
        },
        bind_accounts: ['default'],
      },
      {
        onSuccess: () => {
          triggerSuccessToast('任务已分配到边缘节点');
          router.push('/campaigns');
        },
      },
    );
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.1),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-3xl space-y-6 p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">新建运营任务</h1>
          <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-300 md:text-base">
            这页的重点不是填很多表单，而是把“对标链接 + 策略模板”快速收好，然后把任务安全地分配进执行网络。
          </p>
        </section>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_-40px_rgba(2,6,23,0.7)]"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              对标链接
            </label>
            <textarea
              data-testid="campaign-new-target-urls"
              className="w-full rounded-2xl border border-white/12 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none"
              rows={5}
              placeholder={'https://v.douyin.com/xxx\nhttps://v.douyin.com/yyy\nhttps://v.douyin.com/zzz'}
              value={targetUrlsText}
              onChange={(e) => setTargetUrlsText(e.target.value)}
            />
            <div className="mt-2 text-xs text-slate-500">每行一个，最多 20 个。系统会用这些链接生成可执行的对标任务。</div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              策略模板
            </label>
            <div className="space-y-3">
              {STRATEGY_OPTIONS.map((opt) => (
                <label key={opt.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
                  <input
                    type="radio"
                    name="strategy"
                    value={opt.id}
                    checked={strategyId === opt.id}
                    onChange={() => setStrategyId(opt.id)}
                    className="h-4 w-4"
                    style={{ accentColor: 'var(--claw-copper)' }}
                  />
                  <span className="text-sm text-slate-100">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4 text-sm text-slate-300">
            当前策略将生成 <span className="font-medium text-slate-100">{strategy.min_clips}</span> 到{' '}
            <span className="font-medium text-slate-100">{strategy.max_clips}</span> 个分镜，适合用来快速启动第一轮内容与分发动作。
          </div>

          <div className="flex justify-end">
            <Button
              data-testid="campaign-new-submit"
              type="submit"
              disabled={create.isPending || !targetUrlsText.trim()}
            >
              立即启动任务
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
