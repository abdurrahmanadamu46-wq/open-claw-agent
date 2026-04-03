import api from '../api';
import type { IndustryWorkflowBlueprint, IndustryWorkflowRequest } from '@/lib/industry-workflow';

export async function previewIndustryWorkflow(request: IndustryWorkflowRequest) {
  const { data } = await api.post('/api/industry-workflow/preview', { request });
  return data as {
    ok: boolean;
    request: IndustryWorkflowRequest;
    blueprint: IndustryWorkflowBlueprint;
    task_description: string;
  };
}
