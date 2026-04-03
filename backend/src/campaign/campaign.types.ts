export type CampaignStatus = 'PENDING' | 'PUBLISHING' | 'COMPLETED' | 'TERMINATED';

export interface CampaignRecord {
  campaign_id: string;
  tenant_id: string;
  industry_template_id: string;
  status: CampaignStatus;
  daily_publish_limit: number;
  leads_collected: number;
  created_at: string;
  updated_at: string;
  target_urls: string[];
}

