export interface DashboardTrendPoint {
  date: string;
  leads: number;
}

export interface DashboardMetrics {
  total_leads_today: number;
  leads_growth_rate: string;
  active_campaigns: number;
  total_videos_published: number;
  node_health_rate: string;
  chart_data_7days: DashboardTrendPoint[];
}

