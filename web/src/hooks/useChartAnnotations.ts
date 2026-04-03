'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchChartAnnotations } from '@/services/endpoints/ai-subservice';

export function useChartAnnotations(input: {
  tenant_id?: string;
  start_time?: string;
  end_time?: string;
  lobster_id?: string;
  annotation_types?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['chart-annotations', input],
    queryFn: () => fetchChartAnnotations(input),
    enabled: Boolean(input.start_time && input.end_time),
    staleTime: 60_000,
  });
}
