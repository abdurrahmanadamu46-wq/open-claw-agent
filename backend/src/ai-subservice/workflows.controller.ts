import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';
import type { Response } from 'express';

type AuthedRequest = {
  user?: {
    roles?: string[];
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listWorkflowCatalog() {
    return this.aiSubservice.listWorkflowCatalog();
  }

  @Get(':workflowId')
  getWorkflowDetail(@Param('workflowId') workflowId?: string) {
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    return this.aiSubservice.getWorkflowDetail(normalized);
  }

  @Get(':workflowId/lifecycle')
  getWorkflowLifecycle(@Param('workflowId') workflowId?: string) {
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    return this.aiSubservice.getWorkflowLifecycle(normalized);
  }

  @Put(':workflowId/lifecycle')
  @AuditLog({ action: 'update_workflow_lifecycle', resource: 'workflow' })
  updateWorkflowLifecycle(
    @Req() req: AuthedRequest | undefined,
    @Param('workflowId') workflowId?: string,
    @Body() body?: { new_lifecycle?: string; reason?: string },
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(workflowId ?? '').trim();
    const newLifecycle = String(body?.new_lifecycle ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    if (!newLifecycle) throw new BadRequestException('new_lifecycle is required');
    return this.aiSubservice.updateWorkflowLifecycle(normalized, {
      new_lifecycle: newLifecycle,
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }

  @Put(':workflowId')
  @AuditLog({ action: 'update_workflow_definition', resource: 'workflow' })
  updateWorkflowDefinition(
    @Req() req: AuthedRequest | undefined,
    @Param('workflowId') workflowId?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    return this.aiSubservice.updateWorkflowDefinition(normalized, body ?? {});
  }

  @Get(':workflowId/executions')
  listWorkflowExecutions(
    @Param('workflowId') workflowId?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('status') status?: string,
  ) {
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    const parsedPage = Number(page ?? 1);
    const parsedPageSize = Number(pageSize ?? 20);
    return this.aiSubservice.listWorkflowExecutions(normalized, {
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
      page_size: Number.isFinite(parsedPageSize) ? parsedPageSize : 20,
      status: status ? String(status).trim() : undefined,
    });
  }

  @Get('executions/:executionId')
  getWorkflowExecution(@Param('executionId') executionId?: string) {
    const normalized = String(executionId ?? '').trim();
    if (!normalized) throw new BadRequestException('executionId is required');
    return this.aiSubservice.getWorkflowExecution(normalized);
  }

  @Get('executions/:executionId/stream')
  async streamWorkflowExecution(@Param('executionId') executionId: string | undefined, @Res() res: Response) {
    const normalized = String(executionId ?? '').trim();
    if (!normalized) throw new BadRequestException('executionId is required');
    const upstream = await this.aiSubservice.openWorkflowExecutionStream(normalized);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    upstream.data.on('error', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    upstream.data.pipe(res);
  }

  @Post('executions/:executionId/replay')
  @AuditLog({ action: 'replay_workflow_execution', resource: 'workflow_run' })
  replayWorkflowExecution(
    @Param('executionId') executionId?: string,
    @Body() body?: { from_step_id?: string | null },
  ) {
    const normalized = String(executionId ?? '').trim();
    if (!normalized) throw new BadRequestException('executionId is required');
    return this.aiSubservice.replayWorkflowExecution(normalized, {
      from_step_id: body?.from_step_id ? String(body.from_step_id).trim() : undefined,
    });
  }

  @Get(':workflowId/webhooks')
  listWorkflowWebhooks(@Param('workflowId') workflowId?: string) {
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    return this.aiSubservice.listWorkflowWebhooks(normalized);
  }

  @Post(':workflowId/webhooks')
  @AuditLog({ action: 'create_workflow_webhook', resource: 'workflow' })
  createWorkflowWebhook(
    @Req() req: AuthedRequest | undefined,
    @Param('workflowId') workflowId?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(workflowId ?? '').trim();
    if (!normalized) throw new BadRequestException('workflowId is required');
    return this.aiSubservice.createWorkflowWebhook(normalized, body ?? {});
  }

  @Delete(':workflowId/webhooks/:webhookId')
  @AuditLog({ action: 'delete_workflow_webhook', resource: 'workflow' })
  deleteWorkflowWebhook(
    @Req() req: AuthedRequest | undefined,
    @Param('workflowId') workflowId?: string,
    @Param('webhookId') webhookId?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalizedWorkflowId = String(workflowId ?? '').trim();
    const normalizedWebhookId = String(webhookId ?? '').trim();
    if (!normalizedWorkflowId) throw new BadRequestException('workflowId is required');
    if (!normalizedWebhookId) throw new BadRequestException('webhookId is required');
    return this.aiSubservice.deleteWorkflowWebhook(normalizedWorkflowId, normalizedWebhookId);
  }
}
