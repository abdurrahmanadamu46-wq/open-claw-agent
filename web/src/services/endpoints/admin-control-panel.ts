import api from '../api';

export type AdminResourceMeta = {
  name: string;
  label: string;
  operations: string[];
};

export type AdminResourceItem = Record<string, unknown> & {
  id?: string;
  lobster_id?: string;
  tenant_id?: string;
  job_id?: string;
  edge_id?: string;
  rule_id?: string;
  name?: string;
  display_name?: string;
  title?: string;
  platform?: string;
  status?: string;
  channel?: string;
  description?: string;
};

export async function fetchAdminResources() {
  const { data } = await api.get('/api/v1/ai/admin/resources');
  return data as { ok: boolean; resources: AdminResourceMeta[] };
}

export async function fetchAdminResourceList(resource: string, params?: Record<string, unknown>) {
  const { data } = await api.get(`/api/v1/ai/admin/${resource}`, { params });
  return data as { items: AdminResourceItem[]; total: number; page?: number; page_size?: number };
}

export async function fetchAdminResourceOne(resource: string, id: string, params?: Record<string, unknown>) {
  const { data } = await api.get(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`, { params });
  return data as AdminResourceItem;
}

export async function createAdminResource(resource: string, payload: Record<string, unknown>) {
  const { data } = await api.post(`/api/v1/ai/admin/${resource}`, payload);
  return data as AdminResourceItem;
}

export async function updateAdminResource(resource: string, id: string, payload: Record<string, unknown>, params?: Record<string, unknown>) {
  const { data } = await api.put(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`, payload, { params });
  return data as AdminResourceItem;
}

export async function deleteAdminResource(resource: string, id: string) {
  const { data } = await api.delete(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`);
  return data as Record<string, unknown>;
}
