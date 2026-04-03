import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

@Controller('api/v1')
@UseGuards(JwtAuthGuard)
export class ConcurrencyController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('tenant/concurrency-stats')
  getTenantConcurrencyStats() {
    return this.aiSubservice.getTenantConcurrencyStats();
  }

  @Get('admin/concurrency-overview')
  getAdminConcurrencyOverview(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getAdminConcurrencyOverview();
  }
}
