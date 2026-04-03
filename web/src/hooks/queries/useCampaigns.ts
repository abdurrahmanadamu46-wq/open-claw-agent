import { useQuery } from '@tanstack/react-query';
import { fetchCampaigns } from '@/services/endpoints/campaign';

export function useCampaigns(page: number, status?: string) {
  return useQuery({
    queryKey: ['campaigns', page, status],
    queryFn: () => fetchCampaigns({ page, limit: 10, status }),
    staleTime: 1000 * 60 * 5,
  });
}
