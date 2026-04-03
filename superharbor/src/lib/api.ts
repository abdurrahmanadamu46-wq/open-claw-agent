/**
 * SuperHarbor 统一业务网关 API 客户端
 * 与架构图中的「统一业务网关」对接，触发云端 AI 编排工作流
 */

import type { CampaignCreatePayload } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true' || !API_BASE;

export async function createCampaign(payload: CampaignCreatePayload): Promise<{ campaignId: string }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800));
    return { campaignId: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` };
  }
  const res = await fetch(`${API_BASE}/api/v1/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_account_urls: payload.targetAccountUrls.split(/\r?\n/).filter(Boolean),
      product_name: payload.productName,
      sell_points: payload.sellPoints.split(/\r?\n/).filter(Boolean),
      sop_template_id: payload.sopTemplateId,
      tenant_id: payload.tenantId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || res.statusText || '创建战役失败');
  }
  return res.json();
}
