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
  respondent?: string;
};

export type SurveyListResponse = {
  ok?: boolean;
  count?: number;
  surveys: SurveySummary[];
  metadata?: Record<string, unknown>;
};

export type SurveyResponsePayload = {
  tenant_id?: string;
  survey_id: string;
  responder?: string;
  answers: Record<string, unknown>;
  notes?: string;
};

export type SurveyResponseResult = {
  ok: boolean;
  submitted_at?: string;
  result?: SurveyResult;
};

export type SurveyCreatePayload = Record<string, unknown>;
