import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';
import { FleetService } from '../fleet/fleet.service';
import type { FleetCommandActionType } from '../fleet/fleet.types';

type AuthedRequest = {
  user?: {
    roles?: string[];
    tenantId?: string;
    sub?: string;
    username?: string;
    userId?: string;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

function resolveOperatorUserId(req?: AuthedRequest): string {
  return String(req?.user?.userId ?? req?.user?.sub ?? req?.user?.username ?? '').trim();
}

@Controller('api/v1/ai/edge/groups')
@UseGuards(JwtAuthGuard)
export class EdgeGroupsController {
  constructor(
    private readonly aiSubservice: AiSubserviceService,
    private readonly fleetService: FleetService,
  ) {}

  @Get('tree')
  getTree(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) throw new BadRequestException('user_id is required');
    return this.aiSubservice.getEdgeGroupTree();
  }

  @Get('node-map')
  getNodeMap(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) throw new BadRequestException('user_id is required');
    return this.aiSubservice.getEdgeGroupNodeMap();
  }

  @Post()
  @AuditLog({ action: 'create_edge_group', resource: 'edge_group' })
  createGroup(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createEdgeGroup(body ?? {});
  }

  @Post(':groupId/nodes/:nodeId')
  @AuditLog({ action: 'assign_edge_group_node', resource: 'edge_group' })
  assignNode(@Req() req?: AuthedRequest, @Param('groupId') groupId?: string, @Param('nodeId') nodeId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const gid = String(groupId ?? '').trim();
    const nid = String(nodeId ?? '').trim();
    if (!gid || !nid) throw new BadRequestException('groupId and nodeId are required');
    return this.aiSubservice.assignNodeToEdgeGroup(gid, nid);
  }

  @Delete(':groupId/nodes/:nodeId')
  @AuditLog({ action: 'remove_edge_group_node', resource: 'edge_group' })
  removeNode(@Req() req?: AuthedRequest, @Param('groupId') groupId?: string, @Param('nodeId') nodeId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const gid = String(groupId ?? '').trim();
    const nid = String(nodeId ?? '').trim();
    if (!gid || !nid) throw new BadRequestException('groupId and nodeId are required');
    return this.aiSubservice.removeNodeFromEdgeGroup(gid, nid);
  }

  @Post(':groupId/batch-dispatch')
  @AuditLog({ action: 'batch_dispatch_edge_group', resource: 'edge_group' })
  async batchDispatch(
    @Req() req?: AuthedRequest,
    @Param('groupId') groupId?: string,
    @Body() body?: { actionType?: FleetCommandActionType; payload?: Record<string, unknown> },
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const tenantScope = String(req?.user?.tenantId ?? '').trim();
    const gid = String(groupId ?? '').trim();
    if (!tenantScope || !gid) throw new BadRequestException('tenant scope and groupId are required');
    const groupNodes = await this.aiSubservice.getEdgeGroupNodes(gid);
    const nodeIds = Array.isArray(groupNodes?.node_ids) ? (groupNodes.node_ids as string[]) : [];
    const fleetNodes = await this.fleetService.listNodes(tenantScope);
    const onlineNodeIds = new Set(
      fleetNodes.filter((item) => item.status === 'ONLINE' || item.status === 'BUSY').map((item) => item.nodeId),
    );
    let dispatched = 0;
    let failed = 0;
    for (const nodeId of nodeIds) {
      if (!onlineNodeIds.has(nodeId)) continue;
      try {
        await this.fleetService.dispatchCommand({
          tenantScope,
          targetNodeId: nodeId,
          actionType: body?.actionType ?? 'START_CAMPAIGN',
          payload: body?.payload ?? {},
        });
        dispatched += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      ok: true,
      group_id: gid,
      total: nodeIds.length,
      online: Array.from(onlineNodeIds).filter((id) => nodeIds.includes(id)).length,
      dispatched,
      failed,
    };
  }
}

@Controller('api/v1/ai/lobster-trigger-rules')
@UseGuards(JwtAuthGuard)
export class LobsterTriggerRulesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listRules(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) throw new BadRequestException('user_id is required');
    return this.aiSubservice.listLobsterTriggerRules();
  }

  @Post()
  @AuditLog({ action: 'create_lobster_trigger_rule', resource: 'lobster_trigger_rule' })
  createRule(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createLobsterTriggerRule(body ?? {});
  }

  @Put(':ruleId')
  @AuditLog({ action: 'update_lobster_trigger_rule', resource: 'lobster_trigger_rule' })
  updateRule(@Req() req?: AuthedRequest, @Param('ruleId') ruleId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(ruleId ?? '').trim();
    if (!normalized) throw new BadRequestException('ruleId is required');
    return this.aiSubservice.updateLobsterTriggerRule(normalized, body ?? {});
  }

  @Delete(':ruleId')
  @AuditLog({ action: 'delete_lobster_trigger_rule', resource: 'lobster_trigger_rule' })
  deleteRule(@Req() req?: AuthedRequest, @Param('ruleId') ruleId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(ruleId ?? '').trim();
    if (!normalized) throw new BadRequestException('ruleId is required');
    return this.aiSubservice.deleteLobsterTriggerRule(normalized);
  }

  @Post('evaluate')
  @AuditLog({ action: 'evaluate_lobster_trigger_rules', resource: 'lobster_trigger_rule' })
  evaluateRules(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.evaluateLobsterTriggerRules();
  }
}

@Controller('api/v1/ai/metrics/lobster')
@UseGuards(JwtAuthGuard)
export class LobsterMetricsHistoryController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get(':lobsterName/history')
  getHistory(@Req() req?: AuthedRequest, @Param('lobsterName') lobsterName?: string, @Query('days') days?: string) {
    if (!resolveOperatorUserId(req)) throw new BadRequestException('user_id is required');
    const normalized = String(lobsterName ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterName is required');
    const parsedDays = Number(days ?? 30);
    return this.aiSubservice.getLobsterMetricsHistory(normalized, Number.isFinite(parsedDays) ? parsedDays : 30);
  }
}
