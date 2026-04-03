import api from '../api';
import type { CustomerMindMap, MindMapNode, MindMapNodeUpdateRequest } from '@/types/customer-mind-map';

export async function fetchCustomerMindMap(tenantId: string, leadId: string) {
  const { data } = await api.get(`/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}`);
  return data as {
    ok: boolean;
    mind_map: CustomerMindMap;
  };
}

export async function fetchCustomerMindMapQuestions(tenantId: string, leadId: string, limit = 3) {
  const { data } = await api.get(
    `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/questions`,
    { params: { limit } },
  );
  return data as {
    ok: boolean;
    questions: string[];
  };
}

export async function fetchCustomerMindMapBriefing(tenantId: string, leadId: string) {
  const { data } = await api.get(
    `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/briefing`,
  );
  return data as {
    ok: boolean;
    briefing: string;
  };
}

export async function updateCustomerMindMapNode(
  tenantId: string,
  leadId: string,
  dimension: string,
  payload: MindMapNodeUpdateRequest,
) {
  const { data } = await api.post(
    `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/nodes/${encodeURIComponent(dimension)}`,
    payload,
  );
  return data as {
    ok: boolean;
    mind_map: CustomerMindMap;
    updated_node: MindMapNode;
  };
}
