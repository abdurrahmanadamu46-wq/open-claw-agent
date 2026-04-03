import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
    tenantId?: string;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get(':tenantId/:leadId/conversion-status')
  getLeadConversionStatus(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    if (!normalizedTenantId) {
      throw new BadRequestException('tenantId is required');
    }
    if (!normalizedLeadId) {
      throw new BadRequestException('leadId is required');
    }
    const scopedTenantId = String(req?.user?.tenantId ?? '').trim();
    if (scopedTenantId && scopedTenantId !== normalizedTenantId && !isAdmin(req)) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    return this.aiSubservice.getLeadConversionStatus(normalizedTenantId, normalizedLeadId);
  }

  @Get(':tenantId/:leadId/conversion-history')
  getLeadConversionHistory(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
    @Query('limit') limit?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    if (!normalizedTenantId) {
      throw new BadRequestException('tenantId is required');
    }
    if (!normalizedLeadId) {
      throw new BadRequestException('leadId is required');
    }
    const scopedTenantId = String(req?.user?.tenantId ?? '').trim();
    if (scopedTenantId && scopedTenantId !== normalizedTenantId && !isAdmin(req)) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getLeadConversionHistory(
      normalizedTenantId,
      normalizedLeadId,
      Number.isFinite(parsedLimit) ? parsedLimit : 50,
    );
  }
}
