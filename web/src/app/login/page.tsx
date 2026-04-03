'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword } from '@/services/endpoints/auth';
import { resolveWhiteLabelConfig } from '@/services/endpoints/ai-subservice';
import type { WhiteLabelConfig } from '@/types/white-label';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [branding, setBranding] = useState<WhiteLabelConfig | null>(null);

  useEffect(() => {
    setMounted(true);
    const tenantFromQuery = new URLSearchParams(window.location.search).get('tenant') || undefined;
    void resolveWhiteLabelConfig({ tenant_id: tenantFromQuery, host: window.location.host })
      .then((res) => setBranding(res.config))
      .catch(() => setBranding(null));
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      triggerErrorToast('请输入账号和密码');
      return;
    }

    setLoading(true);
    try {
      const data = await loginWithPassword({
        username: username.trim(),
        password,
      });
      const token = data?.token ?? data?.access_token;
      if (!token) {
        triggerErrorToast('登录失败：后端未返回 token');
        return;
      }

      localStorage.setItem('clawcommerce_token', token);
      triggerSuccessToast('登录成功');
      router.push('/');
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败，请检查后端服务和账号密码';
      triggerErrorToast(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ backgroundColor: branding?.brand_bg_color || 'var(--claw-bg)' }}>
      <div
        className="relative z-10 w-full max-w-sm rounded-xl border-2 p-8 shadow-xl"
        style={{ borderColor: branding?.brand_primary_color || 'var(--claw-card-border)', backgroundColor: '#fff', color: '#1e293b' }}
      >
        <div className="mb-6 flex justify-center">
          {branding?.brand_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.brand_logo_url}
              alt={branding?.brand_name || 'ClawCommerce'}
              className="h-20 w-auto max-w-[220px] object-contain"
            />
          ) : (
            <Image
              src="/logo.png"
              alt={branding?.brand_name || 'ClawCommerce'}
              width={220}
              height={80}
              priority
              className="h-20 w-auto max-w-[220px] object-contain"
              style={{ width: 'auto', height: 'auto' }}
            />
          )}
        </div>

        <p className="mb-6 text-center text-base font-semibold" style={{ color: branding?.brand_primary_color || 'var(--claw-gold)' }}>
          {branding?.login_slogan || '登录龙虾元老院控制台'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="mb-1 block text-sm font-medium" style={{ color: 'var(--claw-caramel)' }}>
              账号
            </label>
            <input
              id="login-username"
              data-testid="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border-2 px-3 py-2 transition-colors placeholder:text-slate-400 focus:outline-none claw-input-focus"
              style={{ borderColor: '#94a3b8', backgroundColor: '#fff', color: '#0f172a' }}
              placeholder="手机号或邮箱"
              autoComplete="username"
              aria-label="账号"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium" style={{ color: 'var(--claw-caramel)' }}>
              密码
            </label>
            <input
              id="login-password"
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border-2 px-3 py-2 transition-colors placeholder:text-slate-400 focus:outline-none claw-input-focus"
              style={{ borderColor: '#94a3b8', backgroundColor: '#fff', color: '#0f172a' }}
              placeholder="密码"
              autoComplete="current-password"
              aria-label="密码"
            />
          </div>

          <button
            type="submit"
            data-testid="login-submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2.5 font-medium text-white shadow-md transition hover:opacity-95 disabled:opacity-50"
            style={{ background: branding?.brand_primary_color || 'var(--claw-gradient)' }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="mt-5 space-y-2 text-center text-sm">
          <Link href="/register" className="block text-amber-500 underline">
            创建账户
          </Link>
          <Link href="/forgot-password" className="block text-slate-500 underline">
            忘记密码
          </Link>
          <div className="pt-1 text-xs text-slate-400">
            <Link href="/landing" className="underline">产品介绍</Link>
            {' · '}
            <Link href="/pricing" className="underline">套餐价格</Link>
            {' · '}
            <Link href="/faq" className="underline">FAQ</Link>
          </div>
        </div>

        {!mounted ? null : (
          <p className="mt-4 text-center text-xs" style={{ color: 'var(--claw-text-secondary)' }}>
            当前仅支持真实账号登录，演示入口已关闭
            {branding?.hide_powered_by ? '' : ' · Powered by 龙虾池'}
          </p>
        )}
      </div>
    </div>
  );
}
