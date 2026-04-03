import api from '../api';
import type { PartnerDashboard, PartnerSeat, PartnerStatement, PartnerSubAgent } from '@/types/partner-portal';

export async function fetchPartnerDashboard(agentId: string) {
  const { data } = await api.get('/api/v1/ai/partner/dashboard', { params: { agent_id: agentId } });
  return data as { ok: boolean; dashboard: PartnerDashboard };
}

export async function fetchPartnerSeats(agentId: string) {
  const { data } = await api.get('/api/v1/ai/partner/seats', { params: { agent_id: agentId } });
  return data as { ok: boolean; items: PartnerSeat[] };
}

export async function assignPartnerSeat(agentId: string, input: {
  tenant_id: string;
  seat_id: string;
  seat_name: string;
  platform: string;
  account_username: string;
  client_name: string;
}) {
  const { data } = await api.post('/api/v1/ai/partner/seats/assign', input, { params: { agent_id: agentId } });
  return data as { ok: boolean; seat: PartnerSeat };
}

export async function updatePartnerWhiteLabel(agentId: string, input: {
  brand_name: string;
  primary_color: string;
  logo_url?: string;
  lobster_names?: Record<string, string>;
}) {
  const { data } = await api.put('/api/v1/ai/partner/white-label', input, { params: { agent_id: agentId } });
  return data as { ok: boolean; config: Record<string, unknown> };
}

export async function fetchPartnerSubAgentTree(agentId: string) {
  const { data } = await api.get('/api/v1/ai/partner/sub-agents/tree', { params: { agent_id: agentId } });
  return data as {
    ok: boolean;
    tree: {
      agent: Record<string, unknown>;
      children: PartnerSubAgent[];
    };
  };
}

export async function createPartnerSubAgent(agentId: string, input: {
  company_name: string;
  contact_name: string;
  region: string;
  allocated_seats: number;
}) {
  const { data } = await api.post('/api/v1/ai/partner/sub-agents', input, { params: { agent_id: agentId } });
  return data as { ok: boolean; sub_agent: PartnerSubAgent };
}

export async function fetchPartnerStatements(agentId: string) {
  const { data } = await api.get('/api/v1/ai/partner/statements', { params: { agent_id: agentId } });
  return data as { ok: boolean; items: PartnerStatement[] };
}

export async function confirmPartnerStatement(agentId: string, period: string, confirmedBy: string) {
  const { data } = await api.post('/api/v1/ai/partner/statements/confirm', { confirmed_by: confirmedBy }, { params: { agent_id: agentId, period } });
  return data as { ok: boolean; statement: PartnerStatement };
}

export async function disputePartnerStatement(agentId: string, period: string, reason: string) {
  const { data } = await api.post('/api/v1/ai/partner/statements/dispute', { reason }, { params: { agent_id: agentId, period } });
  return data as { ok: boolean; statement: PartnerStatement };
}
