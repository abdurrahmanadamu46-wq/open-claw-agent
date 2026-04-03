import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AUDIT_LOG_KEY, type AuditLogMeta } from '../decorators/audit-log.decorator';
import { OperationAuditService } from '../services/operation-audit.service';

type AuditAwareRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  params?: Record<string, string | undefined>;
  body?: unknown;
  user?: {
    tenantId?: string;
    userId?: string;
    username?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
};

type AuditAwareResponse = {
  statusCode?: number;
};

@Injectable()
export class OperationAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: OperationAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const meta = this.reflector.get<AuditLogMeta | undefined>(AUDIT_LOG_KEY, context.getHandler());
    if (!meta) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuditAwareRequest>();
    const res = http.getResponse<AuditAwareResponse>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        void this.auditService.append({
          tenantId: req.user?.tenantId,
          userId: req.user?.userId,
          username: req.user?.username ?? req.user?.userId,
          action: meta.action,
          resource: meta.resource,
          resourceId: req.params?.id ?? req.params?.taskId ?? req.params?.lobsterId ?? null,
          method: req.method ?? 'UNKNOWN',
          path: req.originalUrl ?? req.url ?? '',
          ipAddress: this.getClientIp(req),
          requestBody: this.auditService.sanitizeBody(req.body),
          responseStatus: 'success',
          duration: Date.now() - startedAt,
        }).catch(() => undefined);
      }),
      catchError((error: unknown) => {
        void this.auditService.append({
          tenantId: req.user?.tenantId,
          userId: req.user?.userId,
          username: req.user?.username ?? req.user?.userId,
          action: meta.action,
          resource: meta.resource,
          resourceId: req.params?.id ?? req.params?.taskId ?? req.params?.lobsterId ?? null,
          method: req.method ?? 'UNKNOWN',
          path: req.originalUrl ?? req.url ?? '',
          ipAddress: this.getClientIp(req),
          requestBody: this.auditService.sanitizeBody(req.body),
          responseStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startedAt,
        }).catch(() => undefined);
        return throwError(() => error);
      }),
    );
  }

  private getClientIp(req: AuditAwareRequest): string {
    const forwarded = req.headers?.['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  }
}
