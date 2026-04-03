import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import {
  ActivationCodeService,
  type ActivationCodeRecord,
  type ActivationCodeStatus,
} from './activation-code.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/activation-codes')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class ActivationCodeController {
  constructor(private readonly activationCodeService: ActivationCodeService) {}

  @Post()
  async create(
    @Req() req?: AuthedRequest,
    @Body() body?: { expiresAt?: string; count?: number; code?: string },
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const count = body?.count ? Number.parseInt(String(body.count), 10) : 1;
    if (!Number.isFinite(count) || count <= 0 || count > 100) {
      throw new BadRequestException('count must be a positive integer between 1 and 100');
    }

    const rows: ActivationCodeRecord[] = [];
    for (let i = 0; i < count; i += 1) {
      const record = await this.activationCodeService.createCode({
        tenantId,
        expiresAt: body?.expiresAt,
        code: count === 1 ? body?.code : undefined,
        createdBy: tenantId,
      });
      rows.push(record);
    }
    return { code: 0, data: { list: rows } };
  }

  @Get()
  async list(
    @Req() req?: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const normalizedStatus = status?.trim().toUpperCase() as ActivationCodeStatus | undefined;
    if (normalizedStatus && !['ACTIVE', 'REVOKED', 'EXPIRED'].includes(normalizedStatus)) {
      throw new BadRequestException('status must be one of ACTIVE/REVOKED/EXPIRED');
    }
    const list = await this.activationCodeService.listCodes(tenantId, parsedLimit, normalizedStatus);
    return { code: 0, data: { list } };
  }

  @Patch(':code/revoke')
  async revoke(@Req() req?: AuthedRequest, @Param('code') code?: string) {
    const tenantId = req?.user?.tenantId?.trim();
    const normalizedCode = code?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!normalizedCode) {
      throw new BadRequestException('code is required');
    }
    const record = await this.activationCodeService.setStatus(normalizedCode, tenantId, 'REVOKED');
    return { code: 0, data: record };
  }

  @Patch(':code/activate')
  async activate(
    @Req() req?: AuthedRequest,
    @Param('code') code?: string,
    @Body() body?: { expiresAt?: string },
  ) {
    const tenantId = req?.user?.tenantId?.trim();
    const normalizedCode = code?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!normalizedCode) {
      throw new BadRequestException('code is required');
    }
    const record = await this.activationCodeService.setStatus(normalizedCode, tenantId, 'ACTIVE', {
      expiresAt: body?.expiresAt,
    });
    return { code: 0, data: record };
  }
}
