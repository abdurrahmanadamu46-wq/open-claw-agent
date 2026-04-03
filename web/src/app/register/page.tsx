'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { registerUser } from '@/services/endpoints/auth';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      triggerErrorToast('请输入邮箱和密码');
      return;
    }
    setLoading(true);
    try {
      await registerUser({
        email: email.trim(),
        password,
        username: username.trim() || undefined,
      });
      triggerSuccessToast('注册成功，请使用新账号登录');
      router.push('/login');
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] p-4">
      <div className="mx-auto flex min-h-screen max-w-md items-center">
        <div className="w-full rounded-2xl border border-slate-700 bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-semibold text-slate-900">注册龙虾池账户</h1>
          <p className="mt-2 text-sm text-slate-500">
            创建后即可进入控制台、查看套餐、启动试用并进入后续订阅流程。
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="邮箱">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="name@example.com"
              />
            </Field>
            <Field label="用户名">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="可选，默认取邮箱前缀"
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                placeholder="至少 8 位"
              />
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-slate-950 disabled:opacity-50"
            >
              {loading ? '注册中...' : '注册'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            已有账户？
            {' '}
            <Link href="/login" className="text-amber-600 underline">去登录</Link>
          </div>
        </div>
      </div>
    </div>
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
