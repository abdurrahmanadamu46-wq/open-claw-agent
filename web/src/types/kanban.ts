export type KanbanTaskStatus = 'pending' | 'running' | 'done' | 'blocked';

export interface KanbanTaskItem {
  task_id: string;
  lobster_name: string;
  title: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | string;
  created_at: number | string;
  updated_at?: string | null;
  error_msg?: string | null;
  task_type?: string | null;
  source?: string | null;
}
