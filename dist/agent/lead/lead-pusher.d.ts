/**
 * ClawCommerce Agent - 线索回传（战果回收）
 * POST 到后端内部 API，携带 x-internal-secret；后端负责 AES 落库与 lead-webhook-queue。
 * @module agent/lead/lead-pusher
 */
import type { ILeadSubmissionPayload } from '../../shared/contracts.js';
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
export declare function pushLeadToBackend(payload: ILeadSubmissionPayload): Promise<LeadPushResult>;
//# sourceMappingURL=lead-pusher.d.ts.map