'use client';

import { useState } from 'react';

export function DeliveryHubSummaryButton({
  summary,
  label = '复制交付摘要',
  successMessage = '已复制交付摘要，可直接发给 QA / 老板 / 接手同学。',
  failureMessage = '复制失败，请检查浏览器剪贴板权限。',
  testId,
}: {
  summary: string;
  label?: string;
  successMessage?: string;
  failureMessage?: string;
  testId?: string;
}) {
  const [message, setMessage] = useState('');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(summary);
      setMessage(successMessage);
    } catch {
      setMessage(failureMessage);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid={testId}
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/25 bg-indigo-400/10 px-4 py-3 text-sm font-medium text-indigo-100"
      >
        {label}
      </button>
      {message ? <div className="text-xs text-cyan-200">{message}</div> : null}
    </div>
  );
}
