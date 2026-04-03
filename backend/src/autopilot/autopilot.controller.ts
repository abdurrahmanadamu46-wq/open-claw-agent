import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AutopilotCoordinatorService } from './autopilot-coordinator.service';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import type { RadarSniffingJobPayload, DlqReplayResult } from './autopilot.types';
import { AutopilotDlqService } from './autopilot-dlq.service';
import { AutopilotTaskStateService } from './autopilot-task-state.service';
import { AutopilotTaskControlService } from './autopilot-task-control.service';
import { AutopilotTraceService } from './autopilot-trace.service';
import { AutopilotMetricsService } from './autopilot-metrics.service';
import { AutopilotAlertService, type AutopilotAlertSignal } from './autopilot-alert.service';
import {
  AutopilotLogAuditService,
  type AutopilotAuditLogLevel,
  type AutopilotAuditLogModule,
} from './autopilot-log-audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

type AuthedRequest = {
  user: {
    tenantId: string;
    roles: string[];
    isAdmin: boolean;
  };
};

@Controller('autopilot')
export class AutopilotController {
  constructor(
    private readonly coordinator: AutopilotCoordinatorService,
    private readonly circuit: AutopilotCircuitService,
    private readonly dlqService: AutopilotDlqService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly taskControlService: AutopilotTaskControlService,
    private readonly traceService: AutopilotTraceService,
    private readonly metricsService: AutopilotMetricsService,
    private readonly alertService: AutopilotAlertService,
    private readonly logAuditService: AutopilotLogAuditService,
  ) {}

  /**
   * 熔断状态（供前端展示）
   */
  @Get('status')
  status(): { circuitOpen: boolean } {
    return { circuitOpen: this.circuit.isCircuitOpen() };
  }

  /**
   * 手动触发一次探针（用于测试或补跑）
   */
  @Post('trigger-probe')
  async triggerProbe(
    @Body() body?: Partial<RadarSniffingJobPayload>,
    @Headers('x-trace-id') headerTraceId?: string,
  ): Promise<{ jobId: string; traceId: string }> {
    const result = await this.coordinator.triggerProbe({
      ...(body ?? {}),
      traceId: body?.traceId ?? headerTraceId,
    });
    return result;
  }

  /**
   * 人工恢复熔断
   */
  @Post('reset-circuit')
  resetCircuit(): { ok: boolean } {
    this.coordinator.resetCircuit();
    return { ok: true };
  }

