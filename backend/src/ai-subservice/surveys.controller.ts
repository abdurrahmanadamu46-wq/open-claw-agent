import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

function resolveTenant(req?: AuthedRequest, override?: string): string {
  return String(override ?? req?.user?.tenantId ?? '').trim();
}

@Controller('api/v1/surveys')
@UseGuards(JwtAuthGuard)
export class SurveysController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  list(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const targetTenant = resolveTenant(req, tenantId);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.listSurveys({ tenant_id: targetTenant });
  }

  @Post()
  create(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    const targetTenant = resolveTenant(req, String(body?.tenant_id ?? ''));
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.createSurvey({
      ...(body ?? {}),
      tenant_id: targetTenant,
    });
  }

  @Get(':surveyId/results')
  results(@Req() req?: AuthedRequest, @Param('surveyId') surveyId?: string, @Query('tenant_id') tenantId?: string) {
    const targetTenant = resolveTenant(req, tenantId);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    const normalizedId = String(surveyId ?? '').trim();
    if (!normalizedId) {
      throw new BadRequestException('surveyId is required');
    }
    return this.aiSubservice.getSurveyResults(normalizedId);
  }

  @Post('respond')
  respond(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    const targetTenant = resolveTenant(req, String(body?.tenant_id ?? ''));
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    const surveyId = String(body?.survey_id ?? '').trim();
    if (!surveyId) {
      throw new BadRequestException('survey_id is required');
    }
    return this.aiSubservice.respondSurvey({
      ...(body ?? {}),
      tenant_id: targetTenant,
      survey_id: surveyId,
    });
  }
}
