import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LeadService } from './lead.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/leads')
@UseGuards(JwtAuthGuard)
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Get()
  async listLeads(
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('intent_score_min') intentScoreMin?: string,
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedPage = page ? Number.parseInt(page, 10) : 1;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
    if (!Number.isFinite(parsedPage) || parsedPage <= 0) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const parsedIntentMin = intentScoreMin ? Number.parseInt(intentScoreMin, 10) : undefined;
    const data = await this.leadService.list(tenantId, {
      page: parsedPage,
      limit: parsedLimit,
      intentScoreMin: Number.isFinite(parsedIntentMin) ? parsedIntentMin : undefined,
    });
    return { code: 0, data };
  }

  @Get(':leadId/reveal')
  async revealLead(@Req() req: AuthedRequest, @Param('leadId') leadId?: string) {
    const tenantId = req?.user?.tenantId?.trim();
    const normalizedLeadId = leadId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!normalizedLeadId) {
      throw new BadRequestException('leadId is required');
    }
    const data = await this.leadService.reveal(tenantId, normalizedLeadId);
    return { code: 0, data };
  }
}
