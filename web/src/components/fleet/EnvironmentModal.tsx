'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import type {
  BrowserEnvironment,
  EnvironmentPlatform,
  FingerprintEngine,
} from '@/types/environment';
import {
  ENVIRONMENT_PLATFORM_LABELS,
  FINGERPRINT_ENGINE_LABELS,
} from '@/types/environment';

const CARD_BG = '#1E293B';
const BORDER = 'rgba(255,255,255,0.1)';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

export interface EnvironmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑时传入，新建时 null */
  initial: BrowserEnvironment | null;
  onSave: (env: Omit<BrowserEnvironment, 'id' | 'updatedAt'> & { id?: string }) => void;
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span title={text} className="inline-flex items-center gap-1">
      {children}
      <span className="cursor-help text-xs opacity-60" aria-hidden>ⓘ</span>
    </span>
  );
}

export function EnvironmentModal({
  open,
  onOpenChange,
  initial,
  onSave,
}: EnvironmentModalProps) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<EnvironmentPlatform>('xiaohongshu');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyTesting, setProxyTesting] = useState(false);
  const [fingerprintEngine, setFingerprintEngine] = useState<FingerprintEngine>('standard');
  const [fingerprintOs, setFingerprintOs] = useState<'win' | 'mac'>('win');
  const [fingerprintBrowser, setFingerprintBrowser] = useState<'chrome' | 'edge'>('chrome');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setPlatform(initial.platform);
      setProxyEnabled(initial.proxyEnabled);
      setProxyUrl(initial.proxyUrl || '');
      setFingerprintEngine(initial.fingerprintEngine);
      setFingerprintOs(initial.fingerprintOs || 'win');
      setFingerprintBrowser(initial.fingerprintBrowser || 'chrome');
    } else {
      setName('');
      setPlatform('xiaohongshu');
      setProxyEnabled(false);
      setProxyUrl('');
      setFingerprintEngine('standard');
      setFingerprintOs('win');
      setFingerprintBrowser('chrome');
      setAdvancedOpen(false);
    }
  }, [initial, open]);

  const handleTestProxy = () => {
    setProxyTesting(true);
    setTimeout(() => {
      setProxyTesting(false);
    }, 1500);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...(initial?.id && { id: initial.id }),
      name: name.trim() || '未命名环境',
      platform,
      proxyEnabled,
      proxyUrl: proxyEnabled ? proxyUrl.trim() || null : null,
      fingerprintEngine,
      fingerprintOs: fingerprintEngine === 'kameleo' ? fingerprintOs : undefined,
      fingerprintBrowser: fingerprintEngine === 'kameleo' ? fingerprintBrowser : undefined,
      accountStatus: initial?.accountStatus ?? 'need_scan',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isEdit ? '编辑隔离环境' : '新建隔离环境'}
          </DialogTitle>
          <DialogClose onClose={() => onOpenChange(false)} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 pb-6">
          {/* 基础信息区 */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              基础信息
            </h3>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                <Tooltip text="该环境在列表中的显示名称，如：种草小号A-主环境">环境名称</Tooltip>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#0f172a',
                  borderColor: BORDER,
                  color: '#F8FAFC',
                }}
                placeholder="例如：种草小号A-主环境"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
                <Tooltip text="该环境绑定的目标平台，用于后续扫码登录与发帖">绑定平台</Tooltip>
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as EnvironmentPlatform)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#0f172a',
                  borderColor: BORDER,
                  color: '#F8FAFC',
                }}
              >
                {Object.entries(ENVIRONMENT_PLATFORM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* 网络配置区 Proxy */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              <Tooltip text="无论在哪台龙虾上跑，平台看到的都是同一个稳定住宅 IP">网络隔离门（代理）</Tooltip>
            </h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={proxyEnabled}
                onClick={() => setProxyEnabled(!proxyEnabled)}
                className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                style={{
                  backgroundColor: proxyEnabled ? 'var(--claw-copper)' : 'rgba(255,255,255,0.15)',
                }}
              >
                <span
                  className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform"
                  style={{ transform: proxyEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
              <span className="text-sm" style={{ color: MUTED }}>
                启用专属网络代理
              </span>
            </div>
            {proxyEnabled && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: '#0f172a',
                      borderColor: BORDER,
                      color: '#F8FAFC',
                    }}
                    placeholder="输入 HTTP/SOCKS5 代理，例如: http://user:pass@ip:port"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleTestProxy}
                  disabled={proxyTesting}
                  className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-white/5"
                  style={{ borderColor: BORDER, color: GOLD }}
                >
                  {proxyTesting ? '检测中…' : '测试连接'}
                </button>
              </div>
            )}
          </section>

          {/* 硬件指纹伪装区 */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              <Tooltip text="UA、分辨率、Canvas 等；高级引擎可模拟真实底层硬件">硬件指纹伪装</Tooltip>
            </h3>
            <div className="space-y-2" role="radiogroup" aria-label="指纹引擎">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-white/5" style={{ borderColor: BORDER }}>
                <input
                  type="radio"
                  name="fingerprint"
                  checked={fingerprintEngine === 'standard'}
                  onChange={() => setFingerprintEngine('standard')}
                  className="h-4 w-4 accent-amber-500"
                />
                <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                  🛡️ 内置标准伪装
                </span>
                <span className="text-xs" style={{ color: MUTED }}>
                  免费，适合基础运营 / 新号
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-white/5" style={{ borderColor: BORDER }}>
                <input
                  type="radio"
                  name="fingerprint"
                  checked={fingerprintEngine === 'kameleo'}
                  onChange={() => setFingerprintEngine('kameleo')}
                  className="h-4 w-4 accent-amber-500"
                />
                <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                  🔥 Kameleo 引擎级伪装
                </span>
                <span className="text-xs" style={{ color: MUTED }}>
                  需在 BYOK 插件中心配置 Key，适合高权重账号
                </span>
              </label>
            </div>

            {fingerprintEngine === 'kameleo' && (
              <div className="rounded-lg border" style={{ backgroundColor: '#0f172a', borderColor: BORDER }}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
                  style={{ color: '#F8FAFC' }}
                >
                  高级指纹参数
                  <span className="text-xs" style={{ color: MUTED }}>
                    {advancedOpen ? '收起' : '展开'}
                  </span>
                </button>
                {advancedOpen && (
                  <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: BORDER }}>
                    <div>
                      <label className="mb-1 block text-xs" style={{ color: MUTED }}>系统</label>
                      <select
                        value={fingerprintOs}
                        onChange={(e) => setFingerprintOs(e.target.value as 'win' | 'mac')}
                        className="w-full rounded border px-3 py-2 text-sm"
                        style={{
                          backgroundColor: CARD_BG,
                          borderColor: BORDER,
                          color: '#F8FAFC',
                        }}
                      >
                        <option value="win">Windows</option>
                        <option value="mac">macOS</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs" style={{ color: MUTED }}>浏览器</label>
                      <select
                        value={fingerprintBrowser}
                        onChange={(e) => setFingerprintBrowser(e.target.value as 'chrome' | 'edge')}
                        className="w-full rounded border px-3 py-2 text-sm"
                        style={{
                          backgroundColor: CARD_BG,
                          borderColor: BORDER,
                          color: '#F8FAFC',
                        }}
                      >
                        <option value="chrome">Chrome</option>
                        <option value="edge">Edge</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: 'var(--claw-gradient)' }}
            >
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
