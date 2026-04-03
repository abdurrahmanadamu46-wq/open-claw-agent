import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
    tenantId?: string;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/white-label')
export class WhiteLabelController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('resolve')
  resolveConfig(
    @Query('tenant_id') tenantId?: string,
    @Req() req?: { headers?: Record<string, string | undefined> },
  ) {
    const host = String(req?.headers?.host ?? '').trim();
    return this.aiSubservice.resolveWhiteLabel({ tenant_id: tenantId ? String(tenantId).trim() : undefined, host });
  }

  @Get(':tenantId')
  getConfig(@Param('tenantId') tenantId?: string) {
    const normalized = String(tenantId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }
    return this.aiSubservice.getWhiteLabelConfig(normalized);
  }

  @Get(':tenantId/preview')
  getPreview(@Param('tenantId') tenantId?: string) {
    const normalized = String(tenantId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }
    return this.aiSubservice.getWhiteLabelPreview(normalized);
  }

  @Put(':tenantId')
  @UseGuards(JwtAuthGuard)
  @AuditLog({ action: 'update_white_label', resource: 'white_label' })
  updateConfig(@Req() req: AuthedRequest | undefined, @Param('tenantId') tenantId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(tenantId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    if (req?.user?.tenantId && req.user.tenantId !== normalized) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    return this.aiSubservice.updateWhiteLabelConfig(normalized, body ?? {});
  }

  @Post(':tenantId/logo')
  @UseGuards(JwtAuthGuard)
  @AuditLog({ action: 'upload_white_label_logo', resource: 'white_label' })
  uploadLogo(@Req() req: AuthedRequest | undefined, @Param('tenantId') tenantId?: string, @Body() body?: Record<string, unknown>) {
    const normalized = String(tenantId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    if (req?.user?.tenantId && req.user.tenantId !== normalized) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    return this.aiSubservice.uploadWhiteLabelLogo(normalized, body ?? {});
  }

  @Delete(':tenantId')
  @UseGuards(JwtAuthGuard)
  @AuditLog({ action: 'delete_white_label', resource: 'white_label' })
  deleteConfig(@Req() req: AuthedRequest | undefined, @Param('tenantId') tenantId?: string) {
    const normalized = String(tenantId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('tenantId is required');
    }
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    if (req?.user?.tenantId && req.user.tenantId !== normalized) {
      throw new ForbiddenException('tenant scope mismatch');
    }
    return this.aiSubservice.deleteWhiteLabelConfig(normalized);
  }
}
