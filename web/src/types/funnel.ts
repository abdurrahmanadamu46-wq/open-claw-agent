export type FunnelStage = {
  name: string;
  value: number;
  dropoff?: number;
  conversion_rate?: number;
  label?: string;
};

export type FunnelResponse = {
  tenant_id?: string;
  start?: string;
  end?: string;
  stages?: FunnelStage[];
  totals?: Record<string, number>;
  metadata?: Record<string, unknown>;
};
