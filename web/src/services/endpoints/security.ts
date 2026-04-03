import api from '../api';
import type { OperationAuditLogListResponse, OperationAuditLogQuery } from '@/types/security-audit';

export async function fetchOperationAuditLogs(input?: OperationAuditLogQuery) {
  const { data } = await api.get<OperationAuditLogListResponse>('/api/v1/audit/logs', {
    params: input,
  });
  return data;
}

export async function fetchEdgeSecurityReports(input?: { node_id?: string; limit?: number }) {
  const { data } = await api.get<{ code: number; data: { list: unknown[] } }>('/api/security/reports', {
    params: input,
  });
  return data?.data?.list ?? [];
}

export async function fetchEdgeSecurityReportDetail(reportId: string) {
  const { data } = await api.get<{ code: number; data: unknown }>(`/api/security/reports/${encodeURIComponent(reportId)}`);
  return data?.data ?? null;
}

export async function triggerEdgeSecurityAudit(input: { node_id: string; session_id?: string }) {
  const { data } = await api.post<{ code: number; data: { ok: boolean } }>('/api/security/audit/trigger', input);
  return data?.data ?? { ok: false };
}

export async function rebuildEdgeSecurityBaseline(input: {
  node_id: string;
  type?: 'credential' | 'sop' | 'all';
  session_id?: string;
}) {
  const { data } = await api.post<{ code: number; data: { ok: boolean } }>('/api/security/baseline/rebuild', input);
  return data?.data ?? { ok: false };
}

export async function fetchEdgeSecurityKnownIssues(input?: { node_id?: string }) {
  const { data } = await api.get<{ code: number; data: { list: unknown[] } }>('/api/security/known-issues', {
    params: input,
  });
  return data?.data?.list ?? [];
}

export async function createEdgeSecurityKnownIssue(input: {
  node_id?: string;
  check_name: string;
  pattern: string;
  reason: string;
}) {
  const { data } = await api.post<{ code: number; data: unknown }>('/api/security/known-issues', input);
  return data?.data ?? null;
}

export async function deleteEdgeSecurityKnownIssue(issueId: string) {
  const { data } = await api.delete<{ code: number; data: { ok: boolean } }>(
    `/api/security/known-issues/${encodeURIComponent(issueId)}`,
  );
  return data?.data ?? { ok: false };
}
