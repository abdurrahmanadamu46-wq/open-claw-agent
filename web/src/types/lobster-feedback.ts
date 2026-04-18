export interface LobsterFeedbackItem {
  feedback_id: string;
  task_id: string;
  lobster_id: string;
  tenant_id: string;
  user_id: string;
  rating: string;
  tags: string[];
  comment?: string;
  revised_output?: string;
  input_prompt?: string;
  original_output?: string;
  created_at: string;
}

export interface LobsterQualityStats {
  lobster_id: string;
  tenant_id: string;
  days: number;
  total_feedbacks: number;
  thumbs_up: number;
  thumbs_down: number;
  satisfaction_rate?: number | null;
  avg_star?: number | null;
  top_tags: Array<{ tag: string; count: number }>;
  timeline: Array<{ created_at: string; rating: string }>;
}

export interface LobsterFeedbackSubmitPayload {
  task_id: string;
  lobster_id: string;
  skill_id?: string;
  rating: string;
  tags?: string[];
  comment?: string;
  revised_output?: string;
  input_prompt?: string;
  original_output?: string;
}
