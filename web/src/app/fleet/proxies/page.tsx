'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusCircle, Trash2, RefreshCw, Save } from 'lucide-react';
import { fetchIntegrations, updateIntegrations } from '@/services/endpoints/integrations';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';

const BORDER = 'rgba(71,85,105,0.4)';
const MUTED = '#94A3B8';
const CARD_BG = '#1E293B';

function maskAddress(raw: string): string {
  const s = raw.replace(/^[^@]+@/, '');
  const match = s.match(/(?:\[([^\]]+)\]|([^:/]+))[:/]/);
  const host = match ? (match[1] || match[2] || '').trim() : '';
  const parts = host.split('.');
  if (parts.length >= 4) return `${parts[0]}.${parts[1]}.*.*`;
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;
  return host || '-';
}

function normalizeProxyLines(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\n/g)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

export default function FleetProxiesPage() {
  const queryClient = useQueryClient();
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['tenant-integrations-proxy'],
    queryFn: fetchIntegrations,
  });

  const currentProxies = useMemo(() => data?.proxy?.proxyList ?? [], [data?.proxy?.proxyList]);
  const [importText, setImportText] = useState('');
  const [saving, setSaving] = useState(false);

  const total = currentProxies.length;
  const enabled = Boolean(data?.proxy?.enabled);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tenant-integrations-proxy'] });
  };

  const handleSave = async (next: string[]) => {
    setSaving(true);
    try {
      await updateIntegrations({
        proxy: {
          enabled: true,
          proxyList: next,
        },
      });
      triggerSuccessToast('代理池已保存');
      await refresh();
    } catch (error) {
      triggerErrorToast(`保存失败：${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleBatchImport = async () => {
    const incoming = normalizeProxyLines(importText);
    if (incoming.length === 0) {
      triggerErrorToast('请先输入代理地址');
      return;
    }
    const merged = Array.from(new Set([...currentProxies, ...incoming]));
    await handleSave(merged);
    setImportText('');
  };

  const handleDelete = async (row: string) => {
    await handleSave(currentProxies.filter((item) => item !== row));
  };

  return (
    <div className="relative text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative space-y-5 p-4 md:p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">网络与代理池</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                代理配置直接写入租户集成，不再依赖本地伪状态。这里最重要的是让团队快速确认：代理池够不够、是否已启用、当前列表里都有哪些地址，以及需不需要继续扩容。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-2 font-medium text-white hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard title="代理总数" value={String(total)} />
          <SummaryCard title="代理开关" value={enabled ? '已启用' : '未启用'} />
          <SummaryCard title="同步状态" value={isFetching ? '同步中...' : '已同步'} />
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 text-sm font-medium text-slate-100">批量导入代理</div>
          <p className="mb-3 text-xs text-slate-400">
            每行一条，支持 `http://user:pass@ip:port`、`socks5://ip:port` 或 `ip:port:user:pass`。
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder="http://user:pass@103.45.67.89:8080"
            className="w-full rounded-2xl border px-3 py-2 font-mono text-sm resize-y"
            style={{ backgroundColor: '#0f172a', borderColor: BORDER, color: '#F8FAFC' }}
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleBatchImport()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'var(--claw-gradient)' }}
            >
              {saving ? <Save className="h-4 w-4 animate-pulse" /> : <PlusCircle className="h-4 w-4" />}
              {saving ? '保存中...' : '导入并保存'}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(71,85,105,0.6)', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                <th className="px-4 py-3 font-medium" style={{ color: MUTED }}>
                  地址（脱敏）
                </th>
                <th className="px-4 py-3 font-medium" style={{ color: MUTED }}>
                  原始配置
                </th>
                <th className="px-4 py-3 font-medium text-right" style={{ color: MUTED }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {currentProxies.map((row) => (
                <tr key={row} style={{ borderBottom: '1px solid rgba(71,85,105,0.2)' }}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-200">{maskAddress(row)}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: MUTED }}>
                    {row}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDelete(row)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded p-1 text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {currentProxies.length === 0 && (
            <div className="py-12 text-center text-sm" style={{ color: MUTED }}>
              当前租户代理池为空，请先导入代理配置。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}
