export type VoiceProfileStatus = 'review' | 'approved' | 'rejected' | 'disabled' | 'revoked';
export type VoiceConsentStatus = 'review' | 'active' | 'rejected' | 'revoked';
export type VoiceArtifactType = 'voice' | 'subtitle' | 'dub_job';

export interface VoiceQualityCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VoiceQualityReport {
  ok: boolean;
  file_path: string;
  file_size_bytes: number;
  extension: string;
  duration_sec: number;
  sample_rate: number;
  checks: VoiceQualityCheck[];
  error: string;
}

export interface VoiceProfile {
  profile_id: string;
  tenant_id: string;
  name: string;
  owner_type: string;
  reference_audio_path: string;
  voice_prompt: string;
  language: string;
  sample_rate: number;
  consent_doc_id: string;
  clone_enabled: boolean;
  status: VoiceProfileStatus;
  enabled: boolean;
  review_note: string;
  reviewed_by: string;
  reviewed_at: string;
  revoked_at: string;
  tags: string[];
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VoiceConsent {
  consent_id: string;
  tenant_id: string;
  owner_name: string;
  owner_type: string;
  consent_doc_id: string;
  scope: string;
  reference_audio_path: string;
  status: VoiceConsentStatus;
  notes: string;
  review_note: string;
  reviewed_by: string;
  reviewed_at: string;
  revoked_at: string;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VoiceJob {
  job_id: string;
  run_id: string;
  lobster_id: string;
  status: string;
  voice_mode: string;
  provider: string;
  audio_path: string;
  subtitle_srt_path: string;
  voice_artifact_id: string;
  voice_profile_id: string;
  quality_report: VoiceQualityReport | Record<string, unknown>;
  content_preview: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceArtifactSummary {
  artifact_id: string;
  run_id: string;
  lobster_id: string;
  artifact_type: VoiceArtifactType;
  content_preview: string;
  content_url: string;
  status: string;
  score: number | null;
  created_at: string;
}

export interface VoiceHealthResponse {
  ok: boolean;
  service: string;
  provider: string;
  backend: Record<string, unknown>;
}

export interface VoiceProfileListResponse {
  ok: boolean;
  count: number;
  items: VoiceProfile[];
}

export interface VoiceProfileDetailResponse {
  ok: boolean;
  profile: VoiceProfile;
}

export interface VoiceConsentListResponse {
  ok: boolean;
  count: number;
  items: VoiceConsent[];
}

export interface VoiceConsentDetailResponse {
  ok: boolean;
  consent: VoiceConsent;
}

export interface VoiceJobListResponse {
  ok: boolean;
  count: number;
  items: VoiceJob[];
}

export interface VoiceJobDetailResponse {
  ok: boolean;
  job: VoiceJob;
  voice_artifact: Record<string, unknown> | null;
  subtitles: Array<Record<string, unknown>>;
}

export interface VoiceArtifactListResponse {
  ok: boolean;
  count: number;
  items: VoiceArtifactSummary[];
}

export interface VoiceSynthesizeResponse {
  ok: boolean;
  provider: string;
  mode: string;
  audio_path: string;
  subtitle_srt_path: string;
  duration_sec: number;
  fallback_used: boolean;
  quality_report: VoiceQualityReport | Record<string, unknown>;
  artifact_ids: string[];
}

export interface VoiceReviewPatchPayload {
  status: string;
  note?: string;
}

export interface VoiceProfileCreatePayload {
  name: string;
  owner_type: string;
  reference_audio_path: string;
  voice_prompt?: string;
  language?: string;
  sample_rate?: number;
  consent_doc_id?: string;
  clone_enabled?: boolean;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface VoiceConsentCreatePayload {
  owner_name: string;
  owner_type: string;
  consent_doc_id: string;
  scope: string;
  reference_audio_path: string;
  notes?: string;
  meta?: Record<string, unknown>;
}

export interface VoiceSynthesizePayload {
  text: string;
  lobster_id?: string;
  run_id?: string;
  voice_mode?: string;
  voice_prompt?: string;
  voice_profile_id?: string;
  voice_profile?: Record<string, unknown>;
  subtitle_required?: boolean;
  step_index?: number;
  triggered_by?: string;
  meta?: Record<string, unknown>;
}
