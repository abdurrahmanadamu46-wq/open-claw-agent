/**
 * 与后端 PRD v1.9 / 小明 Phase 3 契约完全一致
 * 供 Cursor 与前端直接消费，无需手写类型
 */

export interface DashboardMetricsResponse {
  total_leads_today: number;
  leads_growth_rate: string;
  active_campaigns: number;
  total_videos_published: number;
  node_health_rate: string;
  chart_data_7days: Array<{ date: string; leads: number }>;
}
