export type WorkflowLifecycle = 'draft' | 'active' | 'paused' | 'archived';
export type WorkflowExecutionTriggerType = 'manual' | 'cron' | 'webhook' | 'error_compensation' | 'replay';
export type WorkflowStepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'abandoned' | 'skipped';
export type WorkflowRunState = 'queued' | 'running' | 'done' | 'failed' | 'paused' | 'cancelled';

export type WorkflowDefinitionStep = {
  step_id: string;
  agent: string;
  step_type: 'single' | 'loop';
  expects: string;
  max_retries: number;
  retry_delay_seconds?: number;
  loop_over?: string;
};

export type WorkflowDefinitionSummary = {
  id: string;
  name: string;
  description: string;
  step_count: number;
  lifecycle?: WorkflowLifecycle;
  error_workflow_id?: string | null;
  error_notify_channels?: string[];
  source_template_id?: string | null;
  agents: Array<{
    id: string;
    lobster: string;
  }>;
};

export type WorkflowDefinitionDetail = {
  id: string;
  name: string;
  description: string;
  steps: WorkflowDefinitionStep[];
  lifecycle?: WorkflowLifecycle;
  error_workflow_id?: string | null;
  error_notify_channels?: string[];
  source_template_id?: string | null;
  agents: Array<{
    id: string;
    lobster: string;
  }>;
};

export type WorkflowRunStory = {
  story_id: string;
  title: string;
  status: WorkflowStepStatus;
  retry_count: number;
  output_preview: string;
  error_message?: string | null;
  updated_at: string;
};

export type WorkflowRunStep = {
  step_id: string;
  agent_id: string;
  lobster_id: string;
  status: WorkflowStepStatus;
  step_type: 'single' | 'loop';
  retry_count: number;
  max_retries: number;
  expects: string;
  current_story_id?: string | null;
  rendered_input: string;
  output_text: string;
  output_json: Record<string, unknown> | unknown[] | null;
  output_preview: string;
  error_message?: string | null;
  updated_at: string;
  stories: WorkflowRunStory[];
};

export type WorkflowRunStatus = {
  run_id: string;
  run_number: number;
  tenant_id: string;
  workflow_id: string;
  task: string;
  status: WorkflowRunState;
  trigger_type: WorkflowExecutionTriggerType;
  source_execution_id?: string | null;
  replay_from_step_id?: string | null;
  idempotency_key?: string | null;
  current_step_id?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
  steps: WorkflowRunStep[];
};

export type WorkflowRunListItem = {
  run_id: string;
  run_number: number;
  tenant_id: string;
  workflow_id: string;
  task: string;
  status: WorkflowRunState;
  trigger_type: WorkflowExecutionTriggerType;
  source_execution_id?: string | null;
  replay_from_step_id?: string | null;
  idempotency_key?: string | null;
  current_step_id?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowWebhook = {
  webhook_id: string;
  workflow_id: string;
  tenant_id: string;
  name: string;
  http_method: 'POST' | 'GET' | 'ANY';
  auth_type: 'none' | 'header_token' | 'basic_auth';
  auth_config: Record<string, string>;
  response_mode: 'immediate' | 'wait_for_completion';
  is_active: boolean;
  created_at: string;
  last_triggered_at?: string | null;
  trigger_count: number;
  webhook_url?: string;
  webhook_path?: string;
};

export type WorkflowTemplate = {
  template_id: string;
  name: string;
  description: string;
  category: string;
  use_case: string;
  workflow_yaml: string;
  lobsters_required: string[];
  estimated_duration_seconds: number;
  estimated_tokens: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | string;
  tags: string[];
  is_featured: boolean;
  use_count: number;
  created_by: string;
};

export type WorkflowExecutionStreamEvent =
  | { type: 'connected' | 'heartbeat'; execution_id: string; ts: number }
  | {
      type: 'execution_queued' | 'execution_started' | 'execution_completed' | 'execution_failed' | 'execution_cancelled';
      execution_id: string;
      ts: number;
      workflow_id?: string;
      workflow_name?: string;
      task?: string;
      total_steps?: number;
      queue_depth?: number;
      steps_completed?: number;
      failed_step_id?: string | null;
      error?: string;
      status?: string;
    }
  | {
      type: 'step_started' | 'step_completed' | 'step_failed' | 'step_skipped';
      execution_id: string;
      ts: number;
      step_index: number;
      step_id: string;
      lobster_id: string;
      skill_name?: string;
      duration_ms?: number;
      error?: string;
      reason?: string;
      loop_count?: number;
    };
