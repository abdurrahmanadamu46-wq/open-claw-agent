import api from '../api';
import type { ExperimentReport, PromptExperiment } from '@/types/prompt-experiment';
import type {
  AiExperimentCompareResponse,
  AiExperimentListResponse,
  AiExperimentSummary,
  AiPromptDiffResponse,
} from '@/types/ai-experiments';

export type Experiment = {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  sample_count?: number;
};

export async function fetchExperiments() {
  const { data } = await api.get<AiExperimentListResponse>('/api/v1/ai/experiments');
  return data as { experiments: Experiment[] | AiExperimentSummary[] };
}

export async function fetchExperiment(id: string) {
  const { data } = await api.get(`/api/v1/ai/experiments/${encodeURIComponent(id)}`);
  return data as Experiment | AiExperimentSummary;
}

export async function runExperiment(id: string) {
  const { data } = await api.post(`/api/v1/ai/experiments/${encodeURIComponent(id)}/run`);
  return data;
}

export async function listAiExperiments() {
  const { data } = await api.get<AiExperimentListResponse>('/api/v1/ai/experiments');
  return data;
}

export async function compareAiExperiments(payload: { a: string; b: string }) {
  const { data } = await api.get<AiExperimentCompareResponse>('/api/v1/ai/experiments/compare', {
    params: payload,
  });
  return data;
}

export async function diffAiPromptVersions(promptName: string, versions?: { version_a?: string; version_b?: string }) {
  const { data } = await api.get<AiPromptDiffResponse>(`/api/v1/ai/prompts/${encodeURIComponent(promptName)}/diff`, {
    params: versions,
  });
  return data;
}

export async function fetchPromptExperiments() {
  const { data } = await api.get('/api/v1/prompt-experiments');
  return data as { ok: boolean; items: PromptExperiment[] };
}

export async function createPromptExperiment(payload: {
  lobster_name: string;
  skill_name: string;
  rollout_percent: number;
  experiment_variant: string;
  prompt_text: string;
  environment?: 'dev' | 'staging' | 'prod';
}) {
  const { data } = await api.post('/api/v1/prompt-experiments', payload);
  return data as { ok: boolean; flag: Record<string, unknown>; prompt_path: string };
}

export async function fetchPromptExperimentReport(flagName: string) {
  const { data } = await api.get(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/report`);
  return data as { ok: boolean; report: ExperimentReport };
}

export async function promotePromptExperiment(flagName: string, winnerVariant: string) {
  const { data } = await api.post(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/promote`, {
    winner_variant: winnerVariant,
  });
  return data as { ok: boolean };
}

export async function stopPromptExperiment(flagName: string) {
  const { data } = await api.post(`/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/stop`);
  return data as { ok: boolean };
}
