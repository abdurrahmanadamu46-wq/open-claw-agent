import { BadRequestException, Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics(@Req() req?: AuthedRequest): Promise<{ code: number; data: unknown }> {
    const tenantId = req?.user?.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const data = await this.dashboardService.getMetrics(tenantId);
    return { code: 0, data };
  }
}

