import { useMutation, useQueryClient } from '@tanstack/react-query';
import { terminateCampaign } from '@/services/endpoints/campaign';

export function useTerminateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => terminateCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
