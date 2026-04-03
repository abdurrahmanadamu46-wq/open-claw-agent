import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Body, Post } from '@nestjs/common';
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

@Controller('api/observability')
@UseGuards(JwtAuthGuard)
export class ObservabilityController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('traces')
  listTraces(@Req() req?: AuthedRequest, @Query() query?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listObservabilityTraces(query);
  }

  @Get('traces/:traceId')
  getTrace(@Req() req: AuthedRequest | undefined, @Param('traceId') traceId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.getObservabilityTrace(String(traceId ?? '').trim());
  }

  @Get('chart/annotations')
  getAnnotations(@Req() req?: AuthedRequest, @Query() query?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.getChartAnnotations(query);
  }

  @Get('event-bus/subjects')
  getEventBusSubjects(@Req() req?: AuthedRequest, @Query('prefix') prefix?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.getEventBusSubjects(prefix ? { prefix } : undefined);
  }

  @Get('event-bus/prefix-summary')
  getEventBusPrefixSummary(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.getEventBusPrefixSummary();
  }

  @Post('logs/query')
  queryLogs(@Req() req?: AuthedRequest, @Body() body?: { sql?: string; time_range_hours?: number }) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.queryLogs({
      sql: String(body?.sql ?? '').trim(),
      time_range_hours: typeof body?.time_range_hours === 'number' ? body.time_range_hours : undefined,
    });
  }

  @Get('logs/templates')
  getLogTemplates(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.getLogQueryTemplates();
  }
}
