import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

@Controller('api/v1/cost')
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('lobsters')
  getLobsterCostSummary(
    @Req() req?: AuthedRequest,
    @Query('days') days?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const parsedDays = Number(days ?? 7);
    return this.aiSubservice.getLobsterCostSummary(
      { days: Number.isFinite(parsedDays) ? parsedDays : 7 },
      req?.headers?.authorization,
    );
  }

  @Get('lobsters/:lobsterId')
  getLobsterCostDetail(
    @Req() req?: AuthedRequest,
    @Param('lobsterId') lobsterId?: string,
    @Query('days') days?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    const parsedDays = Number(days ?? 7);
    return this.aiSubservice.getLobsterCostDetail(
      normalized,
      { days: Number.isFinite(parsedDays) ? parsedDays : 7 },
      req?.headers?.authorization,
    );
  }

  @Get('lobsters/:lobsterId/timeseries')
  getLobsterCostTimeseries(
    @Req() req?: AuthedRequest,
    @Param('lobsterId') lobsterId?: string,
    @Query('days') days?: string,
    @Query('bucket') bucket?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobsterId is required');
    const parsedDays = Number(days ?? 7);
    return this.aiSubservice.getLobsterCostTimeseries(
      normalized,
      {
        days: Number.isFinite(parsedDays) ? parsedDays : 7,
        bucket: bucket ? String(bucket).trim() : undefined,
      },
      req?.headers?.authorization,
    );
  }
}
