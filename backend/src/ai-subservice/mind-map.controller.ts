import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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

function ensureTenantScope(req: AuthedRequest | undefined, tenantId: string) {
  const scopedTenantId = String(req?.user?.tenantId ?? '').trim();
  if (scopedTenantId && scopedTenantId !== tenantId && !isAdmin(req)) {
    throw new ForbiddenException('tenant scope mismatch');
  }
}

@Controller('api/v1/mind-map')
@UseGuards(JwtAuthGuard)
export class MindMapController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get(':tenantId/:leadId')
  getMindMap(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    if (!normalizedLeadId) throw new BadRequestException('leadId is required');
    ensureTenantScope(req, normalizedTenantId);
    return this.aiSubservice.getMindMap(normalizedTenantId, normalizedLeadId, req?.headers?.authorization);
  }

  @Get(':tenantId/:leadId/questions')
  getMindMapQuestions(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
    @Query('limit') limit?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    if (!normalizedLeadId) throw new BadRequestException('leadId is required');
    ensureTenantScope(req, normalizedTenantId);
    const parsedLimit = Number(limit ?? 3);
    return this.aiSubservice.getMindMapQuestions(
      normalizedTenantId,
      normalizedLeadId,
      { limit: Number.isFinite(parsedLimit) ? parsedLimit : 3 },
      req?.headers?.authorization,
    );
  }

  @Get(':tenantId/:leadId/briefing')
  getMindMapBriefing(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    if (!normalizedLeadId) throw new BadRequestException('leadId is required');
    ensureTenantScope(req, normalizedTenantId);
    return this.aiSubservice.getMindMapBriefing(normalizedTenantId, normalizedLeadId, req?.headers?.authorization);
  }

  @Post(':tenantId/:leadId/nodes/:dimension')
  updateMindMapNode(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('leadId') leadId?: string,
    @Param('dimension') dimension?: string,
    @Body() body: Record<string, unknown> = {},
  ) {
    const normalizedTenantId = String(tenantId ?? '').trim();
    const normalizedLeadId = String(leadId ?? '').trim();
    const normalizedDimension = String(dimension ?? '').trim();
    if (!normalizedTenantId) throw new BadRequestException('tenantId is required');
    if (!normalizedLeadId) throw new BadRequestException('leadId is required');
    if (!normalizedDimension) throw new BadRequestException('dimension is required');
    const source = String(body?.source ?? '').trim();
    if (!source) throw new BadRequestException('source is required');
    ensureTenantScope(req, normalizedTenantId);
    return this.aiSubservice.updateMindMapNode(
      normalizedTenantId,
      normalizedLeadId,
      normalizedDimension,
      body,
      req?.headers?.authorization,
    );
  }
}
