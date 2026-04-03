import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
  user?: {
    tenantId?: string;
    roles?: string[];
    isAdmin?: boolean;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  if (req?.user?.isAdmin) return true;
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/graph')
@UseGuards(JwtAuthGuard)
export class GraphController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get(':tenantId/snapshot')
  getGraphSnapshot(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    const scopedTenantId = String(req?.user?.tenantId ?? '').trim();
    if (scopedTenantId && scopedTenantId !== normalizedTenantId && !isAdmin(req)) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    return this.aiSubservice.getGraphSnapshot(normalizedTenantId, req?.headers?.authorization);
  }

  @Get(':tenantId/timeline')
  getGraphTimeline(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Query('limit') limit?: string,
    @Query('entity_name') entityName?: string,
    @Query('lead_id') leadId?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    const scopedTenantId = String(req?.user?.tenantId ?? '').trim();
    if (scopedTenantId && scopedTenantId !== normalizedTenantId && !isAdmin(req)) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    const normalizedEntityName = String(entityName ?? '').trim();
    if (!normalizedEntityName) {
      throw new BadRequestException('entity_name is required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getGraphTimeline(
      normalizedTenantId,
      {
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
        entity_name: normalizedEntityName,
        lead_id: leadId ? String(leadId).trim() : undefined,
      },
      req?.headers?.authorization,
    );
  }
}
