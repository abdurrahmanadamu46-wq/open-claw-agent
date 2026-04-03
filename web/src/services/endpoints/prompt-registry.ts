import api from '../api';
import type {
  PromptRegistryDiff,
  PromptRegistryListItem,
  PromptRegistryVersionItem,
} from '@/types/prompt-registry';

export async function fetchPromptRegistry(lobster?: string) {
  const { data } = await api.get('/api/v1/prompts', {
    params: lobster ? { lobster } : undefined,
  });
  return data as {
    ok: boolean;
    items: PromptRegistryListItem[];
  };
}

export async function fetchPromptVersions(promptName: string) {
  const { data } = await api.get(`/api/v1/prompts/${encodeURIComponent(promptName)}/versions`);
  return data as {
    ok: boolean;
    items: PromptRegistryVersionItem[];
  };
}

export async function fetchPromptDiff(promptName: string, versionA: number, versionB: number) {
  const { data } = await api.get(`/api/v1/ai/prompts/${encodeURIComponent(promptName)}/diff`, {
    params: {
      version_a: versionA,
      version_b: versionB,
    },
  });
  return data as PromptRegistryDiff;
}
