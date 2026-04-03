import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction } from 'express';
import {
  buildTraceparent,
  createSpanId,
  ensureHttpTraceId,
  parseTraceparent,
} from './http-trace.util';

type TraceAwareRequest = {
  headers: Record<string, string | string[] | undefined>;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  traceStartedAt?: number;
};

type HeaderAwareResponse = {
  setHeader: (name: string, value: string) => void;
};

@Injectable()
export class HttpTraceMiddleware implements NestMiddleware {
  use(req: TraceAwareRequest, res: HeaderAwareResponse, next: NextFunction) {
    const headerTraceIdRaw = req.headers?.['x-trace-id'];
    const headerTraceId = Array.isArray(headerTraceIdRaw) ? headerTraceIdRaw[0] : headerTraceIdRaw;
    const traceparentRaw = req.headers?.traceparent;
    const traceparentHeader = Array.isArray(traceparentRaw) ? traceparentRaw[0] : traceparentRaw;
    const parsedTraceparent = parseTraceparent(traceparentHeader);

    const traceId = ensureHttpTraceId(headerTraceId ?? parsedTraceparent.traceId);
    const spanId = createSpanId();

    req.traceId = traceId;
    req.parentSpanId = parsedTraceparent.parentSpanId;
    req.spanId = spanId;
    req.traceStartedAt = Date.now();

    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-span-id', spanId);
    res.setHeader('traceparent', buildTraceparent(traceId, spanId));

    next();
  }
}
