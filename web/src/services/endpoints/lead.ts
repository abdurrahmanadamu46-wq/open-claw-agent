/**
 * 线索 - 对应 GET /api/v1/leads、GET /api/v1/leads/:id/reveal
 */

import api from '../api';

export interface LeadListItem {
  lead_id: string;
  campaign_id: string;
  contact_info: string;
  intent_score: number;
  source_platform: string;
  user_message?: string;
  captured_at: string;
  webhook_status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

export interface LeadListResponse {
  total: number;
  list: LeadListItem[];
}

export async function fetchLeads(params: {
  page: number;
  limit?: number;
  intent_score_min?: number;
}): Promise<LeadListResponse> {
  const { page, limit = 20, intent_score_min } = params;
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (intent_score_min != null) q.set('intent_score_min', String(intent_score_min));
  const { data } = await api.get<{ code: number; data: LeadListResponse }>(`/api/v1/leads?${q}`);
  return data.data;
}

export async function revealLead(leadId: string): Promise<{ contact_info: string }> {
  const { data } = await api.get<{ code: number; data: { contact_info: string } }>(`/api/v1/leads/${leadId}/reveal`);
  return data.data;
}
