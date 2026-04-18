import api from '../api';
import type {
  SkillImprovementCreatePayload,
  SkillImprovementCommercialOverview,
  SkillImprovementEffectListResponse,
  SkillImprovementListResponse,
  SkillImprovementMutationResponse,
  SkillImprovementSignalListResponse,
  SkillImprovementTriggerPayload,
  SkillImprovementTriggerResponse,
} from '@/types/skill-improvements';

export async function fetchSkillImprovementProposals(input?: {
  tenant_id?: string;
  status?: string;
  limit?: number;
}): Promise<SkillImprovementListResponse> {
  const { data } = await api.get('/api/v1/ai/skills/improvement-proposals', {
    params: input,
  });
  return data as SkillImprovementListResponse;
}

export async function fetchSkillImprovementOverview(input?: {
  tenant_id?: string;
}): Promise<SkillImprovementCommercialOverview> {
  const { data } = await api.get('/api/v1/ai/skills/improvement-overview', {
    params: input,
  });
  return data as SkillImprovementCommercialOverview;
}

export async function createSkillImprovementProposal(
  payload: SkillImprovementCreatePayload,
): Promise<SkillImprovementMutationResponse> {
  const { data } = await api.post('/api/v1/ai/skills/improvement-proposals', payload);
  return data as SkillImprovementMutationResponse;
}

export async function fetchSkillImprovementSignals(input?: {
  tenant_id?: string;
  limit?: number;
}): Promise<SkillImprovementSignalListResponse> {
  const { data } = await api.get('/api/v1/ai/skills/improvement-signals', {
    params: input,
  });
  return data as SkillImprovementSignalListResponse;
}

export async function fetchSkillImprovementEffects(input?: {
  tenant_id?: string;
  proposal_id?: string;
  limit?: number;
}): Promise<SkillImprovementEffectListResponse> {
  const { data } = await api.get('/api/v1/ai/skills/improvement-effects', {
    params: input,
  });
  return data as SkillImprovementEffectListResponse;
}

export async function triggerSkillImprovementProposal(
  payload: SkillImprovementTriggerPayload,
): Promise<SkillImprovementTriggerResponse> {
  const { data } = await api.post('/api/v1/ai/skills/improvement-proposals/trigger', payload);
  return data as SkillImprovementTriggerResponse;
}

export async function scanSkillImprovementProposal(proposalId: string): Promise<SkillImprovementMutationResponse> {
  const { data } = await api.post(`/api/v1/ai/skills/improvement-proposals/${encodeURIComponent(proposalId)}/scan`);
  return data as SkillImprovementMutationResponse;
}

export async function decideSkillImprovementProposal(
  proposalId: string,
  payload: { decision: 'approved' | 'rejected' | 'review'; reason?: string },
): Promise<SkillImprovementMutationResponse> {
  const { data } = await api.post(`/api/v1/ai/skills/improvement-proposals/${encodeURIComponent(proposalId)}/decide`, payload);
  return data as SkillImprovementMutationResponse;
}

export async function applySkillImprovementProposal(
  proposalId: string,
  payload?: { reason?: string },
): Promise<SkillImprovementMutationResponse> {
  const { data } = await api.post(`/api/v1/ai/skills/improvement-proposals/${encodeURIComponent(proposalId)}/apply`, payload ?? {});
  return data as SkillImprovementMutationResponse;
}

export async function rollbackSkillImprovementProposal(
  proposalId: string,
  payload?: { reason?: string },
): Promise<SkillImprovementMutationResponse> {
  const { data } = await api.post(`/api/v1/ai/skills/improvement-proposals/${encodeURIComponent(proposalId)}/rollback`, payload ?? {});
  return data as SkillImprovementMutationResponse;
}
