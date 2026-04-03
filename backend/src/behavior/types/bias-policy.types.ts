export interface BehaviorBiasWeights {
  intentWeight: number;
  memoryWeight: number;
  personaWeight: number;
  aggressivenessBoost: number;
}

export interface BehaviorBiasPolicyRecord {
  tenant_id?: string;
  template_id?: string;
  weights: BehaviorBiasWeights;
  updated_at: string;
  source: 'default' | 'tenant' | 'tenant_template';
}

