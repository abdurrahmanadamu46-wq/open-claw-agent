export interface TenantConcurrencyStats {
  ok: boolean;
  tenant_id: string;
  plan_tier: string;
  current: {
    concurrent_workflows: number;
    concurrent_steps: number;
  };
  limits: {
    max_concurrent_workflows: number;
    max_concurrent_steps: number;
    max_queue_depth: number;
    workflow_per_minute: number;
  };
  usage_pct: {
    workflows: number;
    steps: number;
  };
  queue_depth: number;
}
