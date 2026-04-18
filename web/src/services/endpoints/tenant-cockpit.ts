import api from '../api';
import type {
  CapabilityRouteAuditListResponse,
  CapabilityRouteAuditRecord,
  PlatformFeedbackCandidateListResponse,
  PlatformFeedbackCandidateRecord,
  TenantCockpitOverviewResponse,
} from '@/types/tenant-cockpit';

export async function fetchTenantCockpitOverview(input?: {
  tenant_id?: string;
  recent_hours?: number;
  activity_limit?: number;
  cost_days?: number;
}) {
  const { data } = await api.get('/api/v1/tenant/cockpit', {
    params: input,
  });
  return data as TenantCockpitOverviewResponse;
}

export async function fetchCapabilityRoutes(input?: {
  tenant_id?: string;
  limit?: number;
  workflow_id?: string;
  trace_id?: string;
}) {
  const { data } = await api.get('/api/v1/tenant/cockpit/capability-routes', {
    params: input,
  });
  return data as CapabilityRouteAuditListResponse;
}

export async function fetchCapabilityRouteDetail(auditId: string, tenant_id?: string) {
  const { data } = await api.get(`/api/v1/tenant/cockpit/capability-routes/${encodeURIComponent(auditId)}`, {
    params: tenant_id ? { tenant_id } : undefined,
  });
  return data as { ok: boolean; tenant_id: string; item: CapabilityRouteAuditRecord };
}

export async function fetchPlatformFeedbackCandidates(input?: {
  tenant_id?: string;
  limit?: number;
  eligible_only?: boolean;
  industry_tag?: string;
}) {
  const { data } = await api.get('/api/v1/tenant/cockpit/platform-feedback', {
    params: input,
  });
  return data as PlatformFeedbackCandidateListResponse;
}

export async function fetchPlatformFeedbackCandidateDetail(feedbackId: string, tenant_id?: string) {
  const { data } = await api.get(`/api/v1/tenant/cockpit/platform-feedback/${encodeURIComponent(feedbackId)}`, {
    params: tenant_id ? { tenant_id } : undefined,
  });
  return data as { ok: boolean; tenant_id: string; item: PlatformFeedbackCandidateRecord };
}
