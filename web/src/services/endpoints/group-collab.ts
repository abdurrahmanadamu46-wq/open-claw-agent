import api from '../api';
import type { GroupChannelProvider, GroupCollabAdapterConfig, GroupCollabObjectType, TenantGroupCollabConfig } from '@/types/integrations';

export type GroupCollabRecordStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'acknowledged'
  | 'failed';

export type GroupCollabDeliveryMode = 'auto' | 'mock' | 'live';

export interface GroupCollabActor {
  actorId?: string;
  displayName?: string;
  role?: string;
}

export interface GroupCollabHistoryEntry {
  eventId: string;
  eventType: string;
  status: GroupCollabRecordStatus;
  direction: 'outbound' | 'inbound' | 'system';
  summary: string;
  detail?: string;
  at: string;
  actor?: GroupCollabActor;
}

export interface GroupCollabRoute {
  adapterId: string;
  provider: GroupChannelProvider;
  mode: 'mock' | 'live';
  channelId?: string;
  chatId?: string;
  targetName?: string;
}

export interface GroupCollabReceipt {
  receiptId: string;
  provider: GroupChannelProvider;
  state: 'mocked' | 'accepted' | 'sent' | 'delivered' | 'failed' | 'acknowledged';
  providerMessageId?: string;
  detail?: string;
  receivedAt: string;
}