  /**
   * DLQ 手动重放入口：将死信任务 replayCount +1 后重新投递到原主队列
   */
  @Post('dlq/replay')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async replayDlq(
    @Body() body: {
      sourceQueue: string;
      dlqJobId: string;
      operatorId?: string;
      operatorName?: string;
      operatorSource?: string;
    },
    @Headers('x-operator-id') headerOperatorId?: string,
    @Headers('x-operator-name') headerOperatorName?: string,
    @Headers('x-operator-source') headerOperatorSource?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{ ok: boolean; replayJobId: string; replayCount: number; result: DlqReplayResult }> {
    const sourceQueue = body?.sourceQueue?.trim();
    const dlqJobId = body?.dlqJobId?.trim();
    const operatorId = body?.operatorId?.trim() || headerOperatorId?.trim();
    const operatorName = body?.operatorName?.trim() || headerOperatorName?.trim();
    const operatorSource = body?.operatorSource?.trim() || headerOperatorSource?.trim();
    if (!sourceQueue || !dlqJobId) {
      throw new BadRequestException('sourceQueue and dlqJobId are required');
    }
    if (!operatorId) {
      throw new BadRequestException('operatorId is required (body.operatorId or x-operator-id)');
    }

    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const result = await this.dlqService.replayFromDlq(
      sourceQueue,
      dlqJobId,
      {
        operatorId,
        operatorName: operatorName || undefined,
        operatorSource: operatorSource || undefined,
      },
      tenantScope,
    );
    return {
      ok: true,
      replayJobId: result.replayJobId,
      replayCount: result.replayCount,
      result: result.result,
    };
  }

  /**
   * DLQ 查询入口：按 sourceQueue 返回最近死信任务
   */
  @Get('dlq/list')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async listDlq(
    @Query('sourceQueue') sourceQueue?: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    sourceQueue: string;
    count: number;
    items: Array<{
      dlqJobId: string;
      sourceJobId: string;
      tenantId: string;
      traceId: string;
      campaignId?: string;
      taskId: string;
      stage: string;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      attemptsMade: number;
      maxAttempts: number;
      failedAt: string;
      replayedAt?: string;
      replayJobId?: string;
    }>;
  }> {
    const normalizedSourceQueue = sourceQueue?.trim();
    if (!normalizedSourceQueue) {
      throw new BadRequestException('sourceQueue is required');
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const items = await this.dlqService.listDlq(normalizedSourceQueue, tenantScope, parsedLimit);
    return {
      ok: true,
      sourceQueue: normalizedSourceQueue,
      count: items.length,
      items,
    };
  }

  @Get('dlq/replay-audit')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async listDlqReplayAudit(
    @Query('sourceQueue') sourceQueue?: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    sourceQueue: string;
    count: number;
    items: Array<{
      auditId: string;
      sourceQueue: string;
      dlqJobId: string;
      sourceJobId?: string;
      taskId?: string;
      stage?: string;
      traceId?: string;
      replayJobId?: string;
      replayCount?: number;
      requestedAt: string;
      completedAt?: string;
      operatorId: string;
      operatorName?: string;
      operatorSource?: string;
      result: DlqReplayResult;
      errorMessage?: string;
    }>;
  }> {
    const normalizedSourceQueue = sourceQueue?.trim();
    if (!normalizedSourceQueue) {
      throw new BadRequestException('sourceQueue is required');
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 50;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const items = await this.dlqService.listReplayAudit(normalizedSourceQueue, tenantScope, parsedLimit);
    return {
      ok: true,
      sourceQueue: normalizedSourceQueue,
      count: items.length,
      items,
    };
  }

  @Get('tasks/state')
  async getTaskState(
    @Query('taskId') taskId?: string,
  ): Promise<{ ok: boolean; taskId: string; records: Awaited<ReturnType<AutopilotTaskStateService['listByTaskId']>> }> {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }
    const records = await this.taskStateService.listByTaskId(normalizedTaskId);
    return { ok: true, taskId: normalizedTaskId, records };
  }

  @Get('metrics/dashboard')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async getDashboardMetrics(
    @Query('windowMinutes') windowMinutes?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceQueue') sourceQueue?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    tenantId: string;
    windowMinutes: number;
    query: { from?: string; to?: string; sourceQueue?: string };
    totals: {
      queueProcessFail: number;
      dlqEnqueue: number;
      replayAttempt: number;
      replaySuccess: number;
      replayFailed: number;
      replaySuccessRate: number;
    };
    byQueue: {
      queueProcessFail: Record<string, number>;
      dlqEnqueue: Record<string, number>;
    };
  }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedWindow = windowMinutes ? Number.parseInt(windowMinutes, 10) : 60;
    if (!Number.isFinite(parsedWindow) || parsedWindow <= 0) {
      throw new BadRequestException('windowMinutes must be a positive integer');
    }
    const normalizedFrom = from?.trim();
    const normalizedTo = to?.trim();
    const normalizedSourceQueue = sourceQueue?.trim();
    const parsedFrom = normalizedFrom ? new Date(normalizedFrom) : undefined;
    const parsedTo = normalizedTo ? new Date(normalizedTo) : undefined;
    if (normalizedFrom && Number.isNaN(parsedFrom?.getTime())) {
      throw new BadRequestException('from must be a valid ISO datetime');
    }
    if (normalizedTo && Number.isNaN(parsedTo?.getTime())) {
      throw new BadRequestException('to must be a valid ISO datetime');
    }
    const metrics = await this.metricsService.getDashboardMetrics(tenantScope, {
      windowMinutes: parsedWindow,
      from: parsedFrom,
      to: parsedTo,
      sourceQueue: normalizedSourceQueue,
    });
    return {
      ok: true,
      tenantId: metrics.tenantId,
      windowMinutes: metrics.windowMinutes,
      query: metrics.query,
      totals: metrics.totals,
      byQueue: metrics.byQueue,
    };
  }

  @Get('alerts/evaluate')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async evaluateAlerts(
    @Query('windowMinutes') windowMinutes?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceQueue') sourceQueue?: string,
    @Query('emit') emit?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    tenantId: string;
    query: { windowMinutes: number; from?: string; to?: string; sourceQueue?: string };
    signals: AutopilotAlertSignal[];
  }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedWindow = windowMinutes ? Number.parseInt(windowMinutes, 10) : 60;
    if (!Number.isFinite(parsedWindow) || parsedWindow <= 0) {
      throw new BadRequestException('windowMinutes must be a positive integer');
    }
    const normalizedFrom = from?.trim();
    const normalizedTo = to?.trim();
    const normalizedSourceQueue = sourceQueue?.trim();
    const parsedFrom = normalizedFrom ? new Date(normalizedFrom) : undefined;
    const parsedTo = normalizedTo ? new Date(normalizedTo) : undefined;
    if (normalizedFrom && Number.isNaN(parsedFrom?.getTime())) {
      throw new BadRequestException('from must be a valid ISO datetime');
    }
    if (normalizedTo && Number.isNaN(parsedTo?.getTime())) {
      throw new BadRequestException('to must be a valid ISO datetime');
    }
    const shouldEmit =
      emit === '1' || emit?.toLowerCase() === 'true' || emit?.toLowerCase() === 'yes';
    const result = await this.alertService.evaluate(tenantScope, {
      windowMinutes: parsedWindow,
      from: parsedFrom,
      to: parsedTo,
      sourceQueue: normalizedSourceQueue,
      emit: shouldEmit,
    });
    return {
      ok: true,
      tenantId: result.tenantId,
      query: result.query,
      signals: result.signals,
    };
  }

