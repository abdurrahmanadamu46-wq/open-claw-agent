import api from '../api';
import type {
  VoiceArtifactListResponse,
  VoiceConsentCreatePayload,
  VoiceConsentDetailResponse,
  VoiceConsentListResponse,
  VoiceHealthResponse,
  VoiceJobDetailResponse,
  VoiceJobListResponse,
  VoiceProfileCreatePayload,
  VoiceProfileDetailResponse,
  VoiceProfileListResponse,
  VoiceReviewPatchPayload,
  VoiceSynthesizePayload,
  VoiceSynthesizeResponse,
} from '@/types/voice';

export async function fetchVoiceHealth() {
  const { data } = await api.get('/api/v1/voice/health');
  return data as VoiceHealthResponse;
}

export async function fetchVoiceProfiles(input?: {
  status?: string;
  owner_type?: string;
  clone_enabled?: boolean;
}) {
  const { data } = await api.get('/api/v1/voice/profiles', { params: input });
  return data as VoiceProfileListResponse;
}

export async function createVoiceProfile(payload: VoiceProfileCreatePayload) {
  const { data } = await api.post('/api/v1/voice/profiles', payload);
  return data as VoiceProfileDetailResponse & { artifact_id?: string };
}

export async function fetchVoiceProfile(profileId: string) {
  const { data } = await api.get(`/api/v1/voice/profiles/${encodeURIComponent(profileId)}`);
  return data as VoiceProfileDetailResponse;
}

export async function patchVoiceProfileStatus(profileId: string, payload: VoiceReviewPatchPayload) {
  const { data } = await api.patch(`/api/v1/voice/profiles/${encodeURIComponent(profileId)}/status`, payload);
  return data as { ok: boolean; updated: boolean; profile: VoiceProfileDetailResponse['profile'] | null };
}

export async function disableVoiceProfile(profileId: string) {
  const { data } = await api.post(`/api/v1/voice/profiles/${encodeURIComponent(profileId)}/disable`);
  return data as { ok: boolean; disabled: boolean; profile_id: string };
}

export async function fetchVoiceConsents(input?: {
  status?: string;
  owner_type?: string;
}) {
  const { data } = await api.get('/api/v1/voice/consents', { params: input });
  return data as VoiceConsentListResponse;
}

export async function createVoiceConsent(payload: VoiceConsentCreatePayload) {
  const { data } = await api.post('/api/v1/voice/consents', payload);
  return data as VoiceConsentDetailResponse;
}

export async function fetchVoiceConsent(consentId: string) {
  const { data } = await api.get(`/api/v1/voice/consents/${encodeURIComponent(consentId)}`);
  return data as VoiceConsentDetailResponse;
}

export async function patchVoiceConsentStatus(consentId: string, payload: VoiceReviewPatchPayload) {
  const { data } = await api.patch(`/api/v1/voice/consents/${encodeURIComponent(consentId)}/status`, payload);
  return data as { ok: boolean; updated: boolean; consent: VoiceConsentDetailResponse['consent'] | null };
}

export async function synthesizeVoice(payload: VoiceSynthesizePayload) {
  const { data } = await api.post('/api/v1/voice/synthesize', payload);
  return data as VoiceSynthesizeResponse;
}

export async function fetchVoiceJobs(input?: {
  run_id?: string;
  lobster_id?: string;
  status?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/v1/voice/jobs', { params: input });
  return data as VoiceJobListResponse;
}

export async function fetchVoiceJob(jobId: string) {
  const { data } = await api.get(`/api/v1/voice/jobs/${encodeURIComponent(jobId)}`);
  return data as VoiceJobDetailResponse;
}

export async function fetchVoiceArtifacts(input?: {
  run_id?: string;
  lobster_id?: string;
  artifact_type?: string;
  limit?: number;
}) {
  const { data } = await api.get('/api/v1/voice/artifacts', { params: input });
  return data as VoiceArtifactListResponse;
}
