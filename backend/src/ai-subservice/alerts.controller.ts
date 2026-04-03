import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

@Controller('api/v1/alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('rules')
  listRules(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listAlertRules();
  }

  @Post('rules')
  createRule(@Req() req: AuthedRequest | undefined, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createAlertRule(body || {});
  }

  @Put('rules/:ruleId')
  updateRule(@Req() req: AuthedRequest | undefined, @Param('ruleId') ruleId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.updateAlertRule(String(ruleId ?? '').trim(), body || {});
  }

  @Post('evaluate')
  evaluate(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.evaluateAlerts();
  }

  @Get('events')
  listEvents(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const parsed = Number(limit ?? 100);
    return this.aiSubservice.listAlertEvents(Number.isFinite(parsed) ? parsed : 100);
  }

  @Get('channels')
  listChannels(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listAlertChannels();
  }

  @Post('channels')
  createChannel(@Req() req: AuthedRequest | undefined, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createAlertChannel(body || {});
  }
}
