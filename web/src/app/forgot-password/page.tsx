'use client';

import Link from 'next/link';
import { useState } from 'react';
import { requestPasswordReset } from '@/services/endpoints/auth';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      triggerErrorToast('请输入注册邮箱');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      triggerSuccessToast('重置请求已提交，请查看邮件或通知 outbox');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '发送失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] p-4">
      <div className="mx-auto flex min-h-screen max-w-md items-center">
        <div className="w-full rounded-2xl border border-slate-700 bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-semibold text-slate-900">找回密码</h1>
          <p className="mt-2 text-sm text-slate-500">
            输入注册邮箱。开发态默认会把重置 token 写入 `dragon-senate-saas-v2/tmp/auth_notifications`，
            生产态切换 SMTP/短信即可。
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="name@example.com"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-slate-950 disabled:opacity-50"
            >
              {loading ? '提交中...' : '发送重置请求'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            <Link href="/reset-password" className="text-amber-600 underline">我已有 token，直接重置</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
