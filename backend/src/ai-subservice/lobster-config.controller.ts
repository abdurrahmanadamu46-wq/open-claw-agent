import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
  };
};

function resolveTenant(req?: AuthedRequest, override?: string): string {
  return String(override ?? req?.user?.tenantId ?? '').trim();
}

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((role) => String(role).toLowerCase()).includes('admin');
}

type LobsterConfigUpdateBody = {
  strategy_level?: string;
  autonomy_level?: string;
  custom_prompt?: string;
  notes?: string;
};

@Controller('api/v1/lobster-config')
@UseGuards(JwtAuthGuard)
export class LobsterConfigController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  list(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const targetTenant = resolveTenant(req, tenantId);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== String(req?.user?.tenantId ?? '').trim()) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getLobsterConfigs(targetTenant);
  }

  @Get(':lobsterId')
  detail(
    @Req() req?: AuthedRequest,
    @Param('lobsterId') lobsterId?: string,
    @Query('tenant_id') tenantId?: string,
  ) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('lobsterId is required');
    }
    const targetTenant = resolveTenant(req, tenantId);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== String(req?.user?.tenantId ?? '').trim()) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getLobsterConfig(normalized, targetTenant);
  }

  @Patch(':lobsterId')
  update(
    @Req() req?: AuthedRequest,
    @Param('lobsterId') lobsterId?: string,
    @Body() body?: LobsterConfigUpdateBody,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('lobsterId is required');
    }
    const payload: Record<string, unknown> = {};
    if (typeof body?.strategy_level === 'string') {
      payload.strategy_level = body.strategy_level.trim();
    }
    if (typeof body?.autonomy_level === 'string') {
      payload.autonomy_level = body.autonomy_level.trim();
    }
    if (typeof body?.custom_prompt === 'string') {
      payload.custom_prompt = body.custom_prompt.trim();
    }
    if (typeof body?.notes === 'string') {
      payload.notes = body.notes.trim();
    }
    return this.aiSubservice.updateLobsterConfig(normalized, payload);
  }
}
