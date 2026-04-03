import { randomUUID } from 'crypto';

export type HttpRequestTrace = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

export function ensureHttpTraceId(input?: string): string {
  const normalized = input?.trim();
  if (normalized) return normalized;
  return `trc_${randomUUID()}`;
}

export function createSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function parseTraceparent(header?: string): { traceId?: string; parentSpanId?: string } {
  const normalized = header?.trim();
  if (!normalized) return {};
  const parts = normalized.split('-');
  if (parts.length < 4) return {};
  const traceId = parts[1]?.trim();
  const parentSpanId = parts[2]?.trim();
  if (!traceId) return {};
  return { traceId, parentSpanId: parentSpanId || undefined };
}

export function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}
