'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { resetPassword } from '@/services/endpoints/auth';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

function ResetPasswordPageInner() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams?.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token.trim() || !password.trim()) {
      triggerErrorToast('请输入 token 和新密码');
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ token: token.trim(), password });
      triggerSuccessToast('密码已重置，请重新登录');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '重置失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] p-4">
      <div className="mx-auto flex min-h-screen max-w-md items-center">
        <div className="w-full rounded-2xl border border-slate-700 bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-semibold text-slate-900">重置密码</h1>
          <p className="mt-2 text-sm text-slate-500">
            输入通知中的 token 和新密码。后端会通过统一控制面代理到 AI 用户系统。
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="Reset token">
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="new password"
              />
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-slate-950 disabled:opacity-50"
            >
              {loading ? '重置中...' : '重置密码'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            <Link href="/login" className="text-amber-600 underline">返回登录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0F172A] p-6 text-sm text-slate-200">Loading reset form...</div>}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
