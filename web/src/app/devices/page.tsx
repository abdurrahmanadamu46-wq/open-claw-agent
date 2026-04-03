'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FleetDeviceRow, FleetDeviceStatus } from '@/types/device-fleet';
import { getFleetMetrics, getFleetDevices } from '@/services/device-fleet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { useDeviceProbe } from '@/hooks/useDeviceProbe';
import { deployCommandToNode, forceOfflineNode } from '@/services/node.service';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { Activity, Monitor, PowerOff, RotateCcw, Server, Sparkles } from 'lucide-react';

function statusTone(status: FleetDeviceStatus): { label: string; color: string } {
  switch (status) {
    case 'RUNNING':
      return { label: '运行中', color: '#22c55e' };
    case 'IDLE':
      return { label: '待机', color: '#e5a93d' };
    case 'COOLING':
      return { label: '冷却中', color: '#ca8a04' };
    case 'OFFLINE':
      return { label: '离线', color: '#ef4444' };
    default:
      return { label: status, color: '#94a3b8' };
  }
}

export default function DeviceFleetPage() {
  const queryClient = useQueryClient();
  const { data: metrics } = useQuery({ queryKey: ['fleet-metrics'], queryFn: getFleetMetrics });
  const { data: devices = [] } = useQuery({ queryKey: ['fleet-devices'], queryFn: getFleetDevices });

  const [probeDeviceId, setProbeDeviceId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const probeOpen = probeDeviceId !== null;
  const { frameSrc, connected } = useDeviceProbe(probeDeviceId, probeOpen);

  const summary = useMemo(
    () => metrics ?? { onlineCount: 0, totalCount: 0, utilizationPercent: 0, offlineAlertCount: 0 },
    [metrics],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fleet-devices'] }),
      queryClient.invalidateQueries({ queryKey: ['fleet-metrics'] }),
    ]);
  };

  const handleRestart = async (nodeId: string) => {
    setActionBusy(`restart:${nodeId}`);
    try {
      await deployCommandToNode({
        targetNodeId: nodeId,
        actionType: 'RESTART_AGENT',
        payload: { reason: 'manual_restart_from_devices_page' },
      });
      triggerSuccessToast(`已下发重启命令：${nodeId}`);
      await refresh();
    } catch (error) {
      triggerErrorToast(`重启命令失败：${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setActionBusy(null);
    }
  };

  const handleOffline = async (nodeId: string) => {
    setActionBusy(`offline:${nodeId}`);
    try {
      const result = await forceOfflineNode(nodeId);
      if (!result.ok) throw new Error('backend returns ok=false');
      triggerSuccessToast(`节点已强制下线：${nodeId}`);
      await refresh();
    } catch (error) {
      triggerErrorToast(`下线失败：${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_80%_14%,rgba(245,158,11,0.12),transparent_22%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative space-y-6 p-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
                <Sparkles className="h-4 w-4" />
                Devices：把单台设备变成可观测、可操作的执行单元
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">设备与算力中心</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                这页关注的是单台设备层面的状态：是否在线、当前负载如何、是否值得重启、是否要手动下线，以及能否看到实时探针画面。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/fleet" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-medium text-white">
                返回 Fleet
              </Link>
              <Link href="/campaigns" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100">
                查看任务列表
              </Link>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={<Server className="h-5 w-5 text-slate-300" />} label="在线设备 / 总设备" value={`${summary.onlineCount} / ${summary.totalCount}`} />
          <MetricCard icon={<Activity className="h-5 w-5 text-amber-300" />} label="CPU 平均利用率" value={`${summary.utilizationPercent}%`} />
          <MetricCard icon={<PowerOff className="h-5 w-5 text-rose-300" />} label="离线告警" value={String(summary.offlineAlertCount)} />
          <MetricCard icon={<Monitor className="h-5 w-5 text-cyan-300" />} label="快捷入口" value="Fleet / Campaigns" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-100">设备池</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-black/20">
                  <th className="px-4 py-3 font-medium text-slate-400">设备名称 / ID</th>
                  <th className="px-4 py-3 font-medium text-slate-400">状态</th>
                  <th className="w-40 px-4 py-3 font-medium text-slate-400">资源</th>
                  <th className="px-4 py-3 font-medium text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      暂无在线节点，请先完成边缘执行端接入。
                    </td>
                  </tr>
                ) : (
                  devices.map((row) => (
                    <FleetTableRow
                      key={row.deviceId}
                      row={row}
                      actionBusy={actionBusy}
                      onProbe={() => setProbeDeviceId(row.deviceId)}
                      onRestart={() => void handleRestart(row.deviceId)}
                      onOffline={() => void handleOffline(row.deviceId)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Dialog open={probeOpen} onOpenChange={(open) => !open && setProbeDeviceId(null)}>
          <DialogContent className="relative overflow-hidden">
            <DialogClose onClose={() => setProbeDeviceId(null)} />
            <DialogHeader>
              <DialogTitle>
                <span className="flex flex-wrap items-center gap-2 pr-10">
                  实时画面 · {probeDeviceId}
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-medium text-rose-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                    LIVE
                  </span>
                  {connected ? <span className="text-xs font-normal text-emerald-300">已连接</span> : null}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="px-6 pb-4">
              <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black">
                {frameSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frameSrc} alt="probe" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-slate-500">等待真实探针画面...</span>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function FleetTableRow({
  row,
  actionBusy,
  onProbe,
  onRestart,
  onOffline,
}: {
  row: FleetDeviceRow;
  actionBusy: string | null;
  onProbe: () => void;
  onRestart: () => void;
  onOffline: () => void;
}) {
  const tone = statusTone(row.status);
  const restartBusy = actionBusy === `restart:${row.deviceId}`;
  const offlineBusy = actionBusy === `offline:${row.deviceId}`;

  return (
    <tr className="border-b border-white/5">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-100">{row.remark}</div>
        <div className="font-mono text-xs text-slate-500">{row.deviceId}</div>
      </td>
      <td className="px-4 py-3">
        <span style={{ color: tone.color }}>{tone.label}</span>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-8">CPU</span>
            <Progress value={row.cpuPercent} className="flex-1" />
            <span>{row.cpuPercent}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-8">内存</span>
            <Progress value={row.memoryPercent} className="flex-1" />
            <span>{row.memoryPercent}%</span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs text-slate-300 underline disabled:opacity-60"
            disabled={restartBusy || offlineBusy}
            onClick={onRestart}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {restartBusy ? '重启中...' : '重启设备'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs text-slate-300 underline disabled:opacity-60"
            disabled={restartBusy || offlineBusy}
            onClick={onOffline}
          >
            <PowerOff className="h-3.5 w-3.5" />
            {offlineBusy ? '下线中...' : '强制下线'}
          </button>
          <button type="button" className="text-left text-xs font-medium text-amber-300 underline" onClick={onProbe}>
            查看实时画面
          </button>
        </div>
      </td>
    </tr>
  );
}
