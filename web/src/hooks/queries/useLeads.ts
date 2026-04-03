import { useQuery } from '@tanstack/react-query';
import { fetchLeads } from '@/services/endpoints/lead';

export function useLeads(page: number, intentScoreMin?: number) {
  return useQuery({
    queryKey: ['leads', page, intentScoreMin],
    queryFn: () => fetchLeads({ page, limit: 20, intent_score_min: intentScoreMin }),
    staleTime: 1000 * 60 * 2,
  });
}
