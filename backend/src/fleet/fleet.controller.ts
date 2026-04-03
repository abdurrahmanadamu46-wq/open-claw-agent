import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { FleetService } from './fleet.service';
import type { FleetCommandActionType } from './fleet.types';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/fleet')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get('nodes')
  async listNodes(@Req() req?: AuthedRequest): Promise<{ code: number; data: { list: unknown[] } }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const list = await this.fleetService.listNodes(tenantScope);
    return { code: 0, data: { list } };
  }

  @Post('nodes/:nodeId/offline')
  async forceOffline(
    @Param('nodeId') nodeId?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{ code: number; data: { ok: boolean } }> {
    const tenantScope = req?.user?.tenantId?.trim();
    const normalizedNodeId = nodeId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!normalizedNodeId) {
      throw new BadRequestException('nodeId is required');
    }
    const result = await this.fleetService.forceOffline(tenantScope, normalizedNodeId);
    return { code: 0, data: result };
  }

  @Post('commands')
  async dispatchCommand(
    @Body() body: {
      targetNodeId: string;
      actionType: FleetCommandActionType;
      payload?: Record<string, unknown>;
    },
    @Req() req?: AuthedRequest,
  ): Promise<{ code: number; data: unknown }> {
    const tenantScope = req?.user?.tenantId?.trim();
    const targetNodeId = body?.targetNodeId?.trim();
    const actionType = body?.actionType;
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!targetNodeId || !actionType) {
      throw new BadRequestException('targetNodeId and actionType are required');
    }
    const command = await this.fleetService.dispatchCommand({
      tenantScope,
      targetNodeId,
      actionType,
      payload: body.payload ?? {},
    });
    return { code: 0, data: command };
  }
}

