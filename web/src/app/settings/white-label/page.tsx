'use client';

import { useEffect, useMemo, useState } from 'react';
import { Paintbrush, RefreshCw, Upload } from 'lucide-react';
import {
  deleteWhiteLabelConfig,
  fetchWhiteLabelConfig,
  updateWhiteLabelConfig,
  uploadWhiteLabelLogo,
} from '@/services/endpoints/ai-subservice';
import type { WhiteLabelConfig } from '@/types/white-label';
import { getCurrentUser } from '@/services/endpoints/user';

const BORDER = 'rgba(71,85,105,0.45)';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function WhiteLabelPage() {
  const [tenantId, setTenantId] = useState('tenant_main');
  const [config, setConfig] = useState<WhiteLabelConfig | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh(targetTenant?: string) {
    const tid = targetTenant || tenantId;
    setLoading(true);
    try {
      const [configRes] = await Promise.all([
        fetchWhiteLabelConfig(tid),
      ]);
      setConfig(configRes.config);
      setMessage('白标配置已同步。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取白标配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void getCurrentUser()
      .then((me) => {
        const tid = me?.tenantId || 'tenant_main';
        setTenantId(tid);
        void refresh(tid);
      })
      .catch(() => void refresh('tenant_main'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewVars = useMemo(() => ({
    backgroundColor: config?.brand_bg_color || '#0F172A',
    color: config?.brand_text_color || '#F8FAFC',
  }), [config]);

  async function handleSave() {
    if (!config) return;
    try {
      const res = await updateWhiteLabelConfig(tenantId, config);
      setConfig(res.config);
      setMessage('白标配置已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function handleDelete() {
    try {
      await deleteWhiteLabelConfig(tenantId);
      await refresh();
      setMessage('已恢复默认品牌配置。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置失败');
    }
  }

  async function handleLogoUpload(file: File | null) {
    if (!file) return;
    try {
      const content_base64 = await fileToBase64(file);
      const res = await uploadWhiteLabelLogo(tenantId, { filename: file.name, content_base64 });
      setConfig((prev) => prev ? { ...prev, brand_logo_url: res.url } : prev);
      setMessage('Logo 已上传。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Logo 上传失败');
    }
  }

  if (!config) {
    return <div className="p-6 text-slate-400">正在加载白标配置...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white">
              <Paintbrush className="h-5 w-5 text-cyan-300" />
              <h1 className="text-2xl font-semibold">白标配置</h1>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              面向代理商的品牌化登录和控制台主题配置。保存后，登录页和预览接口会立即使用新品牌信息。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
          >
            <RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
        <div className="mt-3 text-sm text-cyan-100">{message}</div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              品牌名称
              <input value={config.brand_name} onChange={(e) => setConfig({ ...config, brand_name: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              登录标语
              <input value={config.login_slogan || ''} onChange={(e) => setConfig({ ...config, login_slogan: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              主色
              <input type="color" value={config.brand_primary_color} onChange={(e) => setConfig({ ...config, brand_primary_color: e.target.value })} className="mt-2 h-11 w-full rounded-2xl border bg-slate-950 px-2 py-2" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              辅色
              <input type="color" value={config.brand_secondary_color} onChange={(e) => setConfig({ ...config, brand_secondary_color: e.target.value })} className="mt-2 h-11 w-full rounded-2xl border bg-slate-950 px-2 py-2" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              背景色
              <input type="color" value={config.brand_bg_color} onChange={(e) => setConfig({ ...config, brand_bg_color: e.target.value })} className="mt-2 h-11 w-full rounded-2xl border bg-slate-950 px-2 py-2" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              文本色
              <input type="color" value={config.brand_text_color} onChange={(e) => setConfig({ ...config, brand_text_color: e.target.value })} className="mt-2 h-11 w-full rounded-2xl border bg-slate-950 px-2 py-2" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              自定义域名
              <input value={config.custom_domain || ''} onChange={(e) => setConfig({ ...config, custom_domain: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              支持邮箱
              <input value={config.support_email || ''} onChange={(e) => setConfig({ ...config, support_email: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300 md:col-span-2">
              支持电话
              <input value={config.support_phone || ''} onChange={(e) => setConfig({ ...config, support_phone: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              Logo URL
              <input value={config.brand_logo_url || ''} onChange={(e) => setConfig({ ...config, brand_logo_url: e.target.value })} className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-white" style={{ borderColor: BORDER }} />
            </label>
            <label className="text-sm text-slate-300">
              上传 Logo
              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-cyan-400/30 bg-cyan-400/5 px-3 py-3 text-cyan-100">
                <Upload className="h-4 w-4" />
                选择图片
                <input type="file" accept="image/*" className="hidden" onChange={(e) => void handleLogoUpload(e.target.files?.[0] || null)} />
              </label>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={config.hide_powered_by}
                onChange={(e) => setConfig({ ...config, hide_powered_by: e.target.checked })}
              />
              隐藏 Powered by
            </label>
            <button type="button" onClick={() => void handleSave()} className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
              保存配置
            </button>
            <button type="button" onClick={() => void handleDelete()} className="rounded-2xl border border-rose-400/35 bg-rose-400/10 px-4 py-2 text-sm text-rose-100">
              恢复默认
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">实时预览</h2>
          <div className="mt-4 rounded-3xl border border-white/10 p-6" style={previewVars}>
            <div className="text-sm opacity-80">{config.brand_name}</div>
            <div className="mt-2 text-2xl font-semibold">登录页预览</div>
            <div className="mt-2 text-sm opacity-80">{config.login_slogan || '欢迎使用你的品牌化控制台'}</div>
            <div className="mt-6 rounded-2xl bg-white/10 p-4">
              <div className="mb-2 text-xs uppercase opacity-60">Button</div>
              <button type="button" className="rounded-2xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: config.brand_primary_color }}>
                品牌登录按钮
              </button>
            </div>
            <div className="mt-6 text-xs opacity-70">
              {config.hide_powered_by ? 'Powered by 已隐藏' : 'Powered by 龙虾池'}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
