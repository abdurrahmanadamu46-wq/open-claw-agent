import { createSpanId, ensureHttpTraceId } from './http-trace.util';

type SocketLike = {
  handshake?: {
    auth?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
  };
  data?: Record<string, unknown>;
};

function firstString(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const normalized = input.trim();
    return normalized || undefined;
  }
  if (Array.isArray(input) && input.length > 0 && typeof input[0] === 'string') {
    const normalized = input[0].trim();
    return normalized || undefined;
  }
  return undefined;
}

export function ensureSocketTrace(socket: SocketLike, eventTraceId?: string): { traceId: string; spanId: string } {
  const headerTraceId = firstString(socket.handshake?.headers?.['x-trace-id']);
  const traceparent = firstString(socket.handshake?.headers?.traceparent);
  const traceparentTraceId = traceparent?.split('-')?.[1]?.trim();
  const authTraceId = firstString(socket.handshake?.auth?.traceId);
  const queryTraceId = firstString(socket.handshake?.query?.traceId);
  const existingSocketTraceId = firstString(socket.data?.traceId);

  const traceId = ensureHttpTraceId(
    eventTraceId ??
      existingSocketTraceId ??
      authTraceId ??
      queryTraceId ??
      headerTraceId ??
      traceparentTraceId,
  );
  const spanId = createSpanId();
  socket.data = socket.data ?? {};
  socket.data.traceId = traceId;
  socket.data.spanId = spanId;
  return { traceId, spanId };
}

export function wsTracePrefix(traceId?: string, spanId?: string): string {
  const safeTraceId = traceId?.trim();
  const safeSpanId = spanId?.trim();
  if (safeTraceId && safeSpanId) return `[traceId=${safeTraceId}] [spanId=${safeSpanId}] `;
  if (safeTraceId) return `[traceId=${safeTraceId}] `;
  if (safeSpanId) return `[spanId=${safeSpanId}] `;
  return '';
}
