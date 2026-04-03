export type LeadWebhookStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export type LeadItem = {
  lead_id: string;
  campaign_id: string;
  contact_info: string;
  real_contact_info: string;
  intent_score: number;
  source_platform: string;
  user_message: string;
  captured_at: string;
  webhook_status: LeadWebhookStatus;
  tenant_id: string;
};
