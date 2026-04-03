import api from '../api';
import type { ModuleSpec } from '@/types/module-registry';

export async function fetchModuleRegistry(lobsterId?: string) {
  const { data } = await api.get('/api/v1/modules', {
    params: lobsterId ? { lobster_id: lobsterId } : undefined,
  });
  return data as {
    ok: boolean;
    items: ModuleSpec[];
  };
}
