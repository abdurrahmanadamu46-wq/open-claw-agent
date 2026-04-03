import api from '../api';
import type {
  FeatureFlag,
  FlagCheckResult,
  FlagStrategy,
  FlagVariant,
} from '@/types/feature-flags';

export async function fetchFeatureFlags(input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.get('/api/v1/feature-flags', { params: input });
  return data as { ok: boolean; flags: FeatureFlag[] };
}

export async function createFeatureFlag(payload: {
  name: string;
  description?: string;
  enabled?: boolean;
  environment?: 'dev' | 'staging' | 'prod';
  strategies?: FlagStrategy[];
  variants?: FlagVariant[];
  tenant_id?: string;
  tags?: string[];
}) {
  const { data } = await api.post('/api/v1/feature-flags', payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function updateFeatureFlag(name: string, payload: Partial<FeatureFlag>) {
  const { data } = await api.put(`/api/v1/feature-flags/${encodeURIComponent(name)}`, payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function enableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/enable`, {}, { params: input });
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function disableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/disable`, {}, { params: input });
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function toggleFeatureFlag(name: string, enable: boolean, input?: { environment?: string; tenant_id?: string }) {
  return enable ? enableFeatureFlag(name, input) : disableFeatureFlag(name, input);
}

export async function deleteFeatureFlag(name: string) {
  const { data } = await api.delete(`/api/v1/feature-flags/${encodeURIComponent(name)}`);
  return data as { ok: boolean; deleted: boolean };
}

export async function updateFeatureFlagStrategies(name: string, payload: { environment?: string; tenant_id?: string; strategies: FlagStrategy[] }) {
  const { data } = await api.post(`/api/v1/feature-flags/${encodeURIComponent(name)}/strategies`, payload);
  return data as { ok: boolean; flag: FeatureFlag };
}

export async function fetchFeatureFlagChangelog(input?: { limit?: number; environment?: string; tenant_id?: string }) {
  const { data } = await api.get('/api/v1/feature-flags/changelog', { params: input });
  return data as { ok: boolean; items: Array<Record<string, unknown>> };
}

export async function checkFeatureFlag(payload: {
  flag_name: string;
  tenant_id: string;
  environment?: string;
  lobster_id?: string;
  channel?: string;
}) {
  const { data } = await api.post('/api/v1/feature-flags/check', payload);
  return data as FlagCheckResult;
}
