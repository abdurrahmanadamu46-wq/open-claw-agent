export type AiEdgeTarget = {
  edge_id: string;
  account_id?: string;
  webhook_url?: string;
  instruction_hint?: string;
  skills?: string[];
  skill_manifest_path?: string;
  skill_commands?: string[];
  skill_manifest_meta?: Record<string, unknown>;
};

export type RunDragonTeamInput = {
  task_description: string;
  user_id: string;
  industry?: string;
  industry_tag?: string;
  competitor_handles?: string[];
  edge_targets?: AiEdgeTarget[];
  client_preview?: Record<string, unknown>;
  industry_workflow_context?: Record<string, unknown>;
  execution_mode?: 'assistive' | 'auto';
};

export type RunDragonTeamAsyncAccepted = {
  ok: boolean;
  job_id: string;
  status: string;
  status_url: string;
  request_id: string;
};

export type RunDragonTeamAsyncStatus = {
  ok: boolean;
  job_id: string;
  status: string;
  request_id: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  user_id: string;
  tenant_id: string;
  thread_id?: string | null;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

export type AnalyzeCompetitorInput = {
  target_account_url: string;
  user_id: string;
  competitor_handles?: string[];
};

export type AiServiceLoginResponse = {
  access_token: string;
  expires_in?: number;
  token_type?: string;
};

export type AiPublicAuthMeResponse = {
  username?: string;
  tenant_id?: string;
  roles?: string[];
  token_exp?: number;
};

export type AnalyticsAttributionResponse = {
  model?: string;
  start?: string;
  end?: string;
  tenant_id?: string;
  totals?: Record<string, number>;
  series?: Array<{ name: string; value: number; share?: number }>;
  highlights?: Array<{ label: string; value: string | number }>;
};

export type AnalyticsFunnelStage = {
  name: string;
  value: number;
  dropoff?: number;
  conversion_rate?: number;
};

export type AnalyticsFunnelResponse = {
  tenant_id?: string;
  start?: string;
  end?: string;
  stages?: AnalyticsFunnelStage[];
  totals?: Record<string, number>;
};

export type SurveySummary = {
  survey_id: string;
  name?: string;
  description?: string;
  tenant_id?: string;
  created_at?: string;
};

export type SurveyResult = {
  survey_id: string;
  answers: Record<string, unknown>;
  submitted_at?: string;
};

export type SurveyCreatePayload = Record<string, unknown>;

export type SurveyResponsePayload = Record<string, unknown>;

export type SurveyReplyResponse = {
  ok: boolean;
  submitted_at?: string;
  result?: SurveyResult;
};

export type NlQueryPayload = {
  tenant_id?: string;
  query: string;
  context?: Record<string, unknown>;
};

export type NlQueryResponse = {
  ok: boolean;
  answer?: string;
  metadata?: Record<string, unknown>;
};
