/**
 * ClawCommerce 配置向导 — 步骤式 ≤3 步
 * 文字原型：textdesign/prototypes/config-wizard.md
 * 数据来源：web/src/services/endpoints/campaign.ts (createCampaign)
 *
 * 使用：复制到 web/src/components/wizard/ConfigWizard.tsx
 * 并在页面中：<ConfigWizard onSuccess={() => router.push('/campaigns')} />
 */

'use client';

import { useState } from 'react';
import { useCreateCampaign } from '@/hooks/mutations/useCreateCampaign';
import { triggerSuccessToast, triggerErrorToast } from '@/services/api';

const TEMPLATES = [
  { id: '10秒爆款短视频', label: '10秒爆款短视频（3–6 分镜）', desc: '适合快节奏种草', min_clips: 3, max_clips: 6 },
  { id: '15秒故事带货', label: '15秒故事带货（7个分镜）', desc: '主推', min_clips: 5, max_clips: 9 },
  { id: '30秒深度种草', label: '30秒深度种草（10–18 分镜）', desc: '适合高客单', min_clips: 10, max_clips: 18 },
];

const EXAMPLE_URLS = [
  'https://v.douyin.com/example1',
  'https://v.douyin.com/example2',
  'https://v.douyin.com/example3',
];

const MAX_URLS = 20;

function parseUrls(text: string): string[] {
  return text
    .trim()
    .split(/[\n\s]+/)
    .filter(Boolean)
    .slice(0, MAX_URLS);
}

export function ConfigWizard({ onSuccess }: { onSuccess?: () => void }) {
  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState('15秒故事带货');
  const [urlsText, setUrlsText] = useState('');
  const [urlError, setUrlError] = useState('');
  const create = useCreateCampaign();

  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[1];
  const urls = parseUrls(urlsText);
  const urlCount = urls.length;

  const canGoStep2 = true;
  const canGoStep3 = urlCount >= 1;
  const applyExample = () => setUrlsText(EXAMPLE_URLS.join('\n'));

  const handleNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2) {
      setUrlError(urlCount < 1 ? '请至少添加 1 条有效链接' : '');
      if (urlCount >= 1) setStep(3);
    }
  };

  const handleSubmit = () => {
    create.mutate(
      {
        industry_template_id: template.id,
        target_urls: urls,
        content_strategy: {
          template_type: template.id,
          min_clips: template.min_clips,
          max_clips: template.max_clips,
        },
        bind_accounts: ['default'],
      },
      {
        onSuccess: () => {
          triggerSuccessToast('任务已分配至 OpenClaw 节点池');
          onSuccess?.();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
          const msg = err?.response?.data?.message ?? err?.message ?? '创建失败，请重试';
          triggerErrorToast(msg);
        },
      }
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* 步骤条 */}
      <div className="mb-8 flex items-center justify-between">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex flex-1 items-center">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                step > s ? 'bg-primary text-primary-foreground' : step === s ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
              }`}
              style={{ backgroundColor: step >= s ? '#3B82F6' : undefined, color: step > s || step === s ? '#fff' : undefined }}
            >
              {step > s ? '✓' : s}
            </div>
            {s < 3 && <div className="mx-2 h-0.5 flex-1 bg-gray-200 dark:bg-gray-700" />}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">选择行业与内容策略</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">一键套用成熟模板，无需写 Prompt</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`rounded-lg border-2 p-4 text-left transition ${
                  templateId === t.id
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800'
                }`}
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">{t.label}</span>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.desc}</p>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleNext}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            >
              下一步
            </button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">添加对标账号/视频链接</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">最多 20 条，每行一个或粘贴整段</p>
          </div>
          <div>
            <textarea
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              rows={6}
              placeholder="https://v.douyin.com/xxx"
              value={urlsText}
              onChange={(e) => {
                setUrlsText(e.target.value);
                setUrlError('');
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-gray-500">已输入 {urlCount} / {MAX_URLS} 条</span>
              <button type="button" onClick={applyExample} className="text-sm text-blue-500 hover:underline">
                套用示例链接
              </button>
            </div>
            {urlError && <p className="mt-1 text-sm text-red-600">{urlError}</p>}
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="rounded-md px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
              上一步
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoStep3}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              下一步
            </button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">确认配置并启动</h2>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-sm text-gray-600 dark:text-gray-300"><strong>行业模板：</strong>{template.label}</p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300"><strong>对标链接数：</strong>{urlCount} 条</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">策略：{template.label}，自动二创发布</p>
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(2)} className="rounded-md px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
              上一步
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={create.isPending}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {create.isPending ? '提交中…' : '🚀 立即启动全自动运营'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
