import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../../auth/admin-role.guard';
import { OperationAuditService } from '../services/operation-audit.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    userId?: string;
  };
};

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AuditLogsController {
  constructor(private readonly auditService: OperationAuditService) {}

  @Get('logs')
  async listLogs(
    @Req() req?: AuthedRequest,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('responseStatus') responseStatus?: 'success' | 'failed',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantScope = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const parsedPage = Number(page ?? 1);
    const parsedLimit = Number(limit ?? 50);
    return this.auditService.query({
      tenantId: tenantScope || undefined,
      userId: userId ? String(userId).trim() : undefined,
      action: action ? String(action).trim() : undefined,
      resource: resource ? String(resource).trim() : undefined,
      responseStatus,
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }
}
