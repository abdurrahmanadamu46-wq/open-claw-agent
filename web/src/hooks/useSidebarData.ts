'use client';

import { useQuery } from '@tanstack/react-query';
import { getDashboardMetrics } from '@/services/api';
import { getFleetNodes } from '@/services/node.service';
import { getCurrentUser } from '@/services/endpoints/user';

/** 侧栏所需实时数据：今日线索数、龙虾在线数、当前用户角色 */
export function useSidebarData() {
  const { data: metrics } = useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: getDashboardMetrics,
    staleTime: 60 * 1000,
  });

  const { data: nodes = [] } = useQuery({
    queryKey: ['fleet', 'nodes'],
    queryFn: getFleetNodes,
    staleTime: 30 * 1000,
  });

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });

  const leadsToday = metrics?.total_leads_today ?? 0;
  const fleetOnline = nodes.filter((n) => n.status === 'ONLINE' || n.status === 'BUSY').length;
  const role = user?.role ?? 'merchant';

  return {
    leadsToday,
    fleetOnline,
    role,
    isLoading: false,
  };
}
