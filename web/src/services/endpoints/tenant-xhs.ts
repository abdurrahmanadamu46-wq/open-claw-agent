import api from '../api';
import type {
  FleetEdgeEventListResponse,
  XhsCommanderQueueActionType,
  XhsCommanderAlertDismissalListResponse,
  XhsCommanderReminderPolicy,
  XhsCommanderReminderPolicyChangeListResponse,
  XhsCommanderEscalationQueueResponse,
  XhsCommanderEscalationQueueItem,
  XhsCommanderQueueStatus,
  XhsCommanderTaskActionType,
  XhsCommanderTaskListResponse,
  XhsCommanderTaskRecord,
  XhsEventSummaryResponse,
  XhsHandoffActionListResponse,
  XhsHandoffActionRecord,
  XhsHandoffActionRole,
  XhsHandoffActionSummaryResponse,
  XhsHandoffActionStatus,
  XhsHandoffActionType,
  XhsRoleFeedResponse,
  XhsSupervisorHandoffPackResponse,
  XhsSupervisorOverviewResponse,
} from '@/types/xhs-events';

export async function fetchTenantXhsEvents(input?: {
  limit?: number;
  event_type?: string;
  account_id?: string;
}) {
  const { data } = await api.get<FleetEdgeEventListResponse>('/api/v1/tenant/cockpit/xhs-events', {
    params: input,
  });
  return data;
}

export async function fetchTenantXhsEventSummary(input?: {
  account_id?: string;
  limit?: number;
}) {
  const { data } = await api.get<XhsEventSummaryResponse>('/api/v1/tenant/cockpit/xhs-events/summary', {
    params: input,
  });
  return data;
}

export async function fetchTenantXhsSupervisorOverview(input?: {
  account_id?: string;
  limit?: number;
  role_preview_limit?: number;
}) {
  const { data } = await api.get<XhsSupervisorOverviewResponse>('/api/v1/tenant/cockpit/xhs-events/supervisor-overview', {
    params: input,
  });
  return data;
}

export async function fetchTenantXhsSupervisorHandoffPack(input?: {
  account_id?: string;
  limit?: number;
  pack_limit?: number;
}) {
  const { data } = await api.get<XhsSupervisorHandoffPackResponse>('/api/v1/tenant/cockpit/xhs-events/handoff-pack', {
    params: input,
  });
  return data;
}

export async function fetchTenantXhsHandoffActions(input?: {
  pack_ids?: string[];
  limit?: number;
  role?: XhsHandoffActionRole;
  action?: XhsHandoffActionType;
  status?: XhsHandoffActionStatus;
}) {
  const { data } = await api.get<XhsHandoffActionListResponse>('/api/v1/tenant/cockpit/xhs-events/handoff-actions', {
    params: {
      limit: input?.limit,
      pack_ids: input?.pack_ids?.join(','),
      role: input?.role,
      action: input?.action,
      status: input?.status,
    },
  });
  return data;
}

export async function fetchTenantXhsHandoffActionHistory(input?: {
  pack_ids?: string[];
  limit?: number;
  role?: XhsHandoffActionRole;
  action?: XhsHandoffActionType;
  status?: XhsHandoffActionStatus;
}) {
  const { data } = await api.get<XhsHandoffActionListResponse>('/api/v1/tenant/cockpit/xhs-events/handoff-actions/history', {
    params: {
      limit: input?.limit,
      pack_ids: input?.pack_ids?.join(','),
      role: input?.role,
      action: input?.action,
      status: input?.status,
    },
  });
  return data;
}

export async function fetchTenantXhsHandoffActionSummary(input?: {
  recent_limit?: number;
  pack_ids?: string[];
  role?: XhsHandoffActionRole;
  action?: XhsHandoffActionType;
  status?: XhsHandoffActionStatus;
}) {
  const { data } = await api.get<XhsHandoffActionSummaryResponse>('/api/v1/tenant/cockpit/xhs-events/handoff-actions/summary', {
    params: {
      recent_limit: input?.recent_limit,
      pack_ids: input?.pack_ids?.join(','),
      role: input?.role,
      action: input?.action,
      status: input?.status,
    },
  });
  return data;
}

