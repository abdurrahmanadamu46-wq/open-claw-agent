export type NlQueryPayload = {
  tenant_id?: string;
  query: string;
  context?: Record<string, unknown>;
};

export type NlQueryResponse = {
  ok: boolean;
  answer?: string;
  metadata?: Record<string, unknown>;
};
