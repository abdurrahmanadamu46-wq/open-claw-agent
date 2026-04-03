import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
};

@Controller('api/v1/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('kanban')
  getKanbanTasks(
    @Req() req?: AuthedRequest,
    @Query('recent_hours') recentHours?: string,
  ) {
    const parsedRecentHours = Number(recentHours ?? 24);
    return this.aiSubservice.getKanbanTasks(
      { recent_hours: Number.isFinite(parsedRecentHours) ? parsedRecentHours : 24 },
      req?.headers?.authorization,
    );
  }
}
