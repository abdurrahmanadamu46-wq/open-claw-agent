import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RateLimit, RateLimitGuard } from '../common/guards/rate-limit.guard';
import { AiSubserviceService } from './ai-subservice.service';
import { FleetService } from '../fleet/fleet.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
    tenantId?: string;
    sub?: string;
    username?: string;
    userId?: string;
  };
};

function resolveOperatorUserId(req?: AuthedRequest): string {
  return String(req?.user?.userId ?? req?.user?.sub ?? req?.user?.username ?? '').trim();
}

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/ai/mcp')
@UseGuards(JwtAuthGuard)
export class McpController {
  constructor(
    private readonly aiSubservice: AiSubserviceService,
    private readonly fleetService: FleetService,
  ) {}

  @Get('servers')
  listServers(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.listMcpServers();
  }

  @Post('servers')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60000)
  @AuditLog({ action: 'register_mcp_server', resource: 'mcp_server' })
  registerServer(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.registerMcpServer(body ?? {});
  }

  @Put('servers/:serverId')
  @AuditLog({ action: 'update_mcp_server', resource: 'mcp_server' })
  updateServer(@Req() req?: AuthedRequest, @Param('serverId') serverId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedServerId = String(serverId ?? '').trim();
    if (!normalizedServerId) {
      throw new BadRequestException('serverId is required');
    }
    return this.aiSubservice.updateMcpServer(normalizedServerId, body ?? {});
  }

  @Delete('servers/:serverId')
  @AuditLog({ action: 'delete_mcp_server', resource: 'mcp_server' })
  deleteServer(@Req() req?: AuthedRequest, @Param('serverId') serverId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedServerId = String(serverId ?? '').trim();
    if (!normalizedServerId) {
      throw new BadRequestException('serverId is required');
    }
    return this.aiSubservice.deleteMcpServer(normalizedServerId);
  }

  @Get('servers/:serverId/tools')
  discoverTools(@Req() req?: AuthedRequest, @Param('serverId') serverId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedServerId = String(serverId ?? '').trim();
    if (!normalizedServerId) {
      throw new BadRequestException('serverId is required');
    }
    return this.aiSubservice.discoverMcpTools(normalizedServerId);
  }

  @Post('servers/:serverId/ping')
  @AuditLog({ action: 'ping_mcp_server', resource: 'mcp_server' })
  pingServer(@Req() req?: AuthedRequest, @Param('serverId') serverId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedServerId = String(serverId ?? '').trim();
    if (!normalizedServerId) {
      throw new BadRequestException('serverId is required');
    }
    return this.aiSubservice.pingMcpServer(normalizedServerId);
  }

  @Post('call')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60000)
  @AuditLog({ action: 'call_mcp_tool', resource: 'mcp_tool' })
  callTool(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.callMcpTool(body ?? {});
  }

  @Get('call/history')
  callHistory(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 100);
    return this.aiSubservice.getMcpCallHistory(Number.isFinite(parsedLimit) ? parsedLimit : 100);
  }

  @Get('monitor/top')
  monitorTop(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 10);
    return this.aiSubservice.getMcpToolMonitorTop(Number.isFinite(parsedLimit) ? parsedLimit : 10);
  }

  @Get('monitor/heatmap')
  monitorHeatmap(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getMcpToolMonitorHeatmap();
  }

  @Get('monitor/failures')
  monitorFailures(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getMcpToolMonitorFailures();
  }

  @Get('monitor/recent')
  monitorRecent(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getMcpToolMonitorRecent(Number.isFinite(parsedLimit) ? parsedLimit : 50);
  }

  @Get('policies')
  listPolicies(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.listMcpPolicies();
  }

  @Put('policies/:lobsterName')
  @AuditLog({ action: 'update_mcp_tool_policy', resource: 'mcp_tool_policy' })
  updatePolicy(@Req() req?: AuthedRequest, @Param('lobsterName') lobsterName?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(lobsterName ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('lobsterName is required');
    }
    return this.aiSubservice.updateMcpPolicy(normalized, body ?? {});
  }

  @Get('marketplace')
  listMarketplace(@Req() req?: AuthedRequest, @Query('category') category?: string, @Query('tag') tag?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.listToolMarketplace({
      category: category ? String(category).trim() : undefined,
      tag: tag ? String(tag).trim() : undefined,
    });
  }

  @Post('marketplace')
  @AuditLog({ action: 'publish_mcp_tool_listing', resource: 'mcp_tool_marketplace' })
  publishMarketplace(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.publishToolMarketplace(body ?? {});
  }

  @Get('marketplace/subscriptions')
  listSubscriptions(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.listToolSubscriptions();
  }

  @Post('marketplace/subscribe')
  @AuditLog({ action: 'subscribe_mcp_tool', resource: 'mcp_tool_marketplace' })
  subscribeMarketplace(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.subscribeTool(body ?? {});
  }

  @Post('marketplace/unsubscribe')
  @AuditLog({ action: 'unsubscribe_mcp_tool', resource: 'mcp_tool_marketplace' })
  unsubscribeMarketplace(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.unsubscribeTool(body ?? {});
  }

  @Get('edge/manifests')
  listEdgeManifests(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return { ok: true, items: this.fleetService.listEdgeToolManifests() };
  }

  @Post('edge/manifests/:nodeId/refresh')
  refreshEdgeManifest(@Req() req?: AuthedRequest, @Param('nodeId') nodeId?: string, @Body() body?: { session_id?: string }) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedNodeId = String(nodeId ?? '').trim();
    if (!normalizedNodeId) {
      throw new BadRequestException('nodeId is required');
    }
    const ok = this.fleetService.requestEdgeToolManifest({
      tenantScope: String(req?.user?.tenantId ?? '').trim(),
      nodeId: normalizedNodeId,
      sessionId: String(body?.session_id ?? '').trim() || undefined,
    });
    return { ok };
  }

  @Post('edge/call')
  @AuditLog({ action: 'call_edge_mcp_tool', resource: 'edge_mcp_tool' })
  async callEdgeTool(
    @Req() req?: AuthedRequest,
    @Body() body?: { node_id?: string; tool?: string; params?: Record<string, unknown>; session_id?: string; timeout_ms?: number },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const nodeId = String(body?.node_id ?? '').trim();
    const tool = String(body?.tool ?? '').trim();
    if (!nodeId || !tool) {
      throw new BadRequestException('node_id and tool are required');
    }
    const result = await this.fleetService.dispatchMcpToolCall({
      tenantScope: String(req?.user?.tenantId ?? '').trim(),
      nodeId,
      tool,
      params: body?.params ?? {},
      sessionId: String(body?.session_id ?? '').trim() || undefined,
      timeoutMs: typeof body?.timeout_ms === 'number' ? body.timeout_ms : undefined,
    });
    return { ok: true, result };
  }
}
