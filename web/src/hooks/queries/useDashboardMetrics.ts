import { useQuery } from '@tanstack/react-query';
import { fetchDashboardMetrics } from '@/services/endpoints/dashboard';

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: fetchDashboardMetrics,
    staleTime: 1000 * 60 * 5,
  });
}
