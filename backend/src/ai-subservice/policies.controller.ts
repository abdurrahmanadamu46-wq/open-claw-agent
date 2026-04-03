import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
  user?: {
    roles?: string[];
    isAdmin?: boolean;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  if (req?.user?.isAdmin) return true;
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/policies')
@UseGuards(JwtAuthGuard)
export class PoliciesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listPolicies(@Req() req?: AuthedRequest) {
    return this.aiSubservice.listPolicies(req?.headers?.authorization);
  }

  @Post()
  @AuditLog({ action: 'create_policy', resource: 'policy' })
  createPolicy(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createPolicy(body ?? {}, req?.headers?.authorization);
  }

  @Put(':ruleId')
  @AuditLog({ action: 'update_policy', resource: 'policy' })
  updatePolicy(
    @Req() req?: AuthedRequest,
    @Param('ruleId') ruleId?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(ruleId ?? '').trim();
    if (!normalized) throw new BadRequestException('ruleId is required');
    return this.aiSubservice.updatePolicy(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Delete(':ruleId')
  @AuditLog({ action: 'delete_policy', resource: 'policy' })
  deletePolicy(@Req() req?: AuthedRequest, @Param('ruleId') ruleId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(ruleId ?? '').trim();
    if (!normalized) throw new BadRequestException('ruleId is required');
    return this.aiSubservice.deletePolicy(normalized, req?.headers?.authorization);
  }

  @Post('evaluate')
  evaluatePolicy(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    return this.aiSubservice.evaluatePolicy(body ?? {}, req?.headers?.authorization);
  }

  @Get('bundle/current')
  getCurrentPolicyBundle(@Req() req?: AuthedRequest) {
    return this.aiSubservice.getCurrentPolicyBundle(req?.headers?.authorization);
  }

  @Post('bundle/publish')
  @AuditLog({ action: 'publish_policy_bundle', resource: 'policy_bundle' })
  publishPolicyBundle(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.publishPolicyBundle(body ?? {}, req?.headers?.authorization);
  }
}