  @Get('trace/:traceId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async getTraceSnapshot(
    @Param('traceId') traceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('errorsOnly') errorsOnly?: string,
    @Query('sourceQueue') sourceQueue?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    traceId: string;
    tenantId: string;
    query: { from?: string; to?: string; errorsOnly: boolean; sourceQueue?: string };
    taskStates: Awaited<ReturnType<AutopilotTraceService['getTraceSnapshot']>>['taskStates'];
    dlqItems: Awaited<ReturnType<AutopilotTraceService['getTraceSnapshot']>>['dlqItems'];
    replayAudits: Awaited<ReturnType<AutopilotTraceService['getTraceSnapshot']>>['replayAudits'];
    behavior: Awaited<ReturnType<AutopilotTraceService['getTraceSnapshot']>>['behavior'];
    fleet: Awaited<ReturnType<AutopilotTraceService['getTraceSnapshot']>>['fleet'];
  }> {
    const normalizedTraceId = traceId?.trim();
    if (!normalizedTraceId) {
      throw new BadRequestException('traceId is required');
    }
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedErrorsOnly =
      errorsOnly === '1' || errorsOnly?.toLowerCase() === 'true' || errorsOnly?.toLowerCase() === 'yes';
    const normalizedSourceQueue = sourceQueue?.trim() || undefined;
    const snapshot = await this.traceService.getTraceSnapshot(normalizedTraceId, tenantScope, {
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      errorsOnly: parsedErrorsOnly,
      sourceQueue: normalizedSourceQueue,
    });
    return {
      ok: true,
      traceId: snapshot.traceId,
      tenantId: snapshot.tenantId,
      query: {
        from: from?.trim() || undefined,
        to: to?.trim() || undefined,
        errorsOnly: parsedErrorsOnly,
        sourceQueue: normalizedSourceQueue,
      },
      taskStates: snapshot.taskStates,
      dlqItems: snapshot.dlqItems,
      replayAudits: snapshot.replayAudits,
      behavior: snapshot.behavior,
      fleet: snapshot.fleet,
    };
  }

  @Get('logs/search')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async searchLogs(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('errorsOnly') errorsOnly?: string,
    @Query('sourceQueue') sourceQueue?: string,
    @Query('module') module?: string,
    @Query('level') level?: string,
    @Query('nodeId') nodeId?: string,
    @Query('traceId') traceId?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{
    ok: boolean;
    tenantId: string;
    query: {
      from?: string;
      to?: string;
      errorsOnly: boolean;
      sourceQueue?: string;
      module?: string;
      level?: string;
      nodeId?: string;
      traceId?: string;
      keyword?: string;
      limit: number;
    };
    total: number;
    items: Array<{
      id: string;
      ts: string;
      level: AutopilotAuditLogLevel;
      module: AutopilotAuditLogModule;
      nodeId?: string;
      traceId?: string;
      eventType: string;
      message: string;
      campaignId?: string;
      sourceQueue?: string;
      durationMs?: number;
      taskId?: string;
      stage?: string;
    }>;
  }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    if (limit && (!Number.isFinite(parsedLimit) || (parsedLimit ?? 0) <= 0)) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const parsedErrorsOnly =
      errorsOnly === '1' || errorsOnly?.toLowerCase() === 'true' || errorsOnly?.toLowerCase() === 'yes';
    const result = await this.logAuditService.searchLogs(tenantScope, {
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      errorsOnly: parsedErrorsOnly,
      sourceQueue: sourceQueue?.trim() || undefined,
      module: module?.trim() || undefined,
      level: level?.trim() || undefined,
      nodeId: nodeId?.trim() || undefined,
      traceId: traceId?.trim() || undefined,
      keyword: keyword?.trim() || undefined,
      limit: parsedLimit,
    });
    return {
      ok: true,
      tenantId: result.tenantId,
      query: result.query,
      total: result.total,
      items: result.items,
    };
  }

  @Post('tasks/cancel')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async cancelTask(
    @Body() body: {
      taskId: string;
      stage: string;
      tenantId?: string;
      sourceQueue: string;
      campaignId?: string;
      reason?: string;
      operatorId?: string;
    },
    @Req() req?: AuthedRequest,
  ): Promise<{ ok: boolean; taskId: string; stage: string; removedJobs: number; inspectedJobs: number }> {
    const taskId = body?.taskId?.trim();
    const stage = body?.stage?.trim();
    const sourceQueue = body?.sourceQueue?.trim();
    if (!taskId || !stage || !sourceQueue) {
      throw new BadRequestException('taskId, stage and sourceQueue are required');
    }
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const targetTenantId = this.taskControlService.assertTenantScope(tenantScope, body?.tenantId);
    const operatorId = body?.operatorId?.trim();
    const result = await this.taskControlService.cancelTask({
      taskId,
      stage,
      tenantId: targetTenantId,
      campaignId: body?.campaignId?.trim() || undefined,
      sourceQueue,
      reason: body?.reason?.trim() || 'Canceled by operator',
      operatorId: operatorId || undefined,
    });
    return { ok: true, taskId, stage, removedJobs: result.removedJobs, inspectedJobs: result.inspectedJobs };
  }
}
