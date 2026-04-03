import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

@Controller('api/v1/activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  getActivities(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('type') type?: string,
  ) {
    const parsedLimit = Number(limit ?? 50);
    const parsedOffset = Number(offset ?? 0);
    return this.aiSubservice.getActivities({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      type: type ? String(type).trim() : undefined,
    });
  }

  @Get(':id')
  getActivity(@Param('id') activityId?: string) {
    const normalizedActivityId = String(activityId ?? '').trim();
    if (!normalizedActivityId) {
      throw new BadRequestException('id is required');
    }
    return this.aiSubservice.getActivity(normalizedActivityId);
  }
}
