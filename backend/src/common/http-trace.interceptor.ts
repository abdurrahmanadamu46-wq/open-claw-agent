import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { redactText } from './redaction';

type TraceAwareRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  traceStartedAt?: number;
  user?: {
    tenantId?: string;
    role?: string;
  };
};

type TraceAwareResponse = {
  statusCode?: number;
};

@Injectable()
export class HttpTraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpTraceInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<TraceAwareRequest>();
    const res = http.getResponse<TraceAwareResponse>();
    const start = req.traceStartedAt ?? Date.now();

    const method = req.method ?? 'UNKNOWN';
    const path = req.originalUrl ?? req.url ?? 'unknown';
    const traceId = req.traceId ?? 'missing';
    const spanId = req.spanId ?? 'missing';
    const parentSpanId = req.parentSpanId ?? '';
    const tenantId = req.user?.tenantId ?? '';
    const role = req.user?.role ?? '';

    this.logger.log(
      `[traceId=${traceId}] [spanId=${spanId}] [http:start] ${method} ${path} tenant=${tenantId || '-'} role=${role || '-'} parentSpan=${parentSpanId || '-'}`,
    );

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - start;
        const statusCode = res.statusCode ?? 200;
        this.logger.log(
          `[traceId=${traceId}] [spanId=${spanId}] [http:finish] ${method} ${path} status=${statusCode} durationMs=${durationMs}`,
        );
      }),
      catchError((err: unknown) => {
        const durationMs = Date.now() - start;
        const statusCode =
          typeof err === 'object' && err && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
            ? ((err as { status: number }).status ?? 500)
            : 500;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : JSON.stringify(err ?? {});
        const safeMessage = redactText(message);

        this.logger.error(
          `[traceId=${traceId}] [spanId=${spanId}] [http:error] ${method} ${path} status=${statusCode} durationMs=${durationMs} message=${safeMessage}`,
        );
        return throwError(() => err);
      }),
    );
  }
}
