'use client';

/**
 * ClawCommerce 配置向导
 * ① 竞品雷达 ② 融梗与内容生成 ③ 多端矩阵挂载
 * React Hook Form + 完整 Mock 与深色样式
 */

import { useState } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';

// ——— Mock 数据与常量 ———
const INDUSTRIES = [
  { value: 'beauty', label: '美妆' },
  { value: 'digital', label: '数码' },
  { value: 'local', label: '本地生活' },
  { value: 'cross3c', label: '跨境3C' },
  { value: 'fashion', label: '服装' },
  { value: 'food', label: '食品' },
  { value: 'edu', label: '教育' },
  { value: 'other', label: '其他' },
];

const FORMAT_OPTIONS = [
  { value: '10s', label: '10秒爆款短视频', desc: '5 分镜，快节奏' },
  { value: '15s', label: '15秒故事带货', desc: '7 分镜，主推' },
  { value: '30s', label: '30秒深度种草', desc: '15 分镜，高客单' },
  { value: 'note', label: '图文笔记', desc: '小红书/微博' },
];

const AVATAR_OPTIONS = [
  { id: 'avatar1', name: '商务型', color: 'from-amber-600 to-amber-800', img: '👔' },
  { id: 'avatar2', name: '亲和型', color: 'from-emerald-600 to-teal-800', img: '🙂' },
  { id: 'avatar3', name: '潮流型', color: 'from-violet-600 to-purple-800', img: '✨' },
];

const PLATFORMS = [
  { id: 'wechat-video', name: '视频号', icon: '📺', desc: '微信生态' },
  { id: 'kuaishou', name: '快手', icon: '⚡', desc: '下沉市场' },
  { id: 'xiaohongshu', name: '小红书', icon: '📕', desc: '精准种草' },
  { id: 'tiktok', name: 'TikTok', icon: '🌍', desc: '出海' },
  { id: 'telegram', name: 'Telegram', icon: '✈️', desc: '私域引流' },
];

const MAX_URLS = 20;

type FormValues = {
  industry: string;
  competitorUrls: { value: string; status?: 'idle' | 'valid' | 'invalid' }[];
  dailyHotFusion: boolean;
  productSellingPoints: string;
  format: string;
  /** 合规选项：勾选后生成的视频/图片将执行去水印，产出无水印版本 */
  removeWatermark: boolean;
  avatarId: string;
  boundPlatforms: string[];
};

const defaultValues: FormValues = {
  industry: 'beauty',
  competitorUrls: [{ value: '', status: 'idle' }],
  dailyHotFusion: true,
  productSellingPoints: '',
  format: '15s',
  removeWatermark: false,
  avatarId: 'avatar2',
  boundPlatforms: [],
};

