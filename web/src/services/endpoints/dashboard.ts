/**
 * Dashboard metrics endpoint wrapper.
 * Real backend only. No 伪数据 fallback.
 */

import api from '../api';

export interface DashboardMetrics {
  total_leads_today: number;
  leads_growth_rate: string;
  active_campaigns: number;
  total_videos_published: number;
  node_health_rate: string;
  chart_data_7days: { date: string; leads: number }[];
}

export interface DashboardResponse {
  code: number;
  data: DashboardMetrics;
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const res = await api.get<DashboardResponse | DashboardMetrics>('/api/v1/dashboard/metrics');
  const data = res.data as DashboardResponse & DashboardMetrics;

  if (
    data?.data &&
    typeof data.data === 'object' &&
    Array.isArray((data.data as DashboardMetrics).chart_data_7days)
  ) {
    return data.data as DashboardMetrics;
  }

  if (typeof (data as DashboardMetrics).total_leads_today === 'number') {
    return data as DashboardMetrics;
  }

  throw new Error('invalid dashboard payload');
}

