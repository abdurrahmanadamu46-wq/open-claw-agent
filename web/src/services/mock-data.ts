/**
 * PRD v1.9 示例 Mock 数据，用于前端先画页面、无后端联调
 */

import type { DashboardMetrics } from './endpoints/dashboard';
import type { CampaignListResponse } from './endpoints/campaign';
import type { LeadListResponse } from './endpoints/lead';

export const mockDashboardMetrics: DashboardMetrics = {
  total_leads_today: 142,
  leads_growth_rate: '+15.2%',
  active_campaigns: 5,
  total_videos_published: 1080,
  node_health_rate: '99.2%',
  chart_data_7days: [
    { date: '2026-03-03', leads: 45 },
    { date: '2026-03-04', leads: 60 },
    { date: '2026-03-05', leads: 52 },
    { date: '2026-03-06', leads: 78 },
    { date: '2026-03-07', leads: 91 },
    { date: '2026-03-08', leads: 120 },
    { date: '2026-03-09', leads: 142 },
  ],
};

export const mockCampaignList: CampaignListResponse = {
  total: 24,
  list: [
    {
      campaign_id: 'CAMP_17A9B3',
      industry_template_id: '15秒故事带货',
      status: 'PUBLISHING',
      daily_publish_limit: 3,
      leads_collected: 15,
      created_at: '2026-03-09T10:00:00Z',
    },
    {
      campaign_id: 'CAMP_28B2C4',
      industry_template_id: '10秒爆款短视频',
      status: 'PENDING',
      daily_publish_limit: 5,
      leads_collected: 0,
      created_at: '2026-03-08T14:30:00Z',
    },
  ],
};

export const mockLeadList: LeadListResponse = {
  total: 350,
  list: [
    {
      lead_id: 'LD_9921',
      campaign_id: 'CAMP_17A9B3',
      contact_info: '138****1234',
      intent_score: 95,
      source_platform: 'douyin',
      user_message: '请问这个系统怎么卖？支持私有化部署吗？',
      captured_at: '2026-03-09T14:20:00Z',
      webhook_status: 'SUCCESS',
    },
    {
      lead_id: 'LD_9922',
      campaign_id: 'CAMP_17A9B3',
      contact_info: '小红***书',
      intent_score: 92,
      source_platform: 'xiaohongshu',
      user_message: '这款怎么卖？求链接',
      captured_at: '2026-03-09T13:55:00Z',
      webhook_status: 'SUCCESS',
    },
    {
      lead_id: 'LD_9923',
      campaign_id: 'CAMP_28B2C4',
      contact_info: '189****5678',
      intent_score: 65,
      source_platform: 'douyin',
      user_message: '有优惠吗？',
      captured_at: '2026-03-09T12:10:00Z',
      webhook_status: 'PENDING',
    },
    {
      lead_id: 'LD_9924',
      campaign_id: 'CAMP_28B2C4',
      contact_info: '用户***888',
      intent_score: 42,
      source_platform: 'xiaohongshu',
      user_message: '路过看看',
      captured_at: '2026-03-09T11:00:00Z',
      webhook_status: 'FAILED',
    },
  ],
};
