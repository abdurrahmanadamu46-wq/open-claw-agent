export type AiExperimentSummary = {
  id?: string;
  experiment_id?: string;
  experimentName?: string;
  name?: string;
  status?: string;
  state?: string;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type AiExperimentListResponse = {
  ok?: boolean;
  experiments?: AiExperimentSummary[];
  items?: AiExperimentSummary[];
  data?: { experiments?: AiExperimentSummary[] };
  count?: number;
  total?: number;
  [key: string]: unknown;
};

export type AiExperimentCompareResponse = Record<string, unknown>;

export type AiPromptDiffResponse = Record<string, unknown>;
