import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  user?: {
    roles?: string[];
    sub?: string;
    userId?: string;
  };
};

function resolveOperatorUserId(req?: AuthedRequest): string {
  return String(req?.user?.userId ?? req?.user?.sub ?? '').trim();
}

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/rbac')
@UseGuards(JwtAuthGuard)
export class RbacController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('permissions')
  listPermissions(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.listRbacPermissions();
  }

  @Post('permissions')
  @AuditLog({ action: 'create_resource_permission', resource: 'rbac_permission' })
  createPermission(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.createRbacPermission(body ?? {});
  }

  @Delete('permissions/:permissionId')
  @AuditLog({ action: 'delete_resource_permission', resource: 'rbac_permission' })
  deletePermission(@Req() req?: AuthedRequest, @Param('permissionId') permissionId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(permissionId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('permissionId is required');
    }
    return this.aiSubservice.deleteRbacPermission(normalized);
  }

  @Get('users/:userId/permissions')
  listUserPermissions(@Req() req?: AuthedRequest, @Param('userId') userId?: string) {
    const normalized = String(userId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('userId is required');
    }
    const operator = resolveOperatorUserId(req);
    if (!isAdmin(req) && operator !== normalized) {
      throw new ForbiddenException('Forbidden for this user');
    }
    return this.aiSubservice.listUserRbacPermissions(normalized);
  }

  @Post('check')
  checkPermission(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.checkRbacPermission(body ?? {});
  }

  @Get('matrix')
  getMatrix(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getRbacMatrix();
  }
}