export async function fetchTenantXhsCommanderQueue(input?: {
  pack_ids?: string[];
  status?: XhsCommanderQueueStatus | 'all';
  limit?: number;
}) {
  const { data } = await api.get<XhsCommanderEscalationQueueResponse>('/api/v1/tenant/cockpit/xhs-events/commander-queue', {
    params: {
      pack_ids: input?.pack_ids?.join(','),
      status: input?.status,
      limit: input?.limit,
    },
  });
  return data;
}

export async function createTenantXhsCommanderQueueAction(input: {
  pack_id: string;
  action: XhsCommanderQueueActionType;
  assignee?: string;
  note?: string;
}) {
  const { data } = await api.post<XhsCommanderEscalationQueueItem>(
    '/api/v1/tenant/cockpit/xhs-events/commander-queue/actions',
    input,
  );
  return data;
}

export async function fetchTenantXhsCommanderTasks(input?: {
  status?: 'pending' | 'in_progress' | 'done' | 'all';
  limit?: number;
}) {
  const { data } = await api.get<XhsCommanderTaskListResponse>('/api/v1/tenant/cockpit/xhs-events/commander-tasks', {
    params: input,
  });
  return data;
}

export async function createTenantXhsCommanderTask(input: {
  pack_id: string;
  assignee?: string;
  note?: string;
}) {
  const { data } = await api.post<XhsCommanderTaskRecord>('/api/v1/tenant/cockpit/xhs-events/commander-tasks', input);
  return data;
}

export async function createTenantXhsCommanderTaskAction(input: {
  pack_id: string;
  action: XhsCommanderTaskActionType;
  note?: string;
}) {
  const { data } = await api.post<XhsCommanderTaskRecord>('/api/v1/tenant/cockpit/xhs-events/commander-tasks/actions', input);
  return data;
}

export async function fetchTenantXhsCommanderAlertDismissals() {
  const { data } = await api.get<XhsCommanderAlertDismissalListResponse>('/api/v1/tenant/cockpit/xhs-events/commander-alert-dismissals');
  return data;
}

export async function createTenantXhsCommanderAlertDismissal(input: { alert_id: string }) {
  const { data } = await api.post<XhsCommanderAlertDismissalListResponse['items'][number]>(
    '/api/v1/tenant/cockpit/xhs-events/commander-alert-dismissals',
    input,
  );
  return data;
}

export async function clearTenantXhsCommanderAlertDismissals() {
  const { data } = await api.delete<XhsCommanderAlertDismissalListResponse>('/api/v1/tenant/cockpit/xhs-events/commander-alert-dismissals');
  return data;
}

export async function fetchTenantXhsCommanderReminderPolicy() {
  const { data } = await api.get<XhsCommanderReminderPolicy>('/api/v1/tenant/cockpit/xhs-events/commander-reminder-policy');
  return data;
}

export async function fetchTenantXhsCommanderReminderPolicyHistory(input?: { limit?: number }) {
  const { data } = await api.get<XhsCommanderReminderPolicyChangeListResponse>(
    '/api/v1/tenant/cockpit/xhs-events/commander-reminder-policy/history',
    { params: input },
  );
  return data;
}

export async function updateTenantXhsCommanderReminderPolicy(input: {
  preset_id?: 'conservative' | 'standard' | 'aggressive';
  queue_open_enabled?: boolean;
  task_running_enabled?: boolean;
  pending_task_enabled?: boolean;
  max_alerts?: number;
}) {
  const { data } = await api.post<XhsCommanderReminderPolicy>('/api/v1/tenant/cockpit/xhs-events/commander-reminder-policy', input);
  return data;
}

export async function createTenantXhsHandoffAction(input: {
  pack_id: string;
  action: XhsHandoffActionType;
  note?: string;
}) {
  const { data } = await api.post<XhsHandoffActionRecord>('/api/v1/tenant/cockpit/xhs-events/handoff-actions', input);
  return data;
}

export async function fetchTenantXhsEchoerFeed(input?: {
  account_id?: string;
  limit?: number;
}) {
  const { data } = await api.get<XhsRoleFeedResponse>('/api/v1/tenant/cockpit/xhs-events/echoer-feed', {
    params: input,
  });
  return data;
}

export async function fetchTenantXhsCatcherFeed(input?: {
  account_id?: string;
  limit?: number;
}) {
  const { data } = await api.get<XhsRoleFeedResponse>('/api/v1/tenant/cockpit/xhs-events/catcher-feed', {
    params: input,
  });
  return data;
}
