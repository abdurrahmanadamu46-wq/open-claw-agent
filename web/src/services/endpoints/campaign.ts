/**
 * Campaign 任务 - 对应 PRD v1.9 POST/GET /api/v1/campaigns、terminate
 */

import api from '../api';

export interface CampaignListItem {
  campaign_id: string;
  industry_template_id: string;
  status: string;
  daily_publish_limit: number;
  leads_collected: number;
  created_at: string;
}

export interface CampaignListResponse {
  total: number;
  list: CampaignListItem[];
}

export interface CreateCampaignPayload {
  industry_template_id: string;
  target_urls: string[];
  content_strategy: { template_type: string; min_clips: number; max_clips: number };
  publish_strategy?: { daily_limit: number; active_hours: string[] };
  bind_accounts?: string[];
}

export async function fetchCampaigns(params: { page: number; limit?: number; status?: string }): Promise<CampaignListResponse> {
  const { page, limit = 10, status } = params;
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) q.set('status', status);
  const { data } = await api.get<{ code: number; data: CampaignListResponse }>(`/api/v1/campaigns?${q}`);
  return data.data;
}

export async function createCampaign(payload: CreateCampaignPayload): Promise<{ campaign_id: string; status: string }> {
  const { data } = await api.post<{ code: number; data: { campaign_id: string; status: string } }>('/api/v1/campaigns', payload);
  return data.data;
}

export async function terminateCampaign(campaignId: string): Promise<void> {
  await api.post(`/api/v1/campaigns/${campaignId}/terminate`);
}
