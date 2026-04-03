import api from '../api';
import type {
  PolicyBundle,
  PolicyBundlePublishPayload,
  PolicyDecision,
  PolicyEvaluatePayload,
  PolicyRule,
  PolicyRulePayload,
} from '@/types/policy-engine';

export async function fetchPolicies() {
  const { data } = await api.get('/api/v1/policies');
  return data as {
    ok: boolean;
    tenant_id: string;
    items: PolicyRule[];
  };
}

export async function createPolicy(payload: PolicyRulePayload) {
  const { data } = await api.post('/api/v1/policies', payload);
  return data as {
    ok: boolean;
    rule: PolicyRule;
    bundle: PolicyBundle;
  };
}

export async function updatePolicy(ruleId: string, payload: PolicyRulePayload) {
  const { data } = await api.put(`/api/v1/policies/${encodeURIComponent(ruleId)}`, payload);
  return data as {
    ok: boolean;
    rule: PolicyRule;
    bundle: PolicyBundle;
  };
}

export async function deletePolicy(ruleId: string) {
  const { data } = await api.delete(`/api/v1/policies/${encodeURIComponent(ruleId)}`);
  return data as {
    ok: boolean;
    deleted: boolean;
    bundle: PolicyBundle;
  };
}

export async function evaluatePolicy(payload: PolicyEvaluatePayload) {
  const { data } = await api.post('/api/v1/policies/evaluate', payload);
  return data as {
    ok: boolean;
    tenant_id: string;
    decision: PolicyDecision;
    decision_log_id: string;
  };
}

export async function fetchCurrentPolicyBundle() {
  const { data } = await api.get('/api/v1/policies/bundle/current');
  return data as {
    ok: boolean;
    tenant_id: string;
    bundle: PolicyBundle;
  };
}

export async function publishPolicyBundle(payload?: PolicyBundlePublishPayload) {
  const { data } = await api.post('/api/v1/policies/bundle/publish', payload ?? {});
  return data as {
    ok: boolean;
    tenant_id: string;
    bundle: PolicyBundle;
  };
}
