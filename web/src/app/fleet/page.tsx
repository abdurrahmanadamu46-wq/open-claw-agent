'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BrainCircuit, PlusCircle, PowerOff, Server, ShieldAlert, TerminalSquare, Wifi } from 'lucide-react';
import type { EdgeNodeGroupTreeNode, RemoteNode, RemoteNodeStatus } from '@/types';
import { EdgeNodeContextMenu } from '@/components/entity-menus/EdgeNodeContextMenu';
import { createEdgeGroup, getEdgeGroupTree, getEdgeNodeGroupMap, getFleetNodes, forceOfflineNode, deployCommandToNode } from '@/services/node.service';
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

export default function FleetManagementPage() {
  const t = useTranslations('fleet');
  const { currentTenantId, setCurrentTenantId, tenants, currentTenant, updateTenant } = useTenant();
  const { data: fetchedNodes = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['fleet', 'nodes'],
    queryFn: getFleetNodes,
    refetchInterval: false
  });
  const { data: groupTree = [], refetch: refetchGroups } = useQuery({
    queryKey: ['fleet', 'groups', currentTenantId],
    queryFn: getEdgeGroupTree,
    refetchInterval: false
  });
  const { data: nodeGroupMap = {}, refetch: refetchGroupMap } = useQuery({
    queryKey: ['fleet', 'group-map', currentTenantId],
    queryFn: getEdgeNodeGroupMap,
    refetchInterval: false
  });

  const [nodes, setNodes] = useState<RemoteNode[]>([]);
  const [addNodeModalOpen, setAddNodeModalOpen] = useState(false);
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

  const total = tenantNodes.length;
  const online = tenantNodes.filter((node) => node.status === 'ONLINE' || node.status === 'BUSY').length;
  const offline = tenantNodes.filter((node) => node.status === 'OFFLINE').length;
  const intervention = tenantNodes.filter((node) => node.status === 'INTERVENTION_REQUIRED').length;
  const unsynced = tenantNodes.filter((node) => node.twinSynced === false).length;
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
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        任务 {node.runningTaskCount ?? 0}/{node.maxConcurrentTasks ?? 0} · 待执行 {node.pendingTaskCount ?? 0}
                      </div>
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
