'use client';

import { useQuery } from '@tanstack/react-query';

import {
  fetchScopeRolloutTrend,
  type ScopeRolloutTrendItem,
} from '@/services/endpoints/agent-dashboard';

export function useScopeRolloutTrend() {
  const query = useQuery({
    queryKey: ['agent', 'scope-rollout-trend'],
    queryFn: fetchScopeRolloutTrend,
    refetchInterval: 60000,
  });

  const scopes: ScopeRolloutTrendItem[] = query.data?.scopes ?? [];

  return {
    scopes,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
