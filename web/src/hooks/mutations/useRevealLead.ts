import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revealLead } from '@/services/endpoints/lead';

export function useRevealLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => revealLead(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
