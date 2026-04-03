export type AttributionSeriesPoint = {
  name: string;
  value: number;
  share?: number;
  label?: string;
};

export type AttributionMetric = {
  label: string;
  value: number | string;
};

export type AttributionResponse = {
  model?: string;
  tenant_id?: string;
  start?: string;
  end?: string;
  totals?: Record<string, number>;
  series?: AttributionSeriesPoint[];
  highlights?: AttributionMetric[];
  metadata?: Record<string, unknown>;
};
