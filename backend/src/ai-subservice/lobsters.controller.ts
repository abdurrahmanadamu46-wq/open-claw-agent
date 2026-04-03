import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
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

@Controller('api/v1/lobsters')
@UseGuards(JwtAuthGuard)
export class LobstersController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listLobsters(@Query('lifecycle') lifecycle?: string) {
    return this.aiSubservice.getLobsters({
      lifecycle: lifecycle ? String(lifecycle).trim() : undefined,
    });
  }

  @Get('runs')
  listLobsterRuns(
    @Query('lobster_id') lobsterId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('sort_by') sortBy?: string,
    @Query('sort_dir') sortDir?: string,
  ) {
    const parsedPage = Number(page ?? 1);
    const parsedPageSize = Number(pageSize ?? 20);
    return this.aiSubservice.listLobsterRuns({
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      status: status ? String(status).trim() : undefined,
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
      page_size: Number.isFinite(parsedPageSize) ? parsedPageSize : 20,
      sort_by: sortBy ? String(sortBy).trim() : undefined,
      sort_dir: sortDir ? String(sortDir).trim() : undefined,
    });
  }

  @Get(':lobsterId')
  getLobster(@Param('lobsterId') lobsterId?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.getLobster(normalized);
  }

  @Get(':lobsterId/stats')
  getLobsterStats(@Param('lobsterId') lobsterId?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.getLobsterStats(normalized);
  }

  @Get(':lobsterId/quality-stats')
  getLobsterQualityStats(@Param('lobsterId') lobsterId?: string, @Query('days') days?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    const parsedDays = Number(days ?? 30);
    return this.aiSubservice.getLobsterQualityStats(normalized, Number.isFinite(parsedDays) ? parsedDays : 30);
  }

  @Get(':lobsterId/runs')
  getLobsterRuns(
    @Param('lobsterId') lobsterId?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('sort_by') sortBy?: string,
    @Query('sort_dir') sortDir?: string,
  ) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    const parsedLimit = Number(limit ?? 20);
    const parsedPage = Number(page ?? 1);
    const parsedPageSize = Number(pageSize ?? parsedLimit);
    return this.aiSubservice.getLobsterRuns(normalized, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
      page_size: Number.isFinite(parsedPageSize) ? parsedPageSize : 20,
      sort_by: sortBy ? String(sortBy).trim() : undefined,
      sort_dir: sortDir ? String(sortDir).trim() : undefined,
    });
  }

  @Get(':lobsterId/docs')
  getLobsterDocs(@Param('lobsterId') lobsterId?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.getLobsterDocs(normalized);
  }

  @Get(':lobsterId/skills')
  getLobsterSkills(@Param('lobsterId') lobsterId?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.getLobsterSkills(normalized);
  }

  @Get(':lobsterId/lifecycle')
  getLobsterLifecycle(@Param('lobsterId') lobsterId?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.getLobsterLifecycle(normalized);
  }

  @Put(':lobsterId/lifecycle')
  @AuditLog({ action: 'update_lobster_lifecycle', resource: 'lobster' })
  updateLobsterLifecycle(@Req() req: AuthedRequest | undefined, @Param('lobsterId') lobsterId?: string, @Body() body?: { new_lifecycle?: string; reason?: string }) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    return this.aiSubservice.updateLobsterLifecycle(normalized, {
      new_lifecycle: String(body?.new_lifecycle ?? '').trim(),
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }

  @Post(':lobsterId/execute')
  @AuditLog({ action: 'execute_lobster', resource: 'lobster' })
  executeLobster(
    @Param('lobsterId') lobsterId?: string,
    @Body() body?: {
      prompt?: string;
      industry?: string;
      industry_tag?: string;
      execution_mode?: 'foreground' | 'background' | 'auto';
      session_mode?: string;
      peer_id?: string;
      fresh_context?: boolean;
      enable_output_validation?: boolean;
      auto_retry_on_violation?: boolean;
      reply_channel_id?: string;
      reply_chat_id?: string;
    },
  ) {
    const normalized = String(lobsterId ?? '').trim();
    const prompt = String(body?.prompt ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    if (!prompt) throw new BadRequestException('prompt is required');
    return this.aiSubservice.executeLobster(normalized, {
      prompt,
      industry: body?.industry ? String(body.industry).trim() : undefined,
      industry_tag: body?.industry_tag ? String(body.industry_tag).trim() : undefined,
      execution_mode: body?.execution_mode ? String(body.execution_mode).trim() as 'foreground' | 'background' | 'auto' : undefined,
      session_mode: body?.session_mode ? String(body.session_mode).trim() : undefined,
      peer_id: body?.peer_id ? String(body.peer_id).trim() : undefined,
      fresh_context: body?.fresh_context === true,
      enable_output_validation: body?.enable_output_validation === true,
      auto_retry_on_violation: body?.auto_retry_on_violation === true,
      reply_channel_id: body?.reply_channel_id ? String(body.reply_channel_id).trim() : undefined,
      reply_chat_id: body?.reply_chat_id ? String(body.reply_chat_id).trim() : undefined,
    });
  }
}
