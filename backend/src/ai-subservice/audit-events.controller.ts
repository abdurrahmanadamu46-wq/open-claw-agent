import { Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard)
export class AuditEventsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('event-types')
  getEventTypes(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getAuditEventTypes();
  }

  @Get('events')
  getEvents(
    @Req() req?: AuthedRequest,
    @Query('event_type') eventType?: string | string[],
    @Query('severity') severity?: string | string[],
    @Query('category') category?: string | string[],
    @Query('user_id') userId?: string,
    @Query('resource_id') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('include_deleted') includeDeleted?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('sort_by') sortBy?: string,
    @Query('sort_dir') sortDir?: string,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 100);
    const parsedPage = Number(page ?? 1);
    const parsedPageSize = Number(pageSize ?? parsedLimit);
    return this.aiSubservice.getAuditEvents({
      event_type: Array.isArray(eventType) ? eventType : eventType ? [eventType] : undefined,
      severity: Array.isArray(severity) ? severity : severity ? [severity] : undefined,
      category: Array.isArray(category) ? category : category ? [category] : undefined,
      user_id: userId ? String(userId).trim() : undefined,
      resource_id: resourceId ? String(resourceId).trim() : undefined,
      from: from ? String(from).trim() : undefined,
      to: to ? String(to).trim() : undefined,
      include_deleted: includeDeleted === 'true',
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
      page_size: Number.isFinite(parsedPageSize) ? parsedPageSize : 100,
      sort_by: sortBy ? String(sortBy).trim() : undefined,
      sort_dir: sortDir ? String(sortDir).trim() : undefined,
    });
  }

  @Post('cleanup')
  @AuditLog({ action: 'audit_cleanup', resource: 'audit_event' })
  cleanup(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.runAuditCleanup();
  }
}
