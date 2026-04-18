export type EdgeDoctorOverallStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface EdgeDoctorSummary {
  node_id: string;
  generated_at: string;
  overall_status: EdgeDoctorOverallStatus;
  failed_checks: string[];
  warn_checks: string[];
  check_count: number;
  recommended_actions: string[];
}

export interface EdgeDoctorRunRequest {
  requested_at?: string;
  requested_by?: string;
  status?: string;
  mode?: string;
  completed_at?: string;
}

export interface EdgeDoctorDetailResponse {
  ok: boolean;
  edge_id: string;
  doctor: Partial<EdgeDoctorSummary>;
  doctor_overall_status: string;
  doctor_failed_checks: string[];
  doctor_warn_checks: string[];
  requested_run?: EdgeDoctorRunRequest;
  updated_at?: string;
}
