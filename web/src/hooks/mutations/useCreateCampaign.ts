import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCampaign, type CreateCampaignPayload } from '@/services/endpoints/campaign';

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCampaignPayload) => createCampaign(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
