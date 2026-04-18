'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BrainCircuit, PlusCircle, PowerOff, Server, ShieldAlert, TerminalSquare, Wifi } from 'lucide-react';
import type { EdgeDoctorDetailResponse, EdgeDoctorSummary, EdgeNodeGroupTreeNode, RemoteNode, RemoteNodeStatus } from '@/types';
import { EdgeNodeContextMenu } from '@/components/entity-menus/EdgeNodeContextMenu';
import { createEdgeGroup, deployCommandToNode, fetchEdgeDoctor, forceOfflineNode, getEdgeGroupTree, getEdgeNodeGroupMap, getFleetNodes, requestEdgeDoctorRun } from '@/services/node.service';
import { triggerSuccessToast } from '@/services/api';
import { AddNodeModal } from '@/components/fleet/AddNodeModal';
import { EdgeTerminalPanel } from '@/components/fleet/EdgeTerminalPanel';
import { useTenant } from '@/contexts/TenantContext';

const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

function formatPing(iso: string): string {
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) return '--';
  const sec = Math.floor((Date.now() - value) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function statusClass(status: RemoteNodeStatus): string {
  if (status === 'ONLINE') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (status === 'BUSY') return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (status === 'INTERVENTION_REQUIRED') return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
}

function getCpuPercent(node: RemoteNode): number {
  const value =
    (node as { systemMetrics?: { cpuPercent?: number }; cpuPercent?: number }).systemMetrics?.cpuPercent ??
    (node as { cpuPercent?: number }).cpuPercent ??
    0;
  return Number.isFinite(value) ? value : 0;
}

function getMemoryPercent(node: RemoteNode): number {
  const value =
    (node as { systemMetrics?: { memoryPercent?: number }; memoryPercent?: number }).systemMetrics?.memoryPercent ??
    (node as { memoryPercent?: number }).memoryPercent ??
    0;
  return Number.isFinite(value) ? value : 0;
}

function normalizeDoctor(detail: EdgeDoctorDetailResponse): EdgeDoctorSummary {
  return {
    node_id: String(detail.doctor?.node_id || detail.edge_id || ''),
    generated_at: String(detail.doctor?.generated_at || detail.updated_at || ''),
    overall_status: ((detail.doctor?.overall_status || detail.doctor_overall_status || 'unknown') as EdgeDoctorSummary['overall_status']) || 'unknown',
    failed_checks: Array.isArray(detail.doctor?.failed_checks) ? (detail.doctor?.failed_checks as string[]) : detail.doctor_failed_checks || [],
    warn_checks: Array.isArray(detail.doctor?.warn_checks) ? (detail.doctor?.warn_checks as string[]) : detail.doctor_warn_checks || [],
    check_count: Number(detail.doctor?.check_count || 0),
    recommended_actions: Array.isArray(detail.doctor?.recommended_actions) ? (detail.doctor?.recommended_actions as string[]) : [],
  };
}

export default function FleetManagementPage() {
  const t = useTranslations('fleet');
  const { currentTenantId, setCurrentTenantId, tenants, currentTenant, updateTenant } = useTenant();
  const { data: fetchedNodes = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['fleet', 'nodes'],
    queryFn: getFleetNodes,
    refetchInterval: false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: groupTree = [], refetch: refetchGroups } = useQuery({
    queryKey: ['fleet', 'groups', currentTenantId],
    queryFn: getEdgeGroupTree,
    refetchInterval: false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: nodeGroupMap = {}, refetch: refetchGroupMap } = useQuery({
    queryKey: ['fleet', 'group-map', currentTenantId],
    queryFn: getEdgeNodeGroupMap,
    refetchInterval: false,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [nodes, setNodes] = useState<RemoteNode[]>([]);
  const [doctorMap, setDoctorMap] = useState<Record<string, EdgeDoctorSummary>>({});
  const [doctorDetailMap, setDoctorDetailMap] = useState<Record<string, EdgeDoctorDetailResponse>>({});
  const [doctorRefreshingNodeId, setDoctorRefreshingNodeId] = useState<string | null>(null);
  const [addNodeModalOpen, setAddNodeModalOpen] = useState(false);
  const [doctorDetailNode, setDoctorDetailNode] = useState<RemoteNode | null>(null);
  const [terminalNode, setTerminalNode] = useState<RemoteNode | null>(null);

  const selectableTenants = useMemo(() => tenants.filter((tenant) => !tenant.inactive), [tenants]);

  useEffect(() => {
    setNodes(
      fetchedNodes.map((node) => {
        const group = nodeGroupMap[node.nodeId];
        return group ? { ...node, groupId: group.group_id, groupName: group.group_name } : node;
      })
    );
  }, [fetchedNodes, nodeGroupMap]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('openAddNode') === '1') {
      setAddNodeModalOpen(true);
    }
  }, []);

  useEffect(() => {
    if (selectableTenants.length === 0) return;
    if (!selectableTenants.some((tenant) => tenant.id === currentTenantId)) {
      setCurrentTenantId(selectableTenants[0].id);
    }
  }, [currentTenantId, selectableTenants, setCurrentTenantId]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setNodes((prev) =>
        prev.map((node) => {
          const pingAt = new Date(node.lastPingAt).getTime();
          if (Number.isNaN(pingAt)) return node;
          if (node.status !== 'OFFLINE' && now - pingAt > HEARTBEAT_STALE_MS) {
            return { ...node, status: 'OFFLINE' };
          }
          return node;
        })
      );
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const tenantNodes = useMemo(() => {
    const scoped = nodes.filter((node) => !node.tenantId || node.tenantId === currentTenantId);
    return scoped.length > 0 ? scoped : nodes;
  }, [nodes, currentTenantId]);

  const tenantNodeIds = useMemo(() => tenantNodes.map((node) => node.nodeId).sort().join('|'), [tenantNodes]);

  const total = tenantNodes.length;
  const online = tenantNodes.filter((node) => node.status === 'ONLINE' || node.status === 'BUSY').length;
  const offline = tenantNodes.filter((node) => node.status === 'OFFLINE').length;
  const intervention = tenantNodes.filter((node) => node.status === 'INTERVENTION_REQUIRED').length;
  const unsynced = tenantNodes.filter((node) => node.twinSynced === false).length;
  const doctorRows = tenantNodes
    .map((node) => doctorMap[node.nodeId])
    .filter((item): item is EdgeDoctorSummary => Boolean(item));
  const doctorOk = doctorRows.filter((row) => row.overall_status === 'ok').length;
  const doctorWarn = doctorRows.filter((row) => row.overall_status === 'warn').length;
  const doctorFail = doctorRows.filter((row) => row.overall_status === 'fail').length;
  const quota = currentTenant?.quota ?? 0;
  const quotaPercent = quota > 0 ? Math.min(100, (total / quota) * 100) : 0;

  const statusLabel = (status: RemoteNodeStatus) => t(`status.${status}`);

  const handleForceOffline = async (node: RemoteNode) => {
    try {
      const result = await forceOfflineNode(node.nodeId);
      if (!result.ok) throw new Error('force offline failed');
      setNodes((prev) => prev.map((item) => (item.nodeId === node.nodeId ? { ...item, status: 'OFFLINE' } : item)));
      triggerSuccessToast(t('messages.offlineSuccess', { nodeId: node.nodeId }));
      refetch();
    } catch {
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: { type: 'error', message: t('messages.offlineFailed') }
        })
      );
    }
  };

  const handleDispatch = async (node: RemoteNode) => {
    try {
      await deployCommandToNode({
        targetNodeId: node.nodeId,
        actionType: 'START_CAMPAIGN',
        payload: {
          templateId: 'tpl-mining',
          templateLabel: '演示任务下发',
          action: 'START_CAMPAIGN'
        }
      });
      triggerSuccessToast(t('messages.dispatchSuccess', { nodeId: node.nodeId }));
    } catch {
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: { type: 'error', message: t('messages.dispatchFailed') }
        })
      );
    }
  };

  const handleRenameCurrentTenant = () => {
    if (!currentTenant) return;
    const nextName = window.prompt(t('messages.renamePrompt'), currentTenant.name)?.trim();
    if (!nextName) return;
    updateTenant(currentTenant.id, { name: nextName });
    triggerSuccessToast(t('messages.renameSuccess', { name: nextName }));
  };

  const handleCreateGroup = async () => {
    const nextName = window.prompt('请输入新分组名称')?.trim();
    if (!nextName) return;
    try {
      await createEdgeGroup({ name: nextName });
      triggerSuccessToast(`已创建分组：${nextName}`);
      await Promise.all([refetchGroups(), refetchGroupMap()]);
    } catch {
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: { type: 'error', message: '分组创建失败' }
        })
      );
    }
  };

  const refreshDoctorNode = async (nodeId: string) => {
    const detail = await fetchEdgeDoctor(nodeId);
    setDoctorDetailMap((prev) => ({ ...prev, [nodeId]: detail }));
    setDoctorMap((prev) => ({ ...prev, [nodeId]: normalizeDoctor(detail) }));
  };

  const handleRequestDoctorRun = async (node: RemoteNode) => {
    try {
      setDoctorRefreshingNodeId(node.nodeId);
      await requestEdgeDoctorRun(node.nodeId);
      await refreshDoctorNode(node.nodeId);
      triggerSuccessToast(`已请求节点 ${node.nodeId} 刷新诊断，下一次心跳后会更新状态`);
    } catch {
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: { type: 'error', message: '诊断请求失败' }
        })
      );
    } finally {
      setDoctorRefreshingNodeId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!tenantNodes.length) {
      setDoctorMap({});
      return;
    }
    void (async () => {
      const results = await Promise.allSettled(tenantNodes.map((node) => fetchEdgeDoctor(node.nodeId)));
      if (cancelled) return;
      const next: Record<string, EdgeDoctorSummary> = {};
      const detailNext: Record<string, EdgeDoctorDetailResponse> = {};
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        detailNext[tenantNodes[index].nodeId] = result.value;
        next[tenantNodes[index].nodeId] = normalizeDoctor(result.value);
      });
      setDoctorDetailMap(detailNext);
      setDoctorMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantNodeIds, tenantNodes]);

  if (isLoading && tenantNodes.length === 0) {
    return <div className="py-20 text-center text-slate-400">{t('messages.loading')}</div>;
  }

  if (isError && tenantNodes.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5">
        <div className="text-sm text-rose-200">{t('messages.loadFailed')}</div>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg border border-slate-500 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
        >
          {t('buttons.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Server className="h-4 w-4" />
              {t('badge')}
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">{t('title')}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={currentTenantId}
              onChange={(e) => setCurrentTenantId(e.target.value)}
              className="rounded-2xl border border-slate-600 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none"
              aria-label={t('buttons.renameTenant')}
            >
              {selectableTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRenameCurrentTenant}
              className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.08]"
              aria-label={t('buttons.renameTenant')}
            >
              {t('buttons.renameTenant')}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-400">{t('messages.quota', { total, quota })}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddNodeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-900"
            >
              <PlusCircle className="h-4 w-4" />
              {t('buttons.addNode')}
            </button>
            <Link href="/nodes" className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white">
              {t('buttons.viewGuide')}
            </Link>
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-700/60">
          <div className={`h-full ${quotaPercent >= 80 ? 'bg-orange-400' : 'bg-emerald-400'}`} style={{ width: `${quotaPercent}%` }} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <MetricCard icon={<Server className="h-5 w-5 text-slate-300" />} title={t('metrics.total')} value={String(total)} subtitle={t('table.clientName')} />
        <MetricCard icon={<Wifi className="h-5 w-5 text-emerald-300" />} title={t('metrics.online')} value={String(online)} subtitle={t('table.status')} />
        <MetricCard icon={<AlertTriangle className="h-5 w-5 text-slate-300" />} title={t('metrics.offline')} value={String(offline)} subtitle={t('table.heartbeat')} />
        <MetricCard icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} title={t('metrics.intervention')} value={String(intervention)} subtitle={t('table.actions')} />
        <MetricCard icon={<BrainCircuit className="h-5 w-5 text-amber-300" />} title="待同步" value={String(unsynced)} subtitle="Device Twin" />
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Edge Doctor</div>
            <div className="mt-2 text-lg font-semibold text-white">边缘节点自诊断</div>
            <div className="mt-1 text-sm text-slate-400">聚合浏览器上下文、WSS 连通、会话文件与临时目录可写等最小健康项。</div>
          </div>
          <div className="text-xs text-slate-500">已上报 {doctorRows.length}/{tenantNodes.length}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard icon={<Wifi className="h-5 w-5 text-emerald-300" />} title="Doctor OK" value={String(doctorOk)} subtitle="诊断正常" />
          <MetricCard icon={<AlertTriangle className="h-5 w-5 text-amber-300" />} title="Doctor WARN" value={String(doctorWarn)} subtitle="需要留意" />
          <MetricCard icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} title="Doctor FAIL" value={String(doctorFail)} subtitle="需人工排障" />
          <MetricCard icon={<Server className="h-5 w-5 text-slate-300" />} title="未上报" value={String(Math.max(tenantNodes.length - doctorRows.length, 0))} subtitle="等待心跳" />
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Asset Tree</div>
            <div className="mt-2 text-lg font-semibold text-white">边缘节点分组</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateGroup()}
            className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100"
          >
            新建分组
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {groupTree.length > 0 ? (
            groupTree.map((group) => <EdgeGroupTreeCard key={group.group_id} group={group} />)
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
              当前租户还没有节点分组，适合先按区域、项目或部门建立树形结构。
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
        <div className="overflow-x-auto">
          <table data-testid="fleet-table" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-black/20 text-slate-400">
                <th className="px-4 py-3">{t('table.clientName')}</th>
                <th className="px-4 py-3">{t('table.nodeId')}</th>
                <th className="px-4 py-3">{t('table.status')}</th>
                <th className="px-4 py-3">{t('table.heartbeat')}</th>
                <th className="px-4 py-3">{t('table.load')}</th>
                <th className="px-4 py-3">{t('table.summary')}</th>
                <th className="px-4 py-3">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {tenantNodes.map((node) => (
                <EdgeNodeContextMenu
                  key={node.nodeId}
                  node={node}
                  onRefresh={async () => {
                    await refetch();
                  }}
                  onOpenTerminal={() => setTerminalNode(node)}
                  onDispatch={() => handleDispatch(node)}
                  onForceOffline={() => handleForceOffline(node)}
                >
                  <tr data-testid={`fleet-row-${node.nodeId}`} className="border-b border-white/6 text-slate-100">
                    <td className="px-4 py-3">{node.clientName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{node.nodeId}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(node.status)}`}>
                        {statusLabel(node.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{formatPing(node.lastPingAt)}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">CPU {getCpuPercent(node)}% / MEM {getMemoryPercent(node)}%</td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      <div>{node.currentAccountSummary ?? '--'}</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {node.groupName ? (
                          <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-fuchsia-200">
                            组 {node.groupName}
                          </span>
                        ) : null}
                        <span className={`rounded-full px-2 py-0.5 ${node.twinSynced === false ? 'bg-orange-500/15 text-orange-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {node.twinSynced === false
                            ? `待同步 ${node.pendingConfigUpdates ?? 0}配/${node.pendingSkillUpdates ?? 0}技`
                            : '配置已同步'}
                        </span>
                        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
                          缓存 {node.metaCacheStatus || 'unknown'}
                        </span>
                        <DoctorBadge summary={doctorMap[node.nodeId]} />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        任务 {node.runningTaskCount ?? 0}/{node.maxConcurrentTasks ?? 0} · 待执行 {node.pendingTaskCount ?? 0}
                      </div>
                      {doctorMap[node.nodeId] ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          fail {doctorMap[node.nodeId].failed_checks.length} · warn {doctorMap[node.nodeId].warn_checks.length}
                          {doctorMap[node.nodeId].recommended_actions[0] ? ` · 建议: ${doctorMap[node.nodeId].recommended_actions[0]}` : ''}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-500">Doctor 尚未上报</div>
                      )}
                      {(node.configVersionSummary || node.skillVersionSummary) ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          {node.configVersionSummary ? `Cfg ${node.configVersionSummary}` : ''}
                          {node.configVersionSummary && node.skillVersionSummary ? ' · ' : ''}
                          {node.skillVersionSummary ? `Skill ${node.skillVersionSummary}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" data-testid={`fleet-offline-${node.nodeId}`} onClick={() => handleForceOffline(node)} className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10">
                          <PowerOff className="h-3.5 w-3.5" />
                          {t('buttons.offline')}
                        </button>
                        <button type="button" data-testid={`fleet-dispatch-${node.nodeId}`} onClick={() => handleDispatch(node)} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10">
                          {t('buttons.dispatch')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRequestDoctorRun(node)}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10"
                        >
                          {doctorRefreshingNodeId === node.nodeId ? '诊断中...' : '诊断'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDoctorDetailNode(node)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
                        >
                          Doctor 详情
                        </button>
                        <Link href="/ai-brain/prompt-lab" className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10">
                          <BrainCircuit className="h-3.5 w-3.5" />
                          {t('buttons.persona')}
                        </Link>
                        <button type="button" onClick={() => setTerminalNode(node)} className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10">
                          <TerminalSquare className="h-3.5 w-3.5" />
                          {t('buttons.terminal')}
                        </button>
                      </div>
                    </td>
                  </tr>
                </EdgeNodeContextMenu>
              ))}
            </tbody>
          </table>
        </div>
        {tenantNodes.length === 0 && <div className="py-16 text-center text-sm text-slate-500">{t('messages.empty')}</div>}
      </section>

      {terminalNode ? <EdgeTerminalPanel key={terminalNode.nodeId} nodeId={terminalNode.nodeId} nodeName={terminalNode.clientName} onClose={() => setTerminalNode(null)} /> : null}
      {doctorDetailNode ? (
        <EdgeDoctorDetailPanel
          node={doctorDetailNode}
          detail={doctorDetailMap[doctorDetailNode.nodeId]}
          onRefresh={async () => {
            await refreshDoctorNode(doctorDetailNode.nodeId);
          }}
          onClose={() => setDoctorDetailNode(null)}
        />
      ) : null}

      <AddNodeModal open={addNodeModalOpen} onOpenChange={setAddNodeModalOpen} tenantId={currentTenantId} tenantName={currentTenant?.name ?? ''} />
    </div>
  );
}

function EdgeGroupTreeCard({ group }: { group: EdgeNodeGroupTreeNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{group.name}</div>
        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">{group.node_count}</span>
      </div>
      {group.description ? <div className="mt-2 text-xs text-slate-400">{group.description}</div> : null}
      {group.children?.length ? (
        <div className="mt-3 space-y-2 border-l border-white/10 pl-3">
          {group.children.map((child) => (
            <div key={child.group_id} className="text-xs text-slate-300">
              {child.name} · {child.node_count}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-xs text-slate-500">暂无子分组</div>
      )}
    </div>
  );
}

function MetricCard({ icon, title, value, subtitle }: { icon: ReactNode; title: string; value: string; subtitle: string }) {
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

function DoctorBadge({ summary }: { summary?: EdgeDoctorSummary }) {
  if (!summary) {
    return <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-slate-300">Doctor 未上报</span>;
  }
  const tone =
    summary.overall_status === 'ok'
      ? 'bg-emerald-500/15 text-emerald-300'
      : summary.overall_status === 'warn'
        ? 'bg-amber-500/15 text-amber-300'
        : summary.overall_status === 'fail'
          ? 'bg-rose-500/15 text-rose-300'
          : 'bg-slate-500/15 text-slate-300';
  return <span className={`rounded-full px-2 py-0.5 ${tone}`}>Doctor {summary.overall_status.toUpperCase()}</span>;
}

function EdgeDoctorDetailPanel(props: {
  node: RemoteNode;
  detail?: EdgeDoctorDetailResponse;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { node, detail, onRefresh, onClose } = props;
  const summary = detail ? normalizeDoctor(detail) : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#0f172a] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">Edge Doctor Detail</div>
            <div className="mt-2 text-xl font-semibold text-white">{node.clientName || node.nodeId}</div>
            <div className="mt-1 font-mono text-xs text-slate-400">{node.nodeId}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onRefresh()} className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
              刷新
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200">
              关闭
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard icon={<Wifi className="h-5 w-5 text-emerald-300" />} title="整体状态" value={summary?.overall_status?.toUpperCase() || 'UNKNOWN'} subtitle="doctor overall" />
          <MetricCard icon={<ShieldAlert className="h-5 w-5 text-rose-300" />} title="失败项" value={String(summary?.failed_checks.length ?? 0)} subtitle="failed checks" />
          <MetricCard icon={<AlertTriangle className="h-5 w-5 text-amber-300" />} title="告警项" value={String(summary?.warn_checks.length ?? 0)} subtitle="warn checks" />
          <MetricCard icon={<Server className="h-5 w-5 text-slate-300" />} title="检查项数" value={String(summary?.check_count ?? 0)} subtitle="total checks" />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Failed Checks</div>
            <div className="mt-3 space-y-2">
              {summary?.failed_checks.length ? summary.failed_checks.map((item) => (
                <div key={item} className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{item}</div>
              )) : <div className="text-sm text-slate-500">暂无失败项</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Warn Checks</div>
            <div className="mt-3 space-y-2">
              {summary?.warn_checks.length ? summary.warn_checks.map((item) => (
                <div key={item} className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{item}</div>
              )) : <div className="text-sm text-slate-500">暂无告警项</div>}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Recommended Actions</div>
          <div className="mt-3 space-y-2">
            {summary?.recommended_actions.length ? summary.recommended_actions.map((item) => (
              <div key={item} className="rounded-xl bg-slate-950/40 px-3 py-2 text-sm text-slate-200">{item}</div>
            )) : <div className="text-sm text-slate-500">暂无建议动作</div>}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            最近更新时间: {summary?.generated_at ? new Date(summary.generated_at).toLocaleString('zh-CN', { hour12: false }) : '-'}
          </div>
        </div>
      </div>
    </div>
  );
}
