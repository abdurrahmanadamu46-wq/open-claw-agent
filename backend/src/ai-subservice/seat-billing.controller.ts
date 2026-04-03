import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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

@Controller('api/v1/ai/billing/seats')
@UseGuards(JwtAuthGuard)
export class SeatBillingController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('plans')
  listPlans() {
    return this.aiSubservice.getSeatBillingPlans();
  }

  @Get('subscription')
  getSubscription(@Req() req?: AuthedRequest) {
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    return this.aiSubservice.getSeatBillingSubscription({ tenant_id: tenantId });
  }

  @Post('subscription')
  @AuditLog({ action: 'create_seat_subscription', resource: 'seat_subscription' })
  createSubscription(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    return this.aiSubservice.createSeatBillingSubscription({
      ...(body ?? {}),
      tenant_id: tenantId || body?.tenant_id,
    });
  }

  @Post('subscription/:subscriptionId/checkout')
  @AuditLog({ action: 'checkout_seat_subscription', resource: 'seat_subscription' })
  checkout(
    @Req() req?: AuthedRequest,
    @Param('subscriptionId') subscriptionId?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(subscriptionId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('subscriptionId is required');
    }
    return this.aiSubservice.createSeatBillingCheckout(normalized, body ?? {});
  }

  @Post('subscription/:subscriptionId/upgrade')
  @AuditLog({ action: 'upgrade_seat_subscription', resource: 'seat_subscription' })
  upgrade(
    @Req() req?: AuthedRequest,
    @Param('subscriptionId') subscriptionId?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(subscriptionId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('subscriptionId is required');
    }
    return this.aiSubservice.upgradeSeatBillingSubscription(normalized, body ?? {});
  }

  @Get('quotas')
  getQuotas(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const effectiveTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    if (!effectiveTenant) {
      throw new BadRequestException('tenantId is required');
    }
    return this.aiSubservice.getSeatQuotaSummary(effectiveTenant);
  }
}
