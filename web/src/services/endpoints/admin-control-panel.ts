import api from '../api';

export type AdminResourceMeta = {
  name: string;
  label: string;
  operations: string[];
};

export async function fetchAdminResources() {
  const { data } = await api.get('/api/v1/ai/admin/resources');
  return data as { ok: boolean; resources: AdminResourceMeta[] };
}

export async function fetchAdminResourceList(resource: string, params?: Record<string, unknown>) {
  const { data } = await api.get(`/api/v1/ai/admin/${resource}`, { params });
  return data as { items: Record<string, unknown>[]; total: number; page?: number; page_size?: number };
}

export async function fetchAdminResourceOne(resource: string, id: string, params?: Record<string, unknown>) {
  const { data } = await api.get(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`, { params });
  return data as Record<string, unknown>;
}

export async function createAdminResource(resource: string, payload: Record<string, unknown>) {
  const { data } = await api.post(`/api/v1/ai/admin/${resource}`, payload);
  return data as Record<string, unknown>;
}

export async function updateAdminResource(resource: string, id: string, payload: Record<string, unknown>, params?: Record<string, unknown>) {
  const { data } = await api.put(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`, payload, { params });
  return data as Record<string, unknown>;
}

export async function deleteAdminResource(resource: string, id: string) {
  const { data } = await api.delete(`/api/v1/ai/admin/${resource}/${encodeURIComponent(id)}`);
  return data as Record<string, unknown>;
}
