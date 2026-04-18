import api from '@/services/api';
import type { EdgeDoctorDetailResponse, EdgeNodeGroupMapItem, EdgeNodeGroupTreeNode, RemoteNode, TaskCommand, TaskCommandActionType } from '@/types';

type FleetNodeApiRow = {
  nodeId: string;
  tenantId?: string;
  clientId: string;
  clientName: string;
  status: RemoteNode['status'];
  lastPingAt: string;
  cpuPercent?: number;
  memoryPercent?: number;
  platforms?: Array<'whatsapp' | 'wechat' | 'douyin' | 'telegram' | 'chrome' | 'other'>;
  currentAccountSummary?: string;
  circuitBreakerReason?: string;
  pendingTaskCount?: number;
  runningTaskCount?: number;
  metaCacheStatus?: string;
  twinSynced?: boolean;
  pendingConfigUpdates?: number;
  pendingSkillUpdates?: number;
  maxConcurrentTasks?: number;
  logLevel?: string;
  edgeVersion?: string;
  desiredResourceVersion?: number;
  actualResourceVersion?: number;
  configVersionSummary?: string;
  skillVersionSummary?: string;
  groupId?: string;
  groupName?: string;
};

function normalizeFleetNode(row: FleetNodeApiRow): RemoteNode {
  return {
    nodeId: row.nodeId,
    tenantId: row.tenantId,
    clientId: row.clientId,
    clientName: row.clientName,
    status: row.status,
    lastPingAt: row.lastPingAt,
    currentAccountSummary: row.currentAccountSummary,
    circuitBreakerReason: row.circuitBreakerReason,
    systemMetrics: {
      cpuPercent: Number.isFinite(row.cpuPercent) ? Number(row.cpuPercent) : 0,
      memoryPercent: Number.isFinite(row.memoryPercent) ? Number(row.memoryPercent) : 0,
      platforms: Array.isArray(row.platforms) ? row.platforms : [],
    },
    pendingTaskCount: Number.isFinite(row.pendingTaskCount) ? Number(row.pendingTaskCount) : 0,
    runningTaskCount: Number.isFinite(row.runningTaskCount) ? Number(row.runningTaskCount) : 0,
    metaCacheStatus: row.metaCacheStatus,
    twinSynced: typeof row.twinSynced === 'boolean' ? row.twinSynced : undefined,
    pendingConfigUpdates: Number.isFinite(row.pendingConfigUpdates) ? Number(row.pendingConfigUpdates) : 0,
    pendingSkillUpdates: Number.isFinite(row.pendingSkillUpdates) ? Number(row.pendingSkillUpdates) : 0,
    maxConcurrentTasks: Number.isFinite(row.maxConcurrentTasks) ? Number(row.maxConcurrentTasks) : 0,
    logLevel: row.logLevel,
    edgeVersion: row.edgeVersion,
    desiredResourceVersion: Number.isFinite(row.desiredResourceVersion) ? Number(row.desiredResourceVersion) : 0,
    actualResourceVersion: Number.isFinite(row.actualResourceVersion) ? Number(row.actualResourceVersion) : 0,
    configVersionSummary: row.configVersionSummary,
    skillVersionSummary: row.skillVersionSummary,
    groupId: row.groupId,
    groupName: row.groupName,
  };
}

export async function getFleetNodes(): Promise<RemoteNode[]> {
  const { data } = await api.get<{ code: number; data: { list: FleetNodeApiRow[] } }>('/api/v1/fleet/nodes');
  const list = data?.data?.list ?? [];
  return list.map(normalizeFleetNode);
}

export async function forceOfflineNode(nodeId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ code: number; data: { ok: boolean } }>(`/api/v1/fleet/nodes/${nodeId}/offline`);
  return data?.data ?? { ok: false };
}

export async function deployCommandToNode(params: {
  targetNodeId: string;
  actionType: TaskCommandActionType;
  payload: Record<string, unknown>;
}): Promise<TaskCommand> {
  const { data } = await api.post<{ code: number; data: TaskCommand }>('/api/v1/fleet/commands', {
    targetNodeId: params.targetNodeId,
    actionType: params.actionType,
    payload: params.payload,
  });
  if (!data?.data?.commandId) {
    throw new Error('dispatch command failed: backend returned empty command');
  }
  return data.data;
}

export async function getEdgeGroupTree(): Promise<EdgeNodeGroupTreeNode[]> {
  const { data } = await api.get<{ ok: boolean; items: EdgeNodeGroupTreeNode[] }>('/api/v1/ai/edge/groups/tree');
  return data?.items ?? [];
}

export async function getEdgeNodeGroupMap(): Promise<Record<string, EdgeNodeGroupMapItem>> {
  const { data } = await api.get<{ ok: boolean; items: Record<string, EdgeNodeGroupMapItem> }>('/api/v1/ai/edge/groups/node-map');
  return data?.items ?? {};
}

export async function createEdgeGroup(payload: {
  name: string;
  parent_group_id?: string;
  description?: string;
  tags?: string[];
}) {
  const { data } = await api.post('/api/v1/ai/edge/groups', payload);
  return data as { ok: boolean; group: EdgeNodeGroupTreeNode };
}

export async function fetchEdgeDoctor(nodeId: string) {
  const { data } = await api.get(`/api/v1/edges/${encodeURIComponent(nodeId)}/doctor`);
  return data as EdgeDoctorDetailResponse;
}

export async function requestEdgeDoctorRun(nodeId: string) {
  const { data } = await api.post(`/api/v1/edges/${encodeURIComponent(nodeId)}/doctor/run`);
  return data as {
    ok: boolean;
    edge_id: string;
    requested: boolean;
    request: Record<string, unknown>;
    doctor: Record<string, unknown>;
  };
}

export const TASK_TEMPLATES = [
  { id: 'tpl-mining', label: '竞品线索挖掘', actionType: 'START_CAMPAIGN' as const },
  { id: 'tpl-publish', label: '多平台定时分发', actionType: 'START_CAMPAIGN' as const },
  { id: 'tpl-stop', label: '停止当前任务', actionType: 'STOP_CAMPAIGN' as const },
  { id: 'tpl-restart', label: '重启边缘 Agent', actionType: 'RESTART_AGENT' as const },
] as const;
