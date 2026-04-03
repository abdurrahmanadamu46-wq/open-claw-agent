/**
 * ClawCommerce Agent - 线索回传（战果回收）
 * POST 到后端内部 API，携带 x-internal-secret；后端负责 AES 落库与 lead-webhook-queue。
 * @module agent/lead/lead-pusher
 */

import type { ILeadSubmissionPayload } from '../../shared/contracts.js';
import { createLogger } from '../logger.js';

const logger = createLogger('lead-pusher');

const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3000';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

/**
 * 与后端 CreateInternalLeadDto 对齐的请求体（含 source_platform、raw_context）
 */
export interface LeadPushPayload {
  tenant_id: string;
  campaign_id: string;
  contact_info: string;
  intention_score: number;
  source_platform: string;
  raw_context?: string;
}

function toLeadPushPayload(p: ILeadSubmissionPayload): LeadPushPayload {
  return {
    tenant_id: p.tenant_id,
    campaign_id: p.campaign_id,
    contact_info: p.contact_info,
    intention_score: p.intention_score,
    source_platform: (p as LeadPushPayload).source_platform ?? (p.source ?? 'unknown'),
    raw_context: (p as LeadPushPayload).raw_context,
  };
}

export interface LeadPushResult {
  ok: boolean;
  lead_id?: string;
  message?: string;
  error?: string;
}

/**
 * 将单条线索推送到后端内部 API。
 * 请求头必须携带 x-internal-secret，由后端 InternalApiGuard 校验。
 */
export async function pushLeadToBackend(payload: ILeadSubmissionPayload): Promise<LeadPushResult> {
  if (!INTERNAL_API_SECRET) {
    logger.warn('INTERNAL_API_SECRET not set, lead push may be rejected');
  }
  const url = `${BACKEND_INTERNAL_URL.replace(/\/$/, '')}/api/internal/leads`;
  const body = toLeadPushPayload(payload);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_API_SECRET,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; lead_id?: string };
    if (!res.ok) {
      logger.error('Lead push failed', { status: res.status, body: data });
      return {
        ok: false,
        error: (data as { message?: string }).message ?? `HTTP ${res.status}`,
      };
    }
    logger.info('Lead pushed', { lead_id: data.lead_id, campaign_id: payload.campaign_id });
    return {
      ok: true,
      lead_id: data.lead_id,
      message: data.message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Lead push request failed', { error: message });
    return { ok: false, error: message };
  }
}
