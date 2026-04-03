'use client';

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { triggerSuccessToast, triggerErrorToast } from '@/services/api';
import { Download, Copy, Check, CheckCircle2 } from 'lucide-react';
import { EDGE_PERSONA_MASKS, type EdgePersonaMaskId } from '@/data/edge-persona-masks';

function generateActivationToken(): string {
  const segment = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  return `CLAW-${segment()}-${segment()}-${segment()}`;
}

function generateTenantToken(tenantId: string, baseToken: string): string {
  const suffix = baseToken.replace(/-/g, '').slice(0, 8).toLowerCase();
  const slug = tenantId.replace(/^tenant-/, 'client');
  return `tk_live_${slug}_${suffix}`;
}

export interface AddNodePayload {
  token: string;
  maskId: EdgePersonaMaskId | null;
  roleId?: EdgePersonaMaskId | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId?: string;
  tenantName?: string;
  onRequestToken?: () => Promise<string>;
  onPayloadChange?: (payload: AddNodePayload) => void;
};

export function AddNodeModal({ open, onOpenChange, tenantId, tenantName, onRequestToken, onPayloadChange }: Props) {
  const [token, setToken] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [selectedMaskId, setSelectedMaskId] = useState<EdgePersonaMaskId | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedMaskId(null);
    if (onRequestToken) {
      setTokenLoading(true);
      onRequestToken()
        .then((value) => {
          setToken(value);
          setTokenLoading(false);
        })
        .catch(() => {
          setToken(generateActivationToken());
          setTokenLoading(false);
        });
      return;
    }
    setToken(generateActivationToken());
  }, [open, onRequestToken]);

  useEffect(() => {
    if (!open) return;
    onPayloadChange?.({
      token,
      maskId: selectedMaskId,
      roleId: selectedMaskId,
    });
  }, [open, token, selectedMaskId, onPayloadChange]);

  const handleCopyToken = useCallback(() => {
    if (!token) return;
    navigator.clipboard
      .writeText(token)
      .then(() => {
        setCopied(true);
        triggerSuccessToast('激活码已复制');
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => triggerErrorToast('复制失败'));
  }, [token]);

  const tenantToken = token ? generateTenantToken(tenantId ?? 'default', token) : '';
  const deployCommand = tenantToken ? `claw-cli start --tenant-token ${tenantToken}` : '';

  const handleCopyDeployCommand = useCallback(() => {
    if (!deployCommand) return;
    navigator.clipboard
      .writeText(deployCommand)
      .then(() => {
        setCopiedCommand(true);
        triggerSuccessToast('专属部署指令已复制');
        setTimeout(() => setCopiedCommand(false), 1500);
      })
      .catch(() => triggerErrorToast('复制失败'));
  }, [deployCommand]);

  const showTenantWarning = Boolean(tenantName && tenantId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">接入新的龙虾算力节点</DialogTitle>
          <DialogClose onClose={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="space-y-6 px-6 pb-6">
          {showTenantWarning && (
            <div
              className="flex items-start gap-3 rounded-lg border px-4 py-3"
              style={{ backgroundColor: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.4)' }}
            >
              <span className="text-lg" aria-hidden>
                ⚠
              </span>
              <p className="text-sm font-medium" style={{ color: '#FCD34D' }}>
                当前生成的节点连接密钥将绑定到「{tenantName}」空间，无法跨租户流转。该节点接入后只会出现在当前工作空间的算力池中。
              </p>
            </div>
          )}

          <section>
            <p className="mb-2 text-sm font-medium text-slate-400">第一步：在要接入的电脑上下载安装客户端</p>
            <a
              href="/downloads/lobster-client.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 px-6 py-4 text-base font-semibold text-amber-300 transition hover:border-amber-400 hover:bg-amber-500/20"
            >
              <Download className="h-6 w-6 shrink-0" />
              下载 Windows 极速客户端 (.exe)
            </a>
            <p className="mt-1.5 text-xs text-slate-500">约 10MB，无需预装环境，双击即可使用。</p>
          </section>

          <section>
            <p className="mb-2 text-sm font-medium text-slate-400">第二步：复制激活码，在客户端中粘贴并连接</p>
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#0F172A] px-4 py-3">
              <code className="flex-1 font-mono text-lg tracking-widest text-amber-400">{tokenLoading ? '生成中...' : token || '--'}</code>
              <button
                type="button"
                onClick={handleCopyToken}
                disabled={!token || tokenLoading}
                className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-300 transition disabled:opacity-50"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? '已复制' : '一键复制'}
              </button>
            </div>
          </section>

          {deployCommand && (
            <section>
              <p className="mb-2 text-sm font-medium text-slate-400">专属部署指令（含租户连接密钥，仅限当前工作空间）</p>
              <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#0F172A] px-4 py-3">
                <code className="flex-1 break-all font-mono text-sm text-slate-300">{deployCommand}</code>
                <button
                  type="button"
                  onClick={handleCopyDeployCommand}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-500/25 px-4 py-2 text-sm font-medium text-amber-300 transition hover:opacity-90"
                >
                  {copiedCommand ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  一键复制部署指令
                </button>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-50">第三步：为该节点分配人设面具（可选）</h3>
            <p className="mb-3 text-xs text-slate-400">
              选择人设面具后，将用于控制该边缘节点龙虾的语气、偏好和互动风格。
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {EDGE_PERSONA_MASKS.map((mask) => {
                const selected = selectedMaskId === mask.id;
                return (
                  <button
                    key={mask.id}
                    type="button"
                    onClick={() => setSelectedMaskId(selected ? null : mask.id)}
                    className="relative rounded-lg border p-3 text-left transition"
                    style={{
                      backgroundColor: selected ? 'rgba(229,169,61,0.12)' : 'rgba(15,23,42,0.8)',
                      borderColor: selected ? 'rgba(229,169,61,0.6)' : 'rgba(255,255,255,0.1)',
                      boxShadow: selected ? '0 0 0 2px rgba(229,169,61,0.35)' : undefined,
                    }}
                  >
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/30 text-amber-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/20 bg-black/30 text-lg">
                        {mask.emoji}
                      </span>
                      <div className="min-w-0 flex-1 pr-5">
                        <div className="truncate text-sm font-medium text-slate-100">{mask.name}</div>
                        <div className="truncate text-[10px] text-slate-400">{mask.identity}</div>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                      <div>口吻：{mask.narrativeTone}</div>
                      <div>兴趣：{mask.interests.slice(0, 2).join(' / ')}</div>
                      <div>活跃：{mask.activeWindows.slice(0, 2).join(' | ')}</div>
                      <div className="text-slate-400">OTA：{mask.otaVersion}</div>
                    </div>
                    {!mask.authorized && <div className="mt-2 text-[11px] text-rose-300">未授权，需要先升级套餐</div>}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/20 py-6">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute h-full w-full animate-radar-ping rounded-full border-2 border-amber-500/40" style={{ animationDuration: '2s' }} />
              <span
                className="absolute h-3/4 w-3/4 animate-radar-ping rounded-full border-2 border-amber-500/30"
                style={{ animationDuration: '2s', animationDelay: '0.4s' }}
              />
              <span
                className="absolute h-1/2 w-1/2 animate-radar-ping rounded-full border-2 border-amber-500/20"
                style={{ animationDuration: '2s', animationDelay: '0.8s' }}
              />
              <span className="absolute h-1/4 w-1/4 rounded-full bg-amber-500/60" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-400">等待龙虾客户端连接中...</p>
            <p className="mt-1 text-xs text-slate-500">在电脑上输入激活码并点击连接后，节点会自动出现在控制台里。</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
