import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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

@Controller('api/v1/ai/admin')
@UseGuards(JwtAuthGuard)
export class AdminCrudController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('resources')
  listResources(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getAdminResources();
  }

  @Get(':resource')
  listItems(
    @Req() req?: AuthedRequest,
    @Param('resource') resource?: string,
    @Query() query?: Record<string, string>,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(resource ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('resource is required');
    }
    return this.aiSubservice.getAdminList(normalized, query ?? {});
  }

  @Get(':resource/:id')
  getItem(
    @Req() req?: AuthedRequest,
    @Param('resource') resource?: string,
    @Param('id') id?: string,
    @Query() query?: Record<string, string>,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(resource ?? '').trim();
    const normalizedId = String(id ?? '').trim();
    if (!normalized || !normalizedId) {
      throw new BadRequestException('resource and id are required');
    }
    return this.aiSubservice.getAdminOne(normalized, normalizedId, query ?? {});
  }

  @Post(':resource')
  @AuditLog({ action: 'admin_crud_create', resource: 'admin_resource' })
  createItem(@Req() req?: AuthedRequest, @Param('resource') resource?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(resource ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('resource is required');
    }
    return this.aiSubservice.createAdminItem(normalized, body ?? {});
  }

  @Put(':resource/:id')
  @AuditLog({ action: 'admin_crud_update', resource: 'admin_resource' })
  updateItem(
    @Req() req?: AuthedRequest,
    @Param('resource') resource?: string,
    @Param('id') id?: string,
    @Body() body?: Record<string, unknown>,
    @Query() query?: Record<string, string>,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(resource ?? '').trim();
    const normalizedId = String(id ?? '').trim();
    if (!normalized || !normalizedId) {
      throw new BadRequestException('resource and id are required');
    }
    return this.aiSubservice.updateAdminItem(normalized, normalizedId, body ?? {}, query ?? {});
  }

  @Delete(':resource/:id')
  @AuditLog({ action: 'admin_crud_delete', resource: 'admin_resource' })
  deleteItem(@Req() req?: AuthedRequest, @Param('resource') resource?: string, @Param('id') id?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(resource ?? '').trim();
    const normalizedId = String(id ?? '').trim();
    if (!normalized || !normalizedId) {
      throw new BadRequestException('resource and id are required');
    }
    return this.aiSubservice.deleteAdminItem(normalized, normalizedId);
  }
}
