import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { FleetService } from '../fleet/fleet.service';
import { SecurityAuditRepository } from './security-audit.repository';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/security')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class SecurityAuditController {
  constructor(
    private readonly repository: SecurityAuditRepository,
    private readonly fleetService: FleetService,
  ) {}

  @Get('reports')
  async listReports(
    @Req() req?: AuthedRequest,
    @Query('node_id') nodeId?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = Number(limit ?? 30);
    const items = await this.repository.listReports({
      node_id: nodeId ? String(nodeId).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 30,
    });
    return { code: 0, data: { list: items } };
  }

  @Get('reports/:reportId')
  async getReport(@Param('reportId') reportId?: string) {
    const id = String(reportId ?? '').trim();
    if (!id) {
      throw new BadRequestException('reportId is required');
    }
    const item = await this.repository.getReport(id);
    if (!item) {
      throw new BadRequestException('report not found');
    }
    return { code: 0, data: item };
  }

  @Post('audit/trigger')
  async triggerAudit(@Req() req?: AuthedRequest, @Body() body?: { node_id?: string; session_id?: string }) {
    const tenantId = req?.user?.tenantId?.trim();
    const nodeId = String(body?.node_id ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!nodeId) {
      throw new BadRequestException('node_id is required');
    }
    const ok = this.fleetService.dispatchSecurityAuditTrigger({
      tenantScope: tenantId,
      nodeId,
      sessionId: String(body?.session_id ?? '').trim() || undefined,
    });
    return { code: 0, data: { ok } };
  }

  @Post('baseline/rebuild')
  async rebuildBaseline(
    @Req() req?: AuthedRequest,
    @Body() body?: { node_id?: string; type?: 'credential' | 'sop' | 'all'; session_id?: string },
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    const nodeId = String(body?.node_id ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!nodeId) {
      throw new BadRequestException('node_id is required');
    }
    const ok = this.fleetService.dispatchSecurityBaselineRebuild({
      tenantScope: tenantId,
      nodeId,
      baselineType: body?.type ?? 'all',
      sessionId: String(body?.session_id ?? '').trim() || undefined,
    });
    return { code: 0, data: { ok } };
  }

  @Get('known-issues')
  async listKnownIssues(@Query('node_id') nodeId?: string) {
    const items = await this.repository.listKnownIssues({
      node_id: nodeId ? String(nodeId).trim() : undefined,
    });
    return { code: 0, data: { list: items } };
  }

  @Post('known-issues')
  async addKnownIssue(
    @Req() req?: AuthedRequest,
    @Body() body?: { node_id?: string; check_name?: string; pattern?: string; reason?: string },
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const checkName = String(body?.check_name ?? '').trim();
    const pattern = String(body?.pattern ?? '').trim();
    const reason = String(body?.reason ?? '').trim();
    if (!checkName || !pattern || !reason) {
      throw new BadRequestException('check_name, pattern and reason are required');
    }
    const item = await this.repository.addKnownIssue({
      node_id: body?.node_id ? String(body.node_id).trim() : null,
      check_name: checkName,
      pattern,
      reason,
    });
    return { code: 0, data: item };
  }

  @Delete('known-issues/:issueId')
  async deleteKnownIssue(@Param('issueId') issueId?: string) {
    const id = String(issueId ?? '').trim();
    if (!id) {
      throw new BadRequestException('issueId is required');
    }
    const ok = await this.repository.deleteKnownIssue(id);
    return { code: 0, data: { ok } };
  }
}
