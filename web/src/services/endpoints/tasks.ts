import api from '../api';
import type { KanbanTaskItem } from '@/types/kanban';

export async function fetchKanbanTasks(recentHours = 24) {
  const { data } = await api.get('/api/v1/tasks/kanban', {
    params: { recent_hours: recentHours },
  });
  return data as {
    ok: boolean;
    items: KanbanTaskItem[];
  };
}
