import api from '../api';
import type {
  ControlPlaneKnowledgeOverviewResponse,
  ControlPlaneKnowledgeResolveResponse,
  ControlPlaneTenantPrivateSummariesResponse,
  ControlPlaneMonitorOverviewResponse,
  ControlPlaneSupervisorCapabilityGraphResponse,
  ControlPlaneSupervisorsOverviewResponse,
  KnowledgeLayer,
} from '@/types/control-plane-overview';

export async function fetchControlPlaneSupervisorsOverview(input?: { tenant_id?: string }) {
  const { data } = await api.get('/api/v1/control-plane/supervisors/overview', {
    params: input,
  });
  return data as ControlPlaneSupervisorsOverviewResponse;
}

export async function fetchControlPlaneKnowledgeOverview(input: { tenant_id: string }) {
  const { data } = await api.get('/api/v1/control-plane/knowledge/overview', {
    params: input,
  });
  return data as ControlPlaneKnowledgeOverviewResponse;
}

export async function fetchControlPlaneTenantPrivateKnowledgeSummaries(input: {
  tenant_id: string;
  limit?: number;
  source_type?: string;
}) {
  const { data } = await api.get('/api/v1/control-plane/knowledge/tenant-private-summaries', {
    params: input,
  });
  return data as ControlPlaneTenantPrivateSummariesResponse;
}

export async function resolveControlPlaneKnowledge(input: {
  tenant_id: string;
  role_id: string;
  industry_tag?: string;
  task_type?: string;
  requested_layers: KnowledgeLayer[];
}) {
  const { data } = await api.post('/api/v1/control-plane/knowledge/resolve', input);
  return data as ControlPlaneKnowledgeResolveResponse;
}

export async function fetchControlPlaneSupervisorCapabilityGraph(input: { tenant_id: string }) {
  const { data } = await api.get('/api/v1/control-plane/supervisors/capability-graph', {
    params: input,
  });
  return data as ControlPlaneSupervisorCapabilityGraphResponse;
}

export async function fetchControlPlaneMonitorOverview(input: { tenant_id: string; subject_prefix?: string }) {
  const { data } = await api.get('/api/v1/control-plane/monitor/overview', {
    params: input,
  });
  return data as ControlPlaneMonitorOverviewResponse;
}
