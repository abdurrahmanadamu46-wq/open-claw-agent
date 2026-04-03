import api from '../api';
import type { PluginAdapterConfig, TenantIntegrations } from '@/types/integrations';

export async function fetchIntegrations(): Promise<TenantIntegrations> {
  const { data } = await api.get<{ code: number; data: TenantIntegrations }>('/api/v1/tenant/integrations');
  return data?.data ?? {};
}

export async function updateIntegrations(patch: Partial<TenantIntegrations>): Promise<TenantIntegrations> {
  const { data } = await api.patch<{ code: number; data: TenantIntegrations }>('/api/v1/tenant/integrations', patch);
  return data?.data ?? {};
}

export async function sendTestWebhook(): Promise<{ code: number; message?: string; jobId?: string }> {
  const { data } = await api.post<{ code: number; message?: string; jobId?: string }>(
    '/api/v1/tenant/integrations/webhook/test',
  );
  return data ?? { code: 1 };
}

export async function testPluginAdapter(
  adapter: Partial<PluginAdapterConfig>,
): Promise<{ code: number; data?: { ok: boolean; reason?: string; health?: unknown }; message?: string }> {
  const { data } = await api.post<{
    code: number;
    data?: { ok: boolean; reason?: string; health?: unknown };
    message?: string;
  }>('/api/v1/tenant/integrations/adapter/test', { adapter });
  return data ?? { code: 1, message: 'adapter test failed' };
}
