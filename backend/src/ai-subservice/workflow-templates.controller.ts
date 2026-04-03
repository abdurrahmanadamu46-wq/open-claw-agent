import { BadRequestException, Body, Controller, Param, Post, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

@Controller('api/v1/workflow-templates')
@UseGuards(JwtAuthGuard)
export class WorkflowTemplatesController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listTemplates(
    @Query('category') category?: string,
    @Query('difficulty') difficulty?: string,
    @Query('featured_only') featuredOnly?: string,
    @Query('search') search?: string,
  ) {
    return this.aiSubservice.listWorkflowTemplates({
      category: category ? String(category).trim() : undefined,
      difficulty: difficulty ? String(difficulty).trim() : undefined,
      featured_only: featuredOnly === 'true',
      search: search ? String(search).trim() : undefined,
    });
  }

  @Post(':templateId/use')
  @AuditLog({ action: 'use_workflow_template', resource: 'workflow_template' })
  useTemplate(@Param('templateId') templateId?: string, @Body() body?: { name?: string }) {
    const normalized = String(templateId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('templateId is required');
    }
    return this.aiSubservice.useWorkflowTemplate(normalized, {
      name: body?.name ? String(body.name).trim() : undefined,
    });
  }
}
