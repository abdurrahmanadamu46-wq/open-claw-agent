import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
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

type WidgetConfigBody = {
  tenant_id?: string;
  allowed_domains?: string[];
  welcome_message?: string;
  theme_color?: string;
  accent_color?: string;
  custom_css?: string;
  call_to_action?: string;
};

@Controller('api/v1/widget')
@UseGuards(JwtAuthGuard)
export class WidgetController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('config')
  config(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const targetTenant = resolveTenant(req, tenantId);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== String(req?.user?.tenantId ?? '').trim()) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getWidgetConfig(targetTenant);
  }

  @Put('config')
  update(@Req() req?: AuthedRequest, @Body() body?: WidgetConfigBody) {
    const targetTenant = resolveTenant(req, body?.tenant_id);
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== String(req?.user?.tenantId ?? '').trim()) {
      throw new ForbiddenException('Admin role required to modify this tenant');
    }
    const payload: Record<string, unknown> = {
      tenant_id: targetTenant,
    };
    if (Array.isArray(body?.allowed_domains)) {
      payload.allowed_domains = body.allowed_domains
        .map((domain) => String(domain ?? '').trim())
        .filter((domain) => domain);
    }
    if (typeof body?.welcome_message === 'string') {
      payload.welcome_message = body.welcome_message.trim();
    }
    if (typeof body?.theme_color === 'string') {
      payload.theme_color = body.theme_color.trim();
    }
    if (typeof body?.accent_color === 'string') {
      payload.accent_color = body.accent_color.trim();
    }
    if (typeof body?.custom_css === 'string') {
      payload.custom_css = body.custom_css.trim();
    }
    if (typeof body?.call_to_action === 'string') {
      payload.call_to_action = body.call_to_action.trim();
    }
    return this.aiSubservice.updateWidgetConfig(payload);
  }

  @Get('script/:widgetId')
  script(@Param('widgetId') widgetId?: string) {
    const normalized = String(widgetId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('widgetId is required');
    }
    return this.aiSubservice.getWidgetScript(normalized);
  }
}
