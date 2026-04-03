import api from '../api';
import type { TemporalGraphEdge, TemporalGraphSnapshot } from '@/types/temporal-graph';

export async function fetchTemporalGraphSnapshot(tenantId: string) {
  const { data } = await api.get(`/api/v1/graph/${encodeURIComponent(tenantId)}/snapshot`);
  return data as {
    status: 'success';
    data: TemporalGraphSnapshot;
  };
}

export async function fetchTemporalGraphTimeline(input: {
  tenantId: string;
  entityName: string;
  leadId?: string;
  limit?: number;
}) {
  const { data } = await api.get(`/api/v1/graph/${encodeURIComponent(input.tenantId)}/timeline`, {
    params: {
      entity_name: input.entityName,
      ...(input.leadId ? { lead_id: input.leadId } : {}),
      ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    },
  });
  return data as {
    status: 'success';
    data: TemporalGraphEdge[];
  };
}
