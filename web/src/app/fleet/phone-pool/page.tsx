'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Activity, Phone, ShieldCheck, Shuffle } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { getFleetDevices, getFleetMetrics } from '@/services/device-fleet';
import { fetchIntegrations } from '@/services/endpoints/integrations';

export default function PhonePoolPage() {
  const { currentTenant } = useTenant();
  const devicesQuery = useQuery({
    queryKey: ['phone-pool', 'devices'],
    queryFn: getFleetDevices,
  });
  const metricsQuery = useQuery({
    queryKey: ['phone-pool', 'metrics'],
    queryFn: getFleetMetrics,
  });
  const integrationsQuery = useQuery({
    queryKey: ['phone-pool', 'integrations'],
    queryFn: fetchIntegrations,
  });

  const devices = devicesQuery.data ?? [];
  const metrics = metricsQuery.data;
  const proxies = integrationsQuery.data?.proxy?.proxyList ?? [];
  const enabledProxy = Boolean(integrationsQuery.data?.proxy?.enabled);

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(7,17,31,1))]" />

      <div className="relative mx-auto max-w-6xl space-y-5">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
                <Phone className="h-4 w-4" />
                Phone Pool：执行端容量面，而不是一个孤立的号码库存页
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">Phone Pool Readiness</h1>
              <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
                当前没有独立的 phone inventory backend，所以这页最重要的不是展示一张空号码表，而是帮助团队看清：设备容量够不够、代理覆盖够不够、当前租户还能再承载多少执行动作。
              </p>
            </div>
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              tenant quota: {currentTenant?.quota ?? 0}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MiniCard
            icon={<Phone className="h-5 w-5 text-cyan-300" />}
            title="Registered devices"
            value={String(devices.length)}
            subtitle="基于当前 live fleet nodes 推导"
          />
          <MiniCard
            icon={<Activity className="h-5 w-5 text-emerald-300" />}
            title="Online devices"
            value={metrics ? String(metrics.onlineCount) : '-'}
            subtitle={metrics ? `${metrics.offlineAlertCount} offline alerts` : 'loading'}
          />
          <MiniCard
            icon={<ShieldCheck className="h-5 w-5 text-sky-300" />}
            title="Proxy pool"
            value={enabledProxy ? String(proxies.length) : 'disabled'}
            subtitle={enabledProxy ? '代理池已启用' : '代理池未启用'}
          />
          <MiniCard
            icon={<Shuffle className="h-5 w-5 text-fuchsia-300" />}
            title="Capacity gap"
            value={currentTenant ? String(Math.max(0, currentTenant.quota - devices.length)) : '-'}
            subtitle="在当前租户配额下还可接入多少执行设备"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 text-lg font-semibold text-white">Device coverage</div>
            {devices.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
                当前没有 live devices。先接入一台边缘执行节点。
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => (
                  <div key={device.deviceId} className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-100">{device.remark}</div>
                        <div className="font-mono text-xs text-slate-500">{device.deviceId}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${device.status === 'OFFLINE' ? 'bg-rose-500/15 text-rose-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
                        {device.status}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <div>CPU {device.cpuPercent}%</div>
                      <div>Memory {device.memoryPercent}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 text-lg font-semibold text-white">Next actions</div>
            <div className="space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                持续补齐设备数量，直到执行网络和租户配额匹配。
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                如果你要放大外呼或高并发触点，代理池数量要和设备数一起评估。
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                具体的设备级诊断和单节点操作，继续回到 Device Center 和 Fleet 主界面处理。
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/devices" className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">
                Open Device Center
              </Link>
              <Link href="/fleet/proxies" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm text-slate-200">
                Open Proxy Pool
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MiniCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}
