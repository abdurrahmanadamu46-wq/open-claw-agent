import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';

@Controller('api/v1/feedbacks')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Post()
  submit(@Body() body?: Record<string, unknown>) {
    if (!body || !String(body.task_id ?? '').trim() || !String(body.lobster_id ?? '').trim() || !String(body.rating ?? '').trim()) {
      throw new BadRequestException('task_id, lobster_id, rating are required');
    }
    return this.aiSubservice.submitFeedback(body);
  }

  @Get('export/by-lobster')
  export(@Query('lobster_id') lobsterId?: string, @Query('limit') limit?: string) {
    const normalized = String(lobsterId ?? '').trim();
    if (!normalized) throw new BadRequestException('lobster_id is required');
    const parsedLimit = Number(limit ?? 200);
    return this.aiSubservice.exportFeedbackDataset(normalized, Number.isFinite(parsedLimit) ? parsedLimit : 200);
  }

  @Get(':taskId')
  getTaskFeedback(@Param('taskId') taskId?: string) {
    const normalized = String(taskId ?? '').trim();
    if (!normalized) throw new BadRequestException('taskId is required');
    return this.aiSubservice.getTaskFeedback(normalized);
  }
}
