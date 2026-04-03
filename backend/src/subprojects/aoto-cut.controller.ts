import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { AotoCutService } from './aoto-cut.service';
import type { AotoCutOutputObject } from './aoto-cut.types';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
    userId?: string;
    isAdmin?: boolean;
  };
};

@Controller('api/v1/subprojects/aoto-cut')
@UseGuards(JwtAuthGuard)
export class AotoCutController {
  constructor(private readonly aotoCutService: AotoCutService) {}

  @Get('contract')
  getContract() {
    return { code: 0, data: this.aotoCutService.getContract() };
  }

  @Get('packages')
  async listPackages(
    @Req() req: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('package_type') packageType?: string,
    @Query('limit') limit?: string,
  ) {
    const targetTenant = String(tenantId ?? req.user?.tenantId ?? '').trim();
    const scopedTenant = String(req.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!req.user?.isAdmin && targetTenant !== scopedTenant) {
      throw new BadRequestException('tenant_id must match tenant scope');
    }
    const parsedLimit = Number(limit ?? 20);
    const items = await this.aotoCutService.listPackages({
      tenant_id: targetTenant,
      package_type: packageType ? String(packageType).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
    return { code: 0, data: { tenant_id: targetTenant, count: items.length, items } };
  }

  @Post('packages')
  @UseGuards(AdminRoleGuard)
  async ingestPackage(
    @Req() req: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      package_type?: AotoCutOutputObject;
      contract_version?: string;
      source?: string;
      trace_id?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    const tenantId = String(body?.tenant_id ?? req.user?.tenantId ?? '').trim();
    const packageType = String(body?.package_type ?? '').trim() as AotoCutOutputObject;
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!packageType) {
      throw new BadRequestException('package_type is required');
    }
    const record = await this.aotoCutService.ingestPackage({
      tenant_id: tenantId,
      package_type: packageType,
      contract_version: body?.contract_version,
      source: body?.source,
      trace_id: body?.trace_id,
      payload: (body?.payload ?? {}) as Record<string, unknown>,
      created_by: String(req.user?.userId ?? 'admin').trim() || 'admin',
    });
    return { code: 0, data: record };
  }
}
