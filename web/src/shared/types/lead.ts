/**
 * 与后端 PRD v1.9 / 小明 Phase 3 契约完全一致
 * 列表接口返回 contact_info 已脱敏（138****5678）
 */

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

export interface LeadRevealResponse {
  contact_info: string;
}
