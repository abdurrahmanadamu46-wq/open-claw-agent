export type FleetNodeStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'INTERVENTION_REQUIRED';
export type FleetNodePlatform = 'whatsapp' | 'wechat' | 'douyin' | 'telegram' | 'chrome' | 'other';

export interface FleetNodeRecord {
  nodeId: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  status: FleetNodeStatus;
  lastPingAt: string;
  cpuPercent: number;
  memoryPercent: number;
  platforms: FleetNodePlatform[];
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
}

export type FleetCommandActionType =
  | 'START_CAMPAIGN'
  | 'STOP_CAMPAIGN'
  | 'RESTART_AGENT'
  | 'SYNC_CONFIG'
  | 'PROVISION_ACK';

export interface FleetCommandRecord {
  commandId: string;
  targetNodeId: string;
  tenantId: string;
  actionType: FleetCommandActionType;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'COMPLETED';
  createdAt: string;
  acknowledgedAt?: string;
}
