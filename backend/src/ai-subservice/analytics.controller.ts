import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('attribution')
  getAttribution(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('model') model?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.getAnalyticsAttribution({
      tenant_id: targetTenant,
      model: model ? String(model).trim() : undefined,
      start: start ? String(start).trim() : undefined,
      end: end ? String(end).trim() : undefined,
    });
  }

  @Get('funnel')
  getFunnel(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.getAnalyticsFunnel({
      tenant_id: targetTenant,
      start: start ? String(start).trim() : undefined,
      end: end ? String(end).trim() : undefined,
    });
  }

  @Post('nl-query')
  postNaturalLanguageQuery(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      query?: string;
      context?: Record<string, unknown>;
    },
  ) {
    const targetTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const query = String(body?.query ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!query) {
      throw new BadRequestException('query is required');
    }
    return this.aiSubservice.postNaturalLanguageQuery({
      tenant_id: targetTenant,
      query,
      context: body?.context,
    });
  }
}
