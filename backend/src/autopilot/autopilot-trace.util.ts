import { v4 as uuidv4 } from 'uuid';

export function ensureTraceId(traceId?: string): string {
  const normalized = traceId?.trim();
  if (normalized) {
    return normalized;
  }
  return `trc_${uuidv4()}`;
}

