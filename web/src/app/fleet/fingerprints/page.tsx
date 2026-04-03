'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getFleetNodes } from '@/services/node.service';

function normalizePlatforms(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function statusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === 'ONLINE' || s === 'RUNNING') return '在线';
  if (s === 'BUSY') return '忙碌';
  if (s === 'OFFLINE') return '离线';
  return s || '未知';
}

function formatTime(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export default function FingerprintsPage() {
  const { data: nodes = [], isLoading, isError } = useQuery({
    queryKey: ['fleet-nodes-fingerprint'],
    queryFn: getFleetNodes,
  });

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(245,158,11,0.1),transparent_24%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative space-y-6 p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">账号与设备指纹</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                这页只展示后端真实返回的节点快照，不再拼凑本地伪环境。它的作用是帮助团队确认：每个节点当前绑定了哪些平台、状态是否正常、最近一次心跳是什么时候。
              </p>
            </div>
            <Link
              href="/fleet"
              className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              返回边缘节点总览
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-100">
            设备指纹快照
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/8 text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">节点</th>
                  <th className="px-4 py-3 text-left">平台绑定</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">最近心跳</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6 text-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      加载中...
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-rose-300">
                      读取失败，请检查后端与鉴权状态。
                    </td>
                  </tr>
                ) : nodes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      暂无节点数据。
                    </td>
                  </tr>
                ) : (
                  nodes.map((node) => {
                    const platforms = normalizePlatforms(node.systemMetrics?.platforms);
                    const status = String(node.status ?? '');
                    const lastSeen = String(node.lastPingAt ?? '');
                    const name = String(node.clientName ?? node.nodeId ?? 'unknown');
                    const nodeId = String(node.nodeId ?? '-');

                    return (
                      <tr key={nodeId}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-100">{name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{nodeId}</div>
                        </td>
                        <td className="px-4 py-3">{platforms.length > 0 ? platforms.join(' / ') : '-'}</td>
                        <td className="px-4 py-3">{statusLabel(status)}</td>
                        <td className="px-4 py-3 text-slate-300">{formatTime(lastSeen)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
