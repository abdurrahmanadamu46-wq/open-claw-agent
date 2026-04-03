import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiSubserviceService } from './ai-subservice.service';
import type { AnalyzeCompetitorInput, RunDragonTeamInput } from './ai-subservice.types';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RateLimit, RateLimitGuard } from '../common/guards/rate-limit.guard';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
    sub?: string;
    username?: string;
    userId?: string;
  };
};

function resolveOperatorUserId(req?: AuthedRequest): string {
  return String(req?.user?.userId ?? req?.user?.sub ?? req?.user?.username ?? '').trim();
}

function isAdmin(req?: AuthedRequest): boolean {
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/ai')
@UseGuards(JwtAuthGuard)
export class AiSubserviceController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('health')
  health() {
    return this.aiSubservice.getHealth();
  }

  @Get('strategy/intensity')
  getStrategyIntensity(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getStrategyIntensity({ tenant_id: targetTenant });
  }

  @Get('strategy/intensity/history')
  getStrategyIntensityHistory(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('lobster_id') lobsterId?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedDays = Number(days ?? 7);
    const parsedLimit = Number(limit ?? 200);
    return this.aiSubservice.getStrategyIntensityHistory({
      tenant_id: targetTenant,
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      days: Number.isFinite(parsedDays) ? parsedDays : 7,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 200,
    });
  }

  @Post('strategy/intensity/escalate')
  @AuditLog({ action: 'strategy_intensity_escalate', resource: 'strategy_intensity' })
  escalateStrategyIntensity(
    @Req() req?: AuthedRequest,
    @Body() body?: { tenant_id?: string; lobster_id?: string; reason?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const targetTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.escalateStrategyIntensity({
      tenant_id: targetTenant,
      lobster_id: body?.lobster_id ? String(body.lobster_id).trim() : undefined,
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }

  @Post('strategy/intensity/deescalate')
  @AuditLog({ action: 'strategy_intensity_deescalate', resource: 'strategy_intensity' })
  deescalateStrategyIntensity(
    @Req() req?: AuthedRequest,
    @Body() body?: { tenant_id?: string; lobster_id?: string; reason?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const targetTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.deescalateStrategyIntensity({
      tenant_id: targetTenant,
      lobster_id: body?.lobster_id ? String(body.lobster_id).trim() : undefined,
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }

  @Post('run-dragon-team')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60000)
  @AuditLog({ action: 'run_dragon_team', resource: 'task' })
  runDragonTeam(
    @Body()
    body: Omit<RunDragonTeamInput, 'user_id'> & {
      user_id?: string;
    },
    @Req() req?: AuthedRequest,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const requestedUserId = String(body?.user_id ?? '').trim();
    const finalUserId = requestedUserId || operatorUserId;
    if (!finalUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && finalUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.runDragonTeam({
      task_description: body.task_description,
      user_id: finalUserId,
      industry_tag: body.industry_tag ? String(body.industry_tag).trim() : undefined,
      competitor_handles: body.competitor_handles,
      edge_targets: body.edge_targets,
      client_preview: body.client_preview,
      industry_workflow_context: body.industry_workflow_context,
      execution_mode: body.execution_mode ?? 'assistive',
    });
  }

  @Post('run-dragon-team-async')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60000)
  @AuditLog({ action: 'run_dragon_team_async', resource: 'task' })
  runDragonTeamAsync(
    @Body()
    body: Omit<RunDragonTeamInput, 'user_id'> & {
      user_id?: string;
    },
    @Req() req?: AuthedRequest,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const requestedUserId = String(body?.user_id ?? '').trim();
    const finalUserId = requestedUserId || operatorUserId;
    if (!finalUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && finalUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.runDragonTeamAsync({
      task_description: body.task_description,
      user_id: finalUserId,
      industry_tag: body.industry_tag ? String(body.industry_tag).trim() : undefined,
      competitor_handles: body.competitor_handles,
      edge_targets: body.edge_targets,
      client_preview: body.client_preview,
      industry_workflow_context: body.industry_workflow_context,
      execution_mode: body.execution_mode ?? 'assistive',
    });
  }

  @Get('run-dragon-team-async/:jobId')
  runDragonTeamAsyncStatus(@Param('jobId') jobId: string, @Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const finalJobId = String(jobId ?? '').trim();
    if (!finalJobId) {
      throw new BadRequestException('jobId is required');
    }
    return this.aiSubservice.getRunDragonTeamAsyncStatus(finalJobId);
  }

  @Post('analyze-competitor-formula')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60000)
  @AuditLog({ action: 'analyze_competitor_formula', resource: 'competitive_intel' })
  analyzeCompetitorFormula(
    @Body()
    body: Omit<AnalyzeCompetitorInput, 'user_id'> & {
      user_id?: string;
    },
    @Req() req?: AuthedRequest,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const requestedUserId = String(body?.user_id ?? '').trim();
    const finalUserId = requestedUserId || operatorUserId;
    if (!finalUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && finalUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.analyzeCompetitorFormula({
      target_account_url: body.target_account_url,
      user_id: finalUserId,
      competitor_handles: body.competitor_handles,
    });
  }

  @Get('status')
  status(@Req() req?: AuthedRequest) {
    const operatorUserId = resolveOperatorUserId(req);
    if (!operatorUserId) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getUserStatus(operatorUserId);
  }

  @Get('billing/plans')
  billingPlans(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getBillingPlans();
  }

  @Get('billing/subscription')
  billingSubscription(@Req() req?: AuthedRequest, @Query('user_id') userId?: string) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(userId ?? operatorUserId).trim();
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId || !targetUserId) {
      throw new BadRequestException('user_id and tenant scope are required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.getBillingSubscription({
      user_id: targetUserId,
      tenant_id: tenantId,
    });
  }

  @Get('billing/usage-summary')
  billingUsageSummary(
    @Req() req?: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('from_ts') fromTs?: string,
    @Query('to_ts') toTs?: string,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(userId ?? operatorUserId).trim();
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId || !targetUserId) {
      throw new BadRequestException('user_id and tenant scope are required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.getBillingUsageSummary({
      user_id: targetUserId,
      tenant_id: tenantId,
      from_ts: fromTs ? String(fromTs).trim() : undefined,
      to_ts: toTs ? String(toTs).trim() : undefined,
    });
  }

  @Get('billing/providers-status')
  billingProvidersStatus(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getBillingProvidersStatus();
  }

  @Get('billing/orders')
  billingOrders(
    @Req() req?: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('limit') limit?: string,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(userId ?? operatorUserId).trim();
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId || !targetUserId) {
      throw new BadRequestException('user_id and tenant scope are required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getBillingOrders({
      user_id: targetUserId,
      tenant_id: tenantId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Post('billing/trial/activate')
  billingTrialActivate(
    @Req() req?: AuthedRequest,
    @Body() body?: { user_id?: string; plan_code?: string; duration_days?: number },
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(body?.user_id ?? operatorUserId).trim();
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId || !targetUserId) {
      throw new BadRequestException('user_id and tenant scope are required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    return this.aiSubservice.activateBillingTrial({
      user_id: targetUserId,
      tenant_id: tenantId,
      plan_code: body?.plan_code ? String(body.plan_code).trim() : undefined,
      duration_days: body?.duration_days,
    });
  }

  @Post('billing/checkout')
  billingCheckout(
    @Req() req?: AuthedRequest,
    @Body() body?: {
      user_id?: string;
      plan_code?: string;
      cycle?: string;
      provider?: string;
      return_url?: string;
    },
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(body?.user_id ?? operatorUserId).trim();
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId || !targetUserId) {
      throw new BadRequestException('user_id and tenant scope are required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    const planCode = String(body?.plan_code ?? '').trim();
    const cycle = String(body?.cycle ?? 'month').trim() || 'month';
    if (!planCode) {
      throw new BadRequestException('plan_code is required');
    }
    return this.aiSubservice.createBillingCheckout({
      user_id: targetUserId,
      tenant_id: tenantId,
      plan_code: planCode,
      cycle,
      provider: body?.provider ? String(body.provider).trim() : undefined,
      return_url: body?.return_url ? String(body.return_url).trim() : undefined,
    });
  }

  @Get('billing/compensation')
  billingCompensation(
    @Req() req?: AuthedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getBillingCompensation({
      tenant_id: tenantId,
      status: status ? String(status).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Post('billing/compensation/:taskId/resolve')
  billingCompensationResolve(
    @Req() req?: AuthedRequest,
    @Param('taskId') taskId?: string,
    @Body() body?: { status?: string; notes?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedTaskId = String(taskId ?? '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }
    return this.aiSubservice.resolveBillingCompensationTask({
      task_id: normalizedTaskId,
      status: String(body?.status ?? 'resolved').trim() || 'resolved',
      notes: body?.notes ? String(body.notes) : undefined,
    });
  }

  @Post('billing/reconcile/run')
  billingReconcileRun(
    @Req() req?: AuthedRequest,
    @Body() body?: {
      provider?: string;
      stale_minutes?: number;
      lookback_days?: number;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.runBillingReconciliation({
      provider: body?.provider ? String(body.provider).trim() : undefined,
      tenant_id: String(req?.user?.tenantId ?? '').trim() || undefined,
      stale_minutes: body?.stale_minutes,
      lookback_days: body?.lookback_days,
    });
  }

  @Get('billing/webhook/events')
  billingWebhookEvents(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getBillingWebhookEvents({
      tenant_id: tenantId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Get('industry-kb/taxonomy')
  industryKbTaxonomy(@Req() req?: AuthedRequest) {
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.getIndustryKbTaxonomy();
  }

  @Post('industry-kb/bootstrap')
  industryKbBootstrap(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      force?: boolean;
      selected_industry_tag?: string;
    },
  ) {
    const targetTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.bootstrapIndustryKb({
      tenant_id: targetTenant,
      force: body?.force === true,
      selected_industry_tag: body?.selected_industry_tag ? String(body.selected_industry_tag).trim() : undefined,
    });
  }

  @Post('industry-kb/starter-kit/generate')
  industryStarterKitGenerate(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      industry_tag?: string;
      force?: boolean;
      max_tasks?: number;
    },
  ) {
    const targetTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const industryTag = String(body?.industry_tag ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!industryTag) {
      throw new BadRequestException('industry_tag is required');
    }
    if (!isAdmin(req) && targetTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.generateIndustryStarterTasks({
      tenant_id: targetTenant,
      industry_tag: industryTag,
      force: body?.force === true,
      max_tasks: body?.max_tasks,
    });
  }

  @Get('industry-kb/starter-kit/tasks')
  industryStarterKitTasks(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('industry_tag') industryTag?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedIndustryTag = String(industryTag ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!normalizedIndustryTag) {
      throw new BadRequestException('industry_tag is required');
    }
    if (!isAdmin(req) && targetTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedLimit = Number(limit ?? 20);
    return this.aiSubservice.getIndustryStarterTasks({
      tenant_id: targetTenant,
      industry_tag: normalizedIndustryTag,
      status: status ? String(status).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
  }

  @Get('kernel/report/:traceId')
  getKernelReport(
    @Param('traceId') traceId: string,
    @Req() req: AuthedRequest | undefined,
    @Query('user_id') userId?: string,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const finalTraceId = String(traceId ?? '').trim();
    const targetUserId = String(userId ?? operatorUserId).trim();
    if (!targetUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    if (!finalTraceId) {
      throw new BadRequestException('traceId is required');
    }
    return this.aiSubservice.getKernelReport(finalTraceId, targetUserId);
  }

  @Get('kernel/alerts')
  getKernelAlerts(
    @Req() req: AuthedRequest | undefined,
    @Query('tenant_id') tenantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: 'hour' | 'day',
  ) {
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const scopedTenant = String(req?.user?.tenantId ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && targetTenant !== scopedTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getKernelAlerts({
      tenant_id: targetTenant,
      from: from ? String(from).trim() : undefined,
      to: to ? String(to).trim() : undefined,
      granularity,
    });
  }

  @Get('kernel/reports')
  listKernelReports(
    @Req() req?: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('limit') limit?: string,
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const targetUserId = String(userId ?? operatorUserId).trim();
    if (!targetUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.listKernelReports(targetUserId, Number.isFinite(parsedLimit) ? parsedLimit : 50);
  }

  @Post('kernel/report/:traceId/rollback')
  rollbackKernelReport(
    @Param('traceId') traceId: string,
    @Req() req: AuthedRequest | undefined,
    @Query('user_id') userId: string | undefined,
    @Body()
    body?: { stage?: 'preflight' | 'postgraph'; dry_run?: boolean; approval_id?: string },
  ) {
    const operatorUserId = resolveOperatorUserId(req);
    const finalTraceId = String(traceId ?? '').trim();
    const targetUserId = String(userId ?? operatorUserId).trim();
    if (!targetUserId) {
      throw new BadRequestException('user_id is required');
    }
    if (!isAdmin(req) && targetUserId !== operatorUserId) {
      throw new ForbiddenException('Forbidden: user_id out of scope');
    }
    if (!finalTraceId) {
      throw new BadRequestException('traceId is required');
    }
    return this.aiSubservice.rollbackKernelReport({
      traceId: finalTraceId,
      userId: targetUserId,
      stage: body?.stage === 'postgraph' ? 'postgraph' : 'preflight',
      dryRun: body?.dry_run !== false,
      approval_id: body?.approval_id ? String(body.approval_id).trim() : undefined,
    });
  }

  @Get('kernel/rollout/policy')
  getKernelRolloutPolicy(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getKernelRolloutPolicy(requestTenant);
  }

  @Get('kernel/rollout/templates')
  getKernelRolloutTemplates(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('limit') limit?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedLimit = Number(limit ?? 100);
    return this.aiSubservice.getKernelRolloutTemplates({
      tenant_id: requestTenant,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    });
  }

  @Get('kernel/rollout/templates/export')
  exportKernelRolloutTemplates(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('limit') limit?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedLimit = Number(limit ?? 500);
    return this.aiSubservice.exportKernelRolloutTemplates({
      tenant_id: requestTenant,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 500,
    });
  }

  @Post('kernel/rollout/templates')
  saveKernelRolloutTemplate(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      template_key?: string;
      template_name?: string;
      risk_rollout?: Record<string, unknown>;
      note?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const tenantId = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const templateName = String(body?.template_name ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!templateName) {
      throw new BadRequestException('template_name is required');
    }
    return this.aiSubservice.saveKernelRolloutTemplate({
      tenant_id: tenantId,
      template_key: body?.template_key ? String(body.template_key).trim() : undefined,
      template_name: templateName,
      risk_rollout: (body?.risk_rollout ?? {}) as Record<string, unknown>,
      note: body?.note ? String(body.note) : undefined,
    });
  }

  @Post('kernel/rollout/templates/import')
  importKernelRolloutTemplates(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      source_tenant_id?: string;
      mode?: 'upsert' | 'skip_existing' | 'replace_all';
      templates?: Array<{
        template_key?: string;
        template_name?: string;
        risk_rollout?: Record<string, unknown>;
        note?: string;
      }>;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const tenantId = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.importKernelRolloutTemplates({
      tenant_id: tenantId,
      source_tenant_id: body?.source_tenant_id ? String(body.source_tenant_id).trim() : undefined,
      mode:
        body?.mode === 'replace_all' || body?.mode === 'skip_existing'
          ? body.mode
          : 'upsert',
      templates: Array.isArray(body?.templates)
        ? body!.templates!
            .filter((item) => String(item?.template_name ?? '').trim().length > 0)
            .map((item) => ({
              template_key: item?.template_key ? String(item.template_key).trim() : undefined,
              template_name: String(item?.template_name ?? '').trim(),
              risk_rollout: (item?.risk_rollout ?? {}) as Record<string, unknown>,
              note: item?.note ? String(item.note) : undefined,
            }))
        : [],
    });
  }

  @Patch('kernel/rollout/templates/:templateKey')
  renameKernelRolloutTemplate(
    @Req() req?: AuthedRequest,
    @Param('templateKey') templateKey?: string,
    @Body()
    body?: {
      tenant_id?: string;
      new_template_key?: string;
      template_name?: string;
      note?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const tenantId = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const sourceKey = String(templateKey ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!sourceKey) {
      throw new BadRequestException('template_key is required');
    }
    const nextName = body?.template_name ? String(body.template_name).trim() : undefined;
    const nextKey = body?.new_template_key ? String(body.new_template_key).trim() : undefined;
    if (!nextName && !nextKey && body?.note === undefined) {
      throw new BadRequestException('template_name/new_template_key/note must provide at least one field');
    }
    return this.aiSubservice.renameKernelRolloutTemplate({
      tenant_id: tenantId,
      template_key: sourceKey,
      new_template_key: nextKey,
      template_name: nextName,
      note: body?.note ? String(body.note) : body?.note,
    });
  }

  @Delete('kernel/rollout/templates/:templateKey')
  deleteKernelRolloutTemplate(
    @Req() req?: AuthedRequest,
    @Param('templateKey') templateKey?: string,
    @Query('tenant_id') tenantId?: string,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const targetTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const sourceKey = String(templateKey ?? '').trim();
    if (!targetTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!sourceKey) {
      throw new BadRequestException('template_key is required');
    }
    return this.aiSubservice.deleteKernelRolloutTemplate({
      tenant_id: targetTenant,
      template_key: sourceKey,
    });
  }

  @Put('kernel/rollout/policy')
  updateKernelRolloutPolicy(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      enabled?: boolean;
      rollout_ratio?: number;
      block_mode?: 'hitl' | 'deny';
      risk_rollout?: Record<string, unknown>;
      window_start_utc?: string;
      window_end_utc?: string;
      note?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const tenantId = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    const ratio = Number(body?.rollout_ratio ?? 100);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      throw new BadRequestException('rollout_ratio must be between 0 and 100');
    }
    return this.aiSubservice.updateKernelRolloutPolicy({
      tenant_id: tenantId,
      enabled: body?.enabled !== false,
      rollout_ratio: ratio,
      block_mode: body?.block_mode === 'deny' ? 'deny' : 'hitl',
      risk_rollout: body?.risk_rollout,
      window_start_utc: body?.window_start_utc,
      window_end_utc: body?.window_end_utc,
      note: body?.note,
    });
  }

  @Get('kernel/metrics/dashboard')
  getKernelMetricsDashboard(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getKernelMetricsDashboard({
      tenant_id: requestTenant,
      from: from ? String(from).trim() : undefined,
      to: to ? String(to).trim() : undefined,
      granularity: String(granularity ?? '').trim().toLowerCase() === 'hour' ? 'hour' : 'day',
    });
  }

  @Get('llm/model/catalog')
  getLlmModelCatalog(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getLlmModelCatalog();
  }

  @Get('llm/providers')
  getLlmProviderConfigs(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getLlmProviderConfigs({ tenant_id: requestTenant });
  }

  @Put('llm/providers/:providerId')
  updateLlmProviderConfig(
    @Req() req?: AuthedRequest,
    @Param('providerId') providerId?: string,
    @Body()
    body?: {
      tenant_id?: string;
      enabled?: boolean;
      route?: 'local' | 'cloud';
      base_url?: string;
      default_model?: string;
      api_key?: string | null;
      note?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const sourceProvider = String(providerId ?? '').trim();
    if (!sourceProvider) {
      throw new BadRequestException('providerId is required');
    }
    const tenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!tenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.updateLlmProviderConfig(sourceProvider, {
      tenant_id: tenant,
      enabled: body?.enabled !== false,
      route: body?.route === 'local' ? 'local' : 'cloud',
      base_url: String(body?.base_url ?? '').trim(),
      default_model: String(body?.default_model ?? '').trim(),
      api_key: body?.api_key === undefined ? undefined : body.api_key,
      note: body?.note ? String(body.note) : undefined,
    });
  }

  @Get('llm/agent-bindings')
  getLlmAgentBindings(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getLlmAgentBindings({ tenant_id: requestTenant });
  }

  @Put('llm/agent-bindings/:agentId')
  updateLlmAgentBinding(
    @Req() req?: AuthedRequest,
    @Param('agentId') agentId?: string,
    @Body()
    body?: {
      tenant_id?: string;
      enabled?: boolean;
      task_type?: string;
      provider_id?: string;
      model_name?: string;
      temperature?: number;
      max_tokens?: number;
      note?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const sourceAgent = String(agentId ?? '').trim();
    if (!sourceAgent) {
      throw new BadRequestException('agentId is required');
    }
    const tenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!tenant) {
      throw new BadRequestException('tenant_id is required');
    }
    const providerId = String(body?.provider_id ?? '').trim();
    if (!providerId) {
      throw new BadRequestException('provider_id is required');
    }
    const rawTemp = Number(body?.temperature ?? 0.3);
    const rawMaxTokens = Number(body?.max_tokens ?? 0);
    return this.aiSubservice.updateLlmAgentBinding(sourceAgent, {
      tenant_id: tenant,
      enabled: body?.enabled !== false,
      task_type: String(body?.task_type ?? '').trim(),
      provider_id: providerId,
      model_name: String(body?.model_name ?? '').trim(),
      temperature: Number.isFinite(rawTemp) ? rawTemp : 0.3,
      max_tokens: Number.isFinite(rawMaxTokens) ? rawMaxTokens : 0,
      note: body?.note ? String(body.note) : undefined,
    });
  }

  @Get('agent/extensions')
  getAgentExtensions(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getAgentExtensions({ tenant_id: requestTenant });
  }

  @Get('agent/extensions/:agentId')
  getAgentExtensionProfile(
    @Req() req?: AuthedRequest,
    @Param('agentId') agentId?: string,
    @Query('tenant_id') tenantId?: string,
  ) {
    const sourceAgent = String(agentId ?? '').trim().toLowerCase();
    if (!sourceAgent) {
      throw new BadRequestException('agentId is required');
    }
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getAgentExtensionProfile(sourceAgent, { tenant_id: requestTenant });
  }

  @Put('agent/extensions/:agentId')
  updateAgentExtensionProfile(
    @Req() req?: AuthedRequest,
    @Param('agentId') agentId?: string,
    @Body()
    body?: {
      tenant_id?: string;
      enabled?: boolean;
      profile_version?: string;
      runtime_mode?: 'local' | 'cloud' | 'hybrid';
      role_prompt?: string;
      skills?: Array<Record<string, unknown>>;
      nodes?: Array<Record<string, unknown>>;
      hooks?: Record<string, unknown>;
      limits?: Record<string, unknown>;
      tags?: string[];
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const sourceAgent = String(agentId ?? '').trim().toLowerCase();
    if (!sourceAgent) {
      throw new BadRequestException('agentId is required');
    }
    const tenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!tenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.updateAgentExtensionProfile(sourceAgent, {
      tenant_id: tenant,
      enabled: body?.enabled !== false,
      profile_version: String(body?.profile_version ?? 'openclaw-native-v1').trim() || 'openclaw-native-v1',
      runtime_mode: body?.runtime_mode === 'local' || body?.runtime_mode === 'cloud' ? body.runtime_mode : 'hybrid',
      role_prompt: body?.role_prompt ? String(body.role_prompt) : '',
      skills: Array.isArray(body?.skills) ? body!.skills! : [],
      nodes: Array.isArray(body?.nodes) ? body!.nodes! : [],
      hooks: (body?.hooks ?? {}) as Record<string, unknown>,
      limits: (body?.limits ?? {}) as Record<string, unknown>,
      tags: Array.isArray(body?.tags)
        ? body!.tags!
            .map((item) => String(item ?? '').trim())
            .filter((item) => item.length > 0)
        : [],
    });
  }

  @Get('skills-pool/overview')
  getSkillsPoolOverview(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getSkillsPoolOverview({ tenant_id: requestTenant });
  }

  @Get('skills')
  listSkills(
    @Query('lobster_id') lobsterId?: string,
    @Query('category') category?: string,
    @Query('enabled_only') enabledOnly?: string,
  ) {
    return this.aiSubservice.listSkills({
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      category: category ? String(category).trim() : undefined,
      enabled_only: enabledOnly ? String(enabledOnly).trim() !== 'false' : true,
    });
  }

  @Get('skills/:skillId')
  getSkillDetail(@Param('skillId') skillId?: string) {
    const normalized = String(skillId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('skillId is required');
    }
    return this.aiSubservice.getSkillDetail(normalized);
  }

  @Post('skills/register')
  @AuditLog({ action: 'register_skill_package', resource: 'skill' })
  registerSkillPackage(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.registerSkillPackage(body ?? {});
  }

  @Patch('skills/:skillId/status')
  @AuditLog({ action: 'patch_skill_status', resource: 'skill' })
  patchSkillStatus(
    @Req() req?: AuthedRequest,
    @Param('skillId') skillId?: string,
    @Body() body?: { status?: string; note?: string },
  ) {
    const normalized = String(skillId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('skillId is required');
    }
    if (!body?.status) {
      throw new BadRequestException('status is required');
    }
    return this.aiSubservice.patchSkillStatus(normalized, {
      status: String(body.status).trim(),
      note: body?.note ? String(body.note).trim() : undefined,
    });
  }

  @Get('usecases')
  getUsecases(
    @Req() req?: AuthedRequest,
    @Query('category') category?: string,
    @Query('difficulty') difficulty?: string,
  ) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getUsecases({
      category: category ? String(category).trim() : undefined,
      difficulty: difficulty ? String(difficulty).trim() : undefined,
    });
  }

  @Get('usecases/categories')
  getUsecaseCategories(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getUsecaseCategories();
  }

  @Get('usecases/:usecaseId')
  getUsecase(@Req() req?: AuthedRequest, @Param('usecaseId') usecaseId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedUsecaseId = String(usecaseId ?? '').trim();
    if (!normalizedUsecaseId) {
      throw new BadRequestException('usecaseId is required');
    }
    return this.aiSubservice.getUsecase(normalizedUsecaseId);
  }

  @Get('workflow/list')
  getWorkflowDefinitions(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getWorkflowDefinitions();
  }

  @Post('workflow/run')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60000)
  @AuditLog({ action: 'start_workflow_run', resource: 'workflow_run' })
  startWorkflowRun(
    @Req() req?: AuthedRequest,
    @Body() body?: { workflow_id?: string; task?: string; industry?: string; industry_tag?: string; context?: Record<string, unknown>; notify_url?: string; idempotency_key?: string },
  ) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const workflowId = String(body?.workflow_id ?? '').trim();
    const task = String(body?.task ?? '').trim();
    if (!workflowId || !task) {
      throw new BadRequestException('workflow_id and task are required');
    }
    return this.aiSubservice.startWorkflowRun({
      workflow_id: workflowId,
      task,
      industry: body?.industry ? String(body.industry).trim() : undefined,
      industry_tag: body?.industry_tag ? String(body.industry_tag).trim() : undefined,
      context: body?.context ?? {},
      notify_url: body?.notify_url ? String(body.notify_url).trim() : undefined,
      idempotency_key: body?.idempotency_key ? String(body.idempotency_key).trim() : undefined,
    });
  }

  @Get('workflow/run/:runId')
  getWorkflowRun(@Req() req?: AuthedRequest, @Param('runId') runId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) {
      throw new BadRequestException('runId is required');
    }
    return this.aiSubservice.getWorkflowRun(normalizedRunId);
  }

  @Post('workflow/run/:runId/resume')
  @AuditLog({ action: 'resume_workflow_run', resource: 'workflow_run' })
  resumeWorkflowRun(@Req() req?: AuthedRequest, @Param('runId') runId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) {
      throw new BadRequestException('runId is required');
    }
    return this.aiSubservice.resumeWorkflowRun(normalizedRunId);
  }

  @Post('workflow/run/:runId/pause')
  @AuditLog({ action: 'pause_workflow_run', resource: 'workflow_run' })
  pauseWorkflowRun(@Req() req?: AuthedRequest, @Param('runId') runId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) {
      throw new BadRequestException('runId is required');
    }
    return this.aiSubservice.pauseWorkflowRun(normalizedRunId);
  }

  @Get('workflow/runs')
  listWorkflowRuns(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const parsedLimit = Number(limit ?? 20);
    return this.aiSubservice.listWorkflowRuns({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
  }

  @Get('providers/health')
  getProviderHealth(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getProviderHealth();
  }

  @Get('providers')
  listProviders(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.listProviders();
  }

  @Post('providers')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60000)
  @AuditLog({ action: 'create_provider', resource: 'provider' })
  createProvider(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.createProvider(body ?? {});
  }

  @Put('providers/:providerId')
  @AuditLog({ action: 'update_provider', resource: 'provider' })
  updateProvider(@Req() req?: AuthedRequest, @Param('providerId') providerId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedProviderId = String(providerId ?? '').trim();
    if (!normalizedProviderId) {
      throw new BadRequestException('providerId is required');
    }
    return this.aiSubservice.updateProvider(normalizedProviderId, body ?? {});
  }

  @Delete('providers/:providerId')
  @AuditLog({ action: 'delete_provider', resource: 'provider' })
  deleteProvider(@Req() req?: AuthedRequest, @Param('providerId') providerId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedProviderId = String(providerId ?? '').trim();
    if (!normalizedProviderId) {
      throw new BadRequestException('providerId is required');
    }
    return this.aiSubservice.deleteProvider(normalizedProviderId);
  }

  @Post('providers/:providerId/reload')
  @AuditLog({ action: 'reload_provider', resource: 'provider' })
  reloadProvider(@Req() req?: AuthedRequest, @Param('providerId') providerId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedProviderId = String(providerId ?? '').trim();
    if (!normalizedProviderId) {
      throw new BadRequestException('providerId is required');
    }
    return this.aiSubservice.reloadProvider(normalizedProviderId);
  }

  @Post('providers/:providerId/smoke')
  @AuditLog({ action: 'smoke_provider', resource: 'provider' })
  smokeProvider(
    @Req() req?: AuthedRequest,
    @Param('providerId') providerId?: string,
    @Body() body?: { prompt?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedProviderId = String(providerId ?? '').trim();
    if (!normalizedProviderId) {
      throw new BadRequestException('providerId is required');
    }
    return this.aiSubservice.smokeProvider(normalizedProviderId, body?.prompt ? String(body.prompt).trim() : undefined);
  }

  @Get('providers/:providerId/metrics')
  getProviderMetrics(@Req() req?: AuthedRequest, @Param('providerId') providerId?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedProviderId = String(providerId ?? '').trim();
    if (!normalizedProviderId) {
      throw new BadRequestException('providerId is required');
    }
    return this.aiSubservice.getProviderMetrics(normalizedProviderId);
  }

  @Get('escalations')
  getEscalations(@Req() req?: AuthedRequest, @Query('status') status?: string, @Query('limit') limit?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getEscalations({
      status: status ? String(status).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Post('escalations/:escalationId/resolve')
  @AuditLog({ action: 'resolve_escalation', resource: 'escalation' })
  resolveEscalation(
    @Req() req?: AuthedRequest,
    @Param('escalationId') escalationId?: string,
    @Body() body?: { resolution?: 'continue' | 'skip' | 'retry'; note?: string; resolved_by?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalized = String(escalationId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('escalationId is required');
    }
    return this.aiSubservice.resolveEscalation({
      escalation_id: normalized,
      resolution: body?.resolution ?? 'skip',
      note: body?.note ? String(body.note).trim() : undefined,
      resolved_by: body?.resolved_by ? String(body.resolved_by).trim() : resolveOperatorUserId(req),
    });
  }

  @Get('heartbeat/active-check')
  getActiveHeartbeatCheck(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.triggerActiveHeartbeatCheck();
  }

  @Get('heartbeat/active-check/history')
  getActiveHeartbeatHistory(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getActiveHeartbeatHistory();
  }

  @Get('commander/suggested-intents')
  getCommanderSuggestedIntents(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getCommanderSuggestedIntents();
  }

  @Get('restore-events')
  getRestoreEvents(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const parsedLimit = Number(limit ?? 20);
    return this.aiSubservice.getRestoreEvents({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
  }

  @Get('autonomy/policy')
  getAutonomyPolicy(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getAutonomyPolicy({ tenant_id: requestTenant });
  }

  @Put('autonomy/policy')
  @AuditLog({ action: 'update_autonomy_policy', resource: 'autonomy_policy' })
  updateAutonomyPolicy(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      default_level?: number;
      per_lobster_overrides?: Record<string, number>;
      reason?: string;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const requestTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    return this.aiSubservice.updateAutonomyPolicy({
      tenant_id: requestTenant,
      default_level: body?.default_level,
      per_lobster_overrides: (body?.per_lobster_overrides ?? {}) as Record<string, number>,
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }

  @Get('sessions')
  getSessions(
    @Req() req?: AuthedRequest,
    @Query('peer_id') peerId?: string,
    @Query('lobster_id') lobsterId?: string,
  ) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getSessions({
      peer_id: peerId ? String(peerId).trim() : undefined,
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
    });
  }

  @Get('sessions/:sessionId/history')
  getSessionHistory(
    @Req() req?: AuthedRequest,
    @Param('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      throw new BadRequestException('sessionId is required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getSessionHistory(normalizedSessionId, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Delete('sessions/:sessionId')
  clearSession(@Req() req?: AuthedRequest, @Param('sessionId') sessionId?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      throw new BadRequestException('sessionId is required');
    }
    return this.aiSubservice.clearSession(normalizedSessionId);
  }

  @Get('channels/status')
  getChannelStatus(@Req() req?: AuthedRequest) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    return this.aiSubservice.getChannelStatus();
  }

  @Get('channels/:channel/accounts')
  getChannelAccounts(@Req() req?: AuthedRequest, @Param('channel') channel?: string) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedChannel = String(channel ?? '').trim();
    if (!normalizedChannel) {
      throw new BadRequestException('channel is required');
    }
    return this.aiSubservice.getChannelAccounts(normalizedChannel);
  }

  @Put('channels/:channel/accounts/:accountId')
  @AuditLog({ action: 'update_channel_account_options', resource: 'channel_account' })
  updateChannelAccountOptions(
    @Req() req?: AuthedRequest,
    @Param('channel') channel?: string,
    @Param('accountId') accountId?: string,
    @Body()
    body?: {
      dm_scope?: 'shared' | 'per-peer' | 'isolated';
      group_respond_mode?: 'always' | 'intent' | 'mention_only';
      thinking_placeholder_enabled?: boolean;
      thinking_threshold_ms?: number;
    },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedChannel = String(channel ?? '').trim();
    const normalizedAccountId = String(accountId ?? '').trim();
    if (!normalizedChannel || !normalizedAccountId) {
      throw new BadRequestException('channel and accountId are required');
    }
    const dmScope = String(body?.dm_scope ?? 'shared').trim() as 'shared' | 'per-peer' | 'isolated';
    return this.aiSubservice.updateChannelAccountOptions({
      channel: normalizedChannel,
      account_id: normalizedAccountId,
      dm_scope: dmScope,
      group_respond_mode: body?.group_respond_mode,
      thinking_placeholder_enabled: body?.thinking_placeholder_enabled,
      thinking_threshold_ms: typeof body?.thinking_threshold_ms === 'number' ? body.thinking_threshold_ms : undefined,
    });
  }

  @Get('scheduler/tasks')
  getSchedulerTasks(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getSchedulerTasks({ tenant_id: requestTenant });
  }

  @Post('scheduler/tasks')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60000)
  @AuditLog({ action: 'create_scheduler_task', resource: 'scheduler_task' })
  createSchedulerTask(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      name?: string;
      kind?: 'cron' | 'every' | 'once';
      schedule?: string;
      lobster_id?: string;
      prompt?: string;
      session_mode?: 'shared' | 'isolated';
      delivery_channel?: string;
      max_retries?: number;
      enabled?: boolean;
    },
  ) {
    const requestTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const name = String(body?.name ?? '').trim();
    const kind = String(body?.kind ?? '').trim() as 'cron' | 'every' | 'once';
    const schedule = String(body?.schedule ?? '').trim();
    const lobsterId = String(body?.lobster_id ?? '').trim();
    const prompt = String(body?.prompt ?? '').trim();
    if (!name || !kind || !schedule || !lobsterId || !prompt) {
      throw new BadRequestException('name, kind, schedule, lobster_id and prompt are required');
    }
    return this.aiSubservice.createSchedulerTask({
      tenant_id: requestTenant,
      name,
      kind,
      schedule,
      lobster_id: lobsterId,
      prompt,
      session_mode: body?.session_mode ?? 'isolated',
      delivery_channel: body?.delivery_channel ? String(body.delivery_channel).trim() : 'last',
      max_retries: body?.max_retries,
      enabled: body?.enabled ?? true,
    });
  }

  @Delete('scheduler/tasks/:taskId')
  @AuditLog({ action: 'disable_scheduler_task', resource: 'scheduler_task' })
  disableSchedulerTask(
    @Req() req?: AuthedRequest,
    @Param('taskId') taskId?: string,
    @Query('tenant_id') tenantId?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const normalizedTaskId = String(taskId ?? '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }
    return this.aiSubservice.disableSchedulerTask(normalizedTaskId, { tenant_id: requestTenant });
  }

  @Get('scheduler/tasks/:taskId/history')
  getSchedulerTaskHistory(
    @Req() req?: AuthedRequest,
    @Param('taskId') taskId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!resolveOperatorUserId(req)) {
      throw new BadRequestException('user_id is required');
    }
    const normalizedTaskId = String(taskId ?? '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }
    const parsedLimit = Number(limit ?? 20);
    return this.aiSubservice.getSchedulerTaskHistory(normalizedTaskId, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
    });
  }

  @Get('memory/wisdoms')
  getMemoryWisdoms(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('category') category?: string,
    @Query('lobster_id') lobsterId?: string,
    @Query('limit') limit?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getMemoryWisdoms({
      tenant_id: requestTenant,
      category: category ? String(category).trim() : undefined,
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Get('memory/reports')
  getMemoryReports(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('lobster_id') lobsterId?: string,
    @Query('limit') limit?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getMemoryReports({
      tenant_id: requestTenant,
      lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Get('memory/stats')
  getMemoryStats(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getMemoryStats({ tenant_id: requestTenant });
  }

  @Get('memory/:tenantId/:lobsterId/stats')
  getLobsterMemoryStats(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('lobsterId') lobsterId?: string,
  ) {
    const requestTenant = String(tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    if (!requestTenant || !normalizedLobsterId) {
      throw new BadRequestException('tenantId and lobsterId are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getLobsterMemoryStats({
      tenant_id: requestTenant,
      lobster_id: normalizedLobsterId,
    });
  }

  @Get('memory/:tenantId/:lobsterId/search')
  searchLobsterMemory(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('lobsterId') lobsterId?: string,
    @Query('query') query?: string,
    @Query('category') category?: string,
    @Query('top_k') topK?: string,
  ) {
    const requestTenant = String(tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    const normalizedQuery = String(query ?? '').trim();
    if (!requestTenant || !normalizedLobsterId || !normalizedQuery) {
      throw new BadRequestException('tenantId, lobsterId and query are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    const parsedTopK = Number(topK ?? 5);
    return this.aiSubservice.searchLobsterMemory({
      tenant_id: requestTenant,
      lobster_id: normalizedLobsterId,
      query: normalizedQuery,
      category: category ? String(category).trim() : undefined,
      top_k: Number.isFinite(parsedTopK) ? parsedTopK : 5,
    });
  }

  @Post('memory/hybrid-search')
  hybridMemorySearch(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      tenant_id?: string;
      node_id?: string;
      lobster_name?: string;
      query?: string;
      memory_type?: string;
      days?: number;
      top_k?: number;
    },
  ) {
    const requestTenant = String(body?.tenant_id ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const query = String(body?.query ?? '').trim();
    if (!requestTenant || !query) {
      throw new BadRequestException('tenant_id and query are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.hybridMemorySearch({
      tenant_id: requestTenant,
      node_id: body?.node_id ? String(body.node_id).trim() : undefined,
      lobster_name: body?.lobster_name ? String(body.lobster_name).trim() : undefined,
      query,
      memory_type: body?.memory_type ? String(body.memory_type).trim() : undefined,
      days: Number.isFinite(Number(body?.days)) ? Number(body?.days) : undefined,
      top_k: Number.isFinite(Number(body?.top_k)) ? Number(body?.top_k) : undefined,
    });
  }

  @Get('memory/:tenantId/:lobsterId/:category')
  listLobsterMemoryByCategory(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('lobsterId') lobsterId?: string,
    @Param('category') category?: string,
  ) {
    const requestTenant = String(tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    const normalizedCategory = String(category ?? '').trim();
    if (!requestTenant || !normalizedLobsterId || !normalizedCategory) {
      throw new BadRequestException('tenantId, lobsterId and category are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.listLobsterMemoryByCategory({
      tenant_id: requestTenant,
      lobster_id: normalizedLobsterId,
      category: normalizedCategory,
    });
  }

  @Delete('memory/:tenantId/:lobsterId/:category/:key')
  @AuditLog({ action: 'delete_lobster_memory_item', resource: 'lobster_memory' })
  deleteLobsterMemoryItem(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('lobsterId') lobsterId?: string,
    @Param('category') category?: string,
    @Param('key') key?: string,
  ) {
    const requestTenant = String(tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedKey = String(key ?? '').trim();
    if (!requestTenant || !normalizedLobsterId || !normalizedCategory || !normalizedKey) {
      throw new BadRequestException('tenantId, lobsterId, category and key are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.deleteLobsterMemoryItem({
      tenant_id: requestTenant,
      lobster_id: normalizedLobsterId,
      category: normalizedCategory,
      key: normalizedKey,
    });
  }

  @Post('vector-backup/trigger')
  @AuditLog({ action: 'trigger_vector_backup', resource: 'vector_memory' })
  triggerVectorBackup(
    @Req() req?: AuthedRequest,
    @Body() body?: { collections?: string[] },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.triggerVectorBackup({
      collections: Array.isArray(body?.collections) ? body!.collections!.map((item) => String(item).trim()).filter(Boolean) : undefined,
    });
  }

  @Get('vector-backup/snapshots/:collectionName')
  listVectorBackupSnapshots(
    @Req() req?: AuthedRequest,
    @Param('collectionName') collectionName?: string,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const normalizedCollection = String(collectionName ?? '').trim();
    if (!normalizedCollection) {
      throw new BadRequestException('collectionName is required');
    }
    return this.aiSubservice.listVectorBackupSnapshots(normalizedCollection);
  }

  @Get('vector-backup/history')
  listVectorBackupHistory(
    @Req() req?: AuthedRequest,
    @Query('collection_name') collectionName?: string,
    @Query('limit') limit?: string,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.listVectorBackupHistory({
      collection_name: collectionName ? String(collectionName).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
  }

  @Get('tasks/:tenantId/:lobsterId/pending')
  getPendingTasks(
    @Req() req?: AuthedRequest,
    @Param('tenantId') tenantId?: string,
    @Param('lobsterId') lobsterId?: string,
  ) {
    const requestTenant = String(tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    const normalizedLobsterId = String(lobsterId ?? '').trim();
    if (!requestTenant || !normalizedLobsterId) {
      throw new BadRequestException('tenantId and lobsterId are required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getPendingTasks({
      tenant_id: requestTenant,
      lobster_id: normalizedLobsterId,
    });
  }

  @Get('agent-rag/catalog')
  getAgentRagCatalog(@Req() req?: AuthedRequest, @Query('tenant_id') tenantId?: string) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getAgentRagCatalog({ tenant_id: requestTenant });
  }

  @Get('agent-rag/packs')
  getAgentRagPacks(
    @Req() req?: AuthedRequest,
    @Query('tenant_id') tenantId?: string,
    @Query('profile') profile?: string,
  ) {
    const requestTenant = String(tenantId ?? req?.user?.tenantId ?? '').trim();
    const operatorTenant = String(req?.user?.tenantId ?? '').trim();
    if (!requestTenant) {
      throw new BadRequestException('tenant_id is required');
    }
    if (!isAdmin(req) && requestTenant !== operatorTenant) {
      throw new ForbiddenException('Forbidden: tenant_id out of scope');
    }
    return this.aiSubservice.getAgentRagPacks({
      tenant_id: requestTenant,
      profile: String(profile ?? 'feedback').trim() || 'feedback',
    });
  }

  @Get('integrations/libtv/status')
  getLibtvStatus(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getLibtvStatus();
  }

  @Get('integrations/libtv/session/:sessionId')
  getLibtvSession(
    @Req() req?: AuthedRequest,
    @Param('sessionId') sessionId?: string,
    @Query('after_seq') afterSeq?: string,
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const id = String(sessionId ?? '').trim();
    if (!id) {
      throw new BadRequestException('sessionId is required');
    }
    const parsedAfterSeq = Number(afterSeq ?? 0);
    return this.aiSubservice.getLibtvSession(id, Number.isFinite(parsedAfterSeq) ? parsedAfterSeq : 0);
  }

  @Get('notifications/status')
  notificationStatus(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getNotificationStatus();
  }

  @Get('notifications/outbox')
  notificationOutbox(@Req() req?: AuthedRequest, @Query('limit') limit?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 20);
    return this.aiSubservice.getNotificationOutbox(Number.isFinite(parsedLimit) ? parsedLimit : 20);
  }

  @Post('notifications/test')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60000)
  @AuditLog({ action: 'notification_test', resource: 'notification' })
  notificationTest(@Req() req?: AuthedRequest, @Body() body?: { target?: string; text?: string }) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const target = String(body?.target ?? '').trim();
    const text = String(body?.text ?? 'Lobster Pool notification channel test').trim();
    if (!target) {
      throw new BadRequestException('target is required');
    }
    return this.aiSubservice.sendNotificationTest({ target, text });
  }

  @Get('integrations/feishu/status')
  feishuStatus(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getFeishuStatus();
  }

  @Get('integrations/feishu/callback-readiness')
  feishuCallbackReadiness(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getFeishuCallbackReadiness();
  }

  @Get('commercial/readiness')
  commercialReadiness(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    return this.aiSubservice.getCommercialReadiness();
  }

  @Get('hitl/status/:approvalId')
  getHitlStatus(@Req() req: AuthedRequest | undefined, @Param('approvalId') approvalId: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const id = String(approvalId ?? '').trim();
    if (!id) {
      throw new BadRequestException('approvalId is required');
    }
    return this.aiSubservice.getHitlStatus(id);
  }

  @Get('hitl/pending')
  getHitlPending(@Req() req: AuthedRequest | undefined, @Query('limit') limit?: string) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.getHitlPending(Number.isFinite(parsedLimit) ? parsedLimit : 50);
  }

  @Post('hitl/decide')
  decideHitl(
    @Req() req: AuthedRequest | undefined,
    @Body() body?: { approval_id?: string; decision?: 'approved' | 'rejected'; operator?: string; reason?: string },
  ) {
    if (!isAdmin(req)) {
      throw new ForbiddenException('Admin role required');
    }
    const approvalId = String(body?.approval_id ?? '').trim();
    const decision = body?.decision === 'rejected' ? 'rejected' : 'approved';
    if (!approvalId) {
      throw new BadRequestException('approval_id is required');
    }
    const operator = String(body?.operator ?? resolveOperatorUserId(req)).trim() || resolveOperatorUserId(req);
    return this.aiSubservice.decideHitl({
      approval_id: approvalId,
      decision,
      operator,
      reason: body?.reason ? String(body.reason).trim() : undefined,
    });
  }
}