export interface GroupCollabRecord {
  recordId: string;
  tenantId: string;
  requestId: string;
  traceId: string;
  correlationId?: string;
  objectType: GroupCollabObjectType;
  direction: 'outbound' | 'inbound' | 'system';
  status: GroupCollabRecordStatus;
  title: string;
  summary: string;
  body: string;
  route: GroupCollabRoute;
  tags: string[];
  metadata: Record<string, unknown>;
  receipt?: GroupCollabReceipt;
  history: GroupCollabHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupCollabAdapterDescriptor extends GroupCollabAdapterConfig {
  health: 'mock' | 'ready' | 'needs_config' | 'disabled';
  isDefault: boolean;
  liveSupported: boolean;
}

export interface GroupCollabSummary {
  contractVersion: string;
  totalRecords: number;
  pendingApprovals: number;
  pendingConfirmations: number;
  pendingReminders: number;
  recentActivity: Array<{
    recordId: string;
    traceId: string;
    objectType: GroupCollabObjectType;
    eventType: string;
    status: GroupCollabRecordStatus;
    title: string;
    summary: string;
    provider: GroupChannelProvider;
    occurredAt: string;
  }>;
  pendingItems: GroupCollabRecord[];
  byObjectType: Record<string, number>;
  byStatus: Record<string, number>;
  adapters: GroupCollabAdapterDescriptor[];
  config: TenantGroupCollabConfig;
}

export interface GroupCollabContract {
  contractVersion: string;
  frozenNames?: string[];
  objectTypes: GroupCollabObjectType[];
  statuses: GroupCollabRecordStatus[];
  providers: GroupChannelProvider[];
  inboundEvents: string[];
  readModels?: Record<string, unknown>;
  endpoints: Record<string, string>;
  traceBoundary?: Record<string, unknown>;
  forbiddenBackflow?: string[];
  allowedTenantPrivateOutputs?: string[];
  examples: Record<string, unknown>;
}

export type GroupCollabTraceSummaryInsightCategory =
  | 'approval_blocker'
  | 'confirmation_momentum'
  | 'reminder_effectiveness'
  | 'receipt_health'
  | 'tenant_preference';

export interface GroupCollabTraceSummaryInsight {
  category: GroupCollabTraceSummaryInsightCategory;
  objectType: GroupCollabObjectType;
  insight: string;
  confidence: number;
  allowedLayer: 'tenant_private';
}

export interface GroupCollabTraceSanitizedSummary {
  contractVersion: string;
  summaryType: 'trace_sanitized_summary';
  source: {
    sourceKind: 'group_collab_trace';
    sourceRecordCount: number;
    inboundTraceId: 'redacted';
    rawIdentifiersReturned: false;
    rawHistoryReturned: false;
  };
  objectStats: Record<GroupCollabObjectType, number>;
  statusStats: Record<string, number>;
  insights: GroupCollabTraceSummaryInsight[];
  tenantPrivateCandidates: GroupCollabTraceSummaryInsight[];
  redaction: {
    rawTraceIdReturned: false;
    rawRequestIdsReturned: false;
    rawCorrelationIdsReturned: false;
    rawInboundTraceIdReturned: false;
    rawHistoryReturned: false;
    removedFields: string[];
  };
  generatedAt: string;
}

export async function fetchGroupCollabContract(): Promise<GroupCollabContract> {
  const { data } = await api.get<{ ok: boolean; contract: GroupCollabContract }>('/api/v1/collab/contract');
  return data?.contract;
}

export async function fetchGroupCollabSummary(): Promise<GroupCollabSummary> {
  const { data } = await api.get<{ ok: boolean; summary: GroupCollabSummary }>('/api/v1/collab/summary');
  return data?.summary;
}

export async function fetchGroupCollabAdapters(): Promise<GroupCollabAdapterDescriptor[]> {
  const { data } = await api.get<{ ok: boolean; items: GroupCollabAdapterDescriptor[] }>('/api/v1/collab/adapters');
  return data?.items ?? [];
}

export async function fetchGroupCollabRecords(input?: {
  objectType?: GroupCollabObjectType;
  status?: GroupCollabRecordStatus;
  provider?: GroupChannelProvider;
  traceId?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ contractVersion: string; total: number; items: GroupCollabRecord[] }> {
  const { data } = await api.get<{ ok: boolean; contractVersion: string; total: number; items: GroupCollabRecord[] }>(
    '/api/v1/collab/records',
    {
      params: {
        objectType: input?.objectType,
        status: input?.status,
        provider: input?.provider,
        traceId: input?.traceId,
        correlationId: input?.correlationId,
        limit: input?.limit,
        offset: input?.offset,
      },
    },
  );
  return {
    contractVersion: data?.contractVersion ?? 'collab.v1',
    total: data?.total ?? 0,
    items: data?.items ?? [],
  };
}

export async function fetchGroupCollabRecord(recordId: string): Promise<GroupCollabRecord> {
  const { data } = await api.get<{ ok: boolean; contractVersion: string; record: GroupCollabRecord }>(`/api/v1/collab/records/${recordId}`);
  return data?.record;
}

export async function buildGroupCollabTraceSummary(traceId: string): Promise<GroupCollabTraceSanitizedSummary> {
  const { data } = await api.post<{
    ok: boolean;
    summary: GroupCollabTraceSanitizedSummary;
  }>('/api/v1/collab/trace-summary', { traceId });
  return data?.summary;
}

export async function dispatchGroupCollab(input: {
  objectType: GroupCollabObjectType;
  title?: string;
  summary?: string;
  body: string;
  adapterId?: string;
  deliveryMode?: GroupCollabDeliveryMode;
  traceId?: string;
  correlationId?: string;
  tags?: string[];
  target?: {
    channelId?: string;
    chatId?: string;
    targetName?: string;
    mentions?: string[];
  };
  metadata?: Record<string, unknown>;
}) {
  const { data } = await api.post<{
    ok: boolean;
    contractVersion: string;
    record: GroupCollabRecord;
    receipt: GroupCollabRecord;
    fallbackUsed: boolean;
  }>('/api/v1/collab/dispatch', input);
  return data;
}

export async function simulateGroupCollabInbound(input: {
  recordId?: string;
  correlationId?: string;
  eventType: 'approval.approved' | 'approval.rejected' | 'confirmation.confirmed' | 'receipt.acknowledged' | 'receipt.delivered' | 'reminder.acknowledged';
  note?: string;
  actor?: GroupCollabActor;
  raw?: Record<string, unknown>;
}) {
  const { data } = await api.post<{ ok: boolean; contractVersion: string; record: GroupCollabRecord }>(
    '/api/v1/collab/mock/inbound',
    input,
  );
  return data;
}