function validateUrl(url: string): 'valid' | 'invalid' {
  if (!url.trim()) return 'invalid';
  try {
    new URL(url.trim());
    return /^(https?:\/\/)/.test(url.trim()) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}

export function ConfigWizard({ onSuccess }: { onSuccess?: () => void }) {
  const [step, setStep] = useState(1);
  const [platformModal, setPlatformModal] = useState<string | null>(null);
  const [validatingIndex, setValidatingIndex] = useState<number | null>(null);

  const { control, watch, setValue, handleSubmit, formState: { errors } } = useForm<FormValues>({
    defaultValues,
    mode: 'onChange',
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'competitorUrls' });

  const competitorUrls = watch('competitorUrls');
  const urlCount = competitorUrls?.filter((r) => r.value?.trim()).length ?? 0;
  const canAddMore = (competitorUrls?.length ?? 0) < MAX_URLS;

  const runValidate = (index: number) => {
    const url = competitorUrls?.[index]?.value ?? '';
    setValidatingIndex(index);
    setTimeout(() => {
      const status = validateUrl(url);
      setValue(`competitorUrls.${index}.status`, status);
      setValidatingIndex(null);
    }, 600);
  };

  const addRow = () => {
    if (canAddMore) append({ value: '', status: 'idle' });
  };

  const stepStyle = (s: number) =>
    step > s
      ? { background: 'var(--claw-gradient)', color: 'white' }
      : step === s
        ? { background: 'var(--claw-gradient)', color: 'white' }
        : { backgroundColor: 'rgba(255,255,255,0.15)', color: '#94A3B8' };

  const onFinalSubmit = () => {
    onSuccess?.();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* 步骤条 */}
      <div className="mb-10 flex items-center justify-between">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex flex-1 items-center">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-lg transition"
              style={stepStyle(s)}
            >
              {step > s ? '✓' : s}
            </div>
            {s < 3 && (
              <div
                className="mx-3 h-1 flex-1 rounded-full opacity-40"
                style={{ backgroundColor: 'var(--claw-caramel)' }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: 竞品雷达配置 */}
      {step === 1 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl" style={{ color: 'var(--claw-gold)' }}>
              ① 竞品雷达配置
            </CardTitle>
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              动态竞品雷达与深度学习引擎 — 选择行业并添加对标账号，龙虾将每日静默拆解爆款。
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: '#E5A93D' }}>
                行业
              </label>
              <Controller
                control={control}
                name="industry"
                render={({ field }) => (
                  <select
                    {...field}
                    className="w-full rounded-lg border-2 bg-[#0F172A] px-4 py-3 text-[#F8FAFC] focus:outline-none claw-input-focus"
                    style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                  >
                    {INDUSTRIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>

            <div>
              <p className="mb-3 text-sm" style={{ color: '#94A3B8' }}>
                添加对标账号，龙虾引擎将每日为您拆解爆款密码。
              </p>
              <div className="space-y-3">
                {fields.map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(15,23,42,0.6)' }}
                  >
                    <input
                      className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
                      placeholder="https://v.douyin.com/xxx 或 小红书/快手主页链接"
                      value={competitorUrls?.[index]?.value ?? ''}
                      onChange={(e) => setValue(`competitorUrls.${index}.value`, e.target.value)}
                      onBlur={() => runValidate(index)}
                    />
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs"
                      title={
                        validatingIndex === index
                          ? '验证中'
                          : competitorUrls?.[index]?.status === 'valid'
                            ? '有效'
                            : competitorUrls?.[index]?.status === 'invalid'
                              ? '无效或为空'
                              : '点击失焦或验证'
                      }
                      style={{
                        backgroundColor:
                          validatingIndex === index
                            ? 'rgba(229,169,61,0.3)'
                            : competitorUrls?.[index]?.status === 'valid'
                              ? 'rgba(34,197,94,0.3)'
                              : competitorUrls?.[index]?.status === 'invalid'
                                ? 'rgba(239,68,68,0.25)'
                                : 'rgba(255,255,255,0.08)',
                        color:
                          competitorUrls?.[index]?.status === 'valid'
                            ? '#22c55e'
                            : competitorUrls?.[index]?.status === 'invalid'
                              ? '#ef4444'
                              : '#94A3B8',
                      }}
                    >
                      {validatingIndex === index ? '…' : competitorUrls?.[index]?.status === 'valid' ? '✓' : competitorUrls?.[index]?.status === 'invalid' ? '!' : '○'}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition hover:bg-red-500/20"
                      style={{ color: '#f87171' }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              {canAddMore && (
                <button
                  type="button"
                  onClick={addRow}
                  className="mt-3 rounded-lg border-2 border-dashed px-4 py-2 text-sm font-medium transition hover:border-[var(--claw-copper)] hover:bg-[var(--claw-gradient-soft)]"
                  style={{ borderColor: 'rgba(255,255,255,0.2)', color: 'var(--claw-caramel)' }}
                >
                  + 添加对标账号（{urlCount}/{MAX_URLS}）
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: 融梗与内容生成策略 */}
      {step === 2 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl" style={{ color: 'var(--claw-gold)' }}>
              ② 融梗与内容生成策略
            </CardTitle>
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              智能融梗与多模态生成 — 热点融合、剧本规格、数字人形象。
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                开启每日热点自动融合
              </span>
              <Controller
                control={control}
                name="dailyHotFusion"
                render={({ field }) => (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={field.value}
                    onClick={() => field.onChange(!field.value)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${field.value ? 'bg-[var(--claw-copper)]' : 'bg-[#475569]'}`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${field.value ? 'left-6' : 'left-1'}`}
                    />
                  </button>
                )}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: '#E5A93D' }}>
                主推产品核心卖点
              </label>
              <Controller
                control={control}
                name="productSellingPoints"
                render={({ field }) => (
                  <textarea
                    {...field}
                    rows={4}
                    placeholder="例如：成分安全、24小时持妆、敏感肌可用、性价比高…"
                    className="w-full rounded-lg border-2 bg-[#0F172A] px-4 py-3 text-[#F8FAFC] placeholder-[#64748B] focus:outline-none claw-input-focus"
                    style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                  />
                )}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: '#E5A93D' }}>
                生成规格
              </label>
              <Controller
                control={control}
                name="format"
                render={({ field }) => (
                  <select
                    {...field}
                    className="w-full rounded-lg border-2 bg-[#0F172A] px-4 py-3 text-[#F8FAFC] focus:outline-none claw-input-focus"
                    style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                  >
                    {FORMAT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} — {opt.desc}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <div>
                <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                  去除 AI 生成水印（合规选项）
                </span>
                <p className="mt-0.5 text-xs" style={{ color: '#94A3B8' }}>
                  勾选后，生成的视频/图片将执行去水印步骤，产出无水印版本
                </p>
              </div>
              <Controller
                control={control}
                name="removeWatermark"
                render={({ field }) => (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={field.value}
                    onClick={() => field.onChange(!field.value)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${field.value ? 'bg-[var(--claw-copper)]' : 'bg-[#475569]'}`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${field.value ? 'left-6' : 'left-1'}`}
                    />
                  </button>
                )}
              />
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium" style={{ color: '#E5A93D' }}>
                数字人形象
              </label>
              <Controller
                control={control}
                name="avatarId"
                render={({ field }) => (
                  <div className="grid grid-cols-3 gap-4">
                    {AVATAR_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => field.onChange(opt.id)}
                        className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition ${
                          field.value === opt.id ? 'ring-2 ring-[var(--claw-copper)]' : ''
                        }`}
                        style={{
                          borderColor: field.value === opt.id ? 'var(--claw-copper)' : 'rgba(255,255,255,0.1)',
                          backgroundColor: field.value === opt.id ? 'var(--claw-gradient-soft)' : 'transparent',
                        }}
                      >
                        <span
                          className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br text-3xl ${opt.color}`}
                        >
                          {opt.img}
                        </span>
                        <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                          {opt.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: 多端矩阵挂载 */}
      {step === 3 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl" style={{ color: 'var(--claw-gold)' }}>
              ③ 多端矩阵挂载
            </CardTitle>
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              一虾多吃 — 单节点多平台，环境隔离已开启，告别连坐封号。
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {PLATFORMS.map((p) => (
                <div
                  key={p.id}
                  className="flex cursor-pointer flex-col rounded-xl border-2 p-5 transition hover:border-[var(--claw-copper)] hover:bg-[var(--claw-gradient-soft)]"
                  style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                  onClick={() => setPlatformModal(p.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{p.icon}</span>
                    <div>
                      <div className="font-semibold" style={{ color: '#F8FAFC' }}>
                        {p.name}
                      </div>
                      <div className="text-xs" style={{ color: '#94A3B8' }}>
                        {p.desc}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                    <span>环境隔离：已开启</span>
                    <span>✅</span>
                  </div>
                  <div className="mt-2 text-sm" style={{ color: 'var(--claw-caramel)' }}>
                    点击添加该平台账号 →
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 底部导航 */}
      <div className="mt-10 flex items-center justify-between border-t pt-8" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          上一步
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => s + 1)}>下一步</Button>
        ) : (
          <Button onClick={handleSubmit(onFinalSubmit)}>一键下发至龙虾池</Button>
        )}
      </div>

      {/* 平台账号弹窗 */}
      <Dialog open={!!platformModal} onOpenChange={(open) => !open && setPlatformModal(null)}>
        <DialogContent className="p-0">
          <DialogHeader>
            <div className="relative pr-12">
              <DialogTitle>添加该平台账号</DialogTitle>
              <DialogClose onClose={() => setPlatformModal(null)} />
            </div>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              {PLATFORMS.find((p) => p.id === platformModal)?.name} — 模拟弹窗，实际对接时可填账号/授权。
            </p>
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <input
                type="text"
                placeholder="账号 / 主页链接"
                className="w-full bg-transparent py-2 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPlatformModal(null)}>取消</Button>
              <Button onClick={() => setPlatformModal(null)}>确定</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
