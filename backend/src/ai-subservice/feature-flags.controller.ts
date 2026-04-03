import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
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

@Controller('api/v1/feature-flags')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listFlags(@Req() req?: AuthedRequest, @Query('environment') environment?: string, @Query('tenant_id') tenantId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listFeatureFlags({
      environment: environment ? String(environment).trim() : undefined,
      tenant_id: tenantId ? String(tenantId).trim() : undefined,
    });
  }

  @Post()
  @AuditLog({ action: 'create_feature_flag', resource: 'feature_flag' })
  createFlag(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createFeatureFlag(body ?? {});
  }

  @Post('check')
  checkFlag(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.checkFeatureFlag(body ?? {});
  }

  @Get('changelog')
  getChangelog(@Req() req?: AuthedRequest, @Query('name') name?: string, @Query('limit') limit?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const parsedLimit = Number(limit ?? 100);
    return this.aiSubservice.getFeatureFlagChangelog({
      name: name ? String(name).trim() : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    });
  }

  @Post('export')
  exportFlags(@Req() req?: AuthedRequest, @Query('environment') environment?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.exportFeatureFlags({ environment: environment ? String(environment).trim() : undefined });
  }

  @Post('import')
  @AuditLog({ action: 'import_feature_flags', resource: 'feature_flag' })
  importFlags(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.importFeatureFlags(body ?? {});
  }

  @Get(':name')
  getFlag(@Req() req?: AuthedRequest, @Param('name') name?: string, @Query('environment') environment?: string, @Query('tenant_id') tenantId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.getFeatureFlag(normalized, {
      environment: environment ? String(environment).trim() : undefined,
      tenant_id: tenantId ? String(tenantId).trim() : undefined,
    });
  }

  @Put(':name')
  @AuditLog({ action: 'update_feature_flag', resource: 'feature_flag' })
  updateFlag(@Req() req?: AuthedRequest, @Param('name') name?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.updateFeatureFlag(normalized, body ?? {});
  }

  @Delete(':name')
  @AuditLog({ action: 'delete_feature_flag', resource: 'feature_flag' })
  deleteFlag(@Req() req?: AuthedRequest, @Param('name') name?: string, @Query('environment') environment?: string, @Query('tenant_id') tenantId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.deleteFeatureFlag(normalized, {
      environment: environment ? String(environment).trim() : undefined,
      tenant_id: tenantId ? String(tenantId).trim() : undefined,
    });
  }

  @Post(':name/enable')
  @AuditLog({ action: 'enable_feature_flag', resource: 'feature_flag' })
  enableFlag(@Req() req?: AuthedRequest, @Param('name') name?: string, @Query('environment') environment?: string, @Query('tenant_id') tenantId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.enableFeatureFlag(normalized, {
      environment: environment ? String(environment).trim() : undefined,
      tenant_id: tenantId ? String(tenantId).trim() : undefined,
    });
  }

  @Post(':name/disable')
  @AuditLog({ action: 'disable_feature_flag', resource: 'feature_flag' })
  disableFlag(@Req() req?: AuthedRequest, @Param('name') name?: string, @Query('environment') environment?: string, @Query('tenant_id') tenantId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.disableFeatureFlag(normalized, {
      environment: environment ? String(environment).trim() : undefined,
      tenant_id: tenantId ? String(tenantId).trim() : undefined,
    });
  }

  @Post(':name/strategies')
  @AuditLog({ action: 'update_feature_flag_strategies', resource: 'feature_flag' })
  updateStrategies(@Req() req?: AuthedRequest, @Param('name') name?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.updateFeatureFlagStrategies(normalized, body ?? {});
  }

  @Post(':name/variants')
  @AuditLog({ action: 'update_feature_flag_variants', resource: 'feature_flag' })
  updateVariants(@Req() req?: AuthedRequest, @Param('name') name?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    return this.aiSubservice.updateFeatureFlagVariants(normalized, body ?? {});
  }
}

@Controller('api/v1/prompt-experiments')
@UseGuards(JwtAuthGuard)
export class PromptExperimentsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listExperiments(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listPromptExperiments();
  }

  @Post()
  @AuditLog({ action: 'create_prompt_experiment', resource: 'prompt_experiment' })
  createExperiment(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createPromptExperiment(body ?? {});
  }

  @Get(':flagName/report')
  getReport(@Req() req?: AuthedRequest, @Param('flagName') flagName?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(flagName ?? '').trim();
    if (!normalized) throw new BadRequestException('flagName is required');
    return this.aiSubservice.getPromptExperimentReport(normalized);
  }

  @Post(':flagName/promote')
  @AuditLog({ action: 'promote_prompt_experiment', resource: 'prompt_experiment' })
  promote(@Req() req?: AuthedRequest, @Param('flagName') flagName?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(flagName ?? '').trim();
    if (!normalized) throw new BadRequestException('flagName is required');
    return this.aiSubservice.promotePromptExperiment(normalized, body ?? {});
  }

  @Post(':flagName/stop')
  @AuditLog({ action: 'stop_prompt_experiment', resource: 'prompt_experiment' })
  stop(@Req() req?: AuthedRequest, @Param('flagName') flagName?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(flagName ?? '').trim();
    if (!normalized) throw new BadRequestException('flagName is required');
    return this.aiSubservice.stopPromptExperiment(normalized);
  }
}

@Controller('api/v1/ai/experiments')
@UseGuards(JwtAuthGuard)
export class AiExperimentsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get()
  listExperiments(@Req() req?: AuthedRequest) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.listExperiments();
  }

  @Post()
  @AuditLog({ action: 'create_experiment', resource: 'experiment' })
  createExperiment(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.createExperiment(body ?? {});
  }

  @Get('compare')
  compareExperiments(@Req() req?: AuthedRequest, @Query('a') a?: string, @Query('b') b?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const left = String(a ?? '').trim();
    const right = String(b ?? '').trim();
    if (!left || !right) {
      throw new BadRequestException('Both a and b query parameters are required');
    }
    return this.aiSubservice.compareExperiments(left, right);
  }

  @Get(':experimentId')
  getExperiment(@Req() req?: AuthedRequest, @Param('experimentId') experimentId?: string) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(experimentId ?? '').trim();
    if (!normalized) throw new BadRequestException('experimentId is required');
    return this.aiSubservice.getExperiment(normalized);
  }

  @Post(':experimentId/run')
  @AuditLog({ action: 'run_experiment', resource: 'experiment' })
  runExperiment(
    @Req() req?: AuthedRequest,
    @Param('experimentId') experimentId?: string,
    @Body() body?: { concurrency?: number },
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(experimentId ?? '').trim();
    if (!normalized) throw new BadRequestException('experimentId is required');
    return this.aiSubservice.runExperiment(normalized, {
      concurrency: typeof body?.concurrency === 'number' ? body.concurrency : undefined,
    });
  }
}

@Controller('api/v1/ai/prompts')
@UseGuards(JwtAuthGuard)
export class AiPromptsController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get(':name/diff')
  diffPromptVersions(
    @Req() req?: AuthedRequest,
    @Param('name') name?: string,
    @Query('version_a') versionA?: string,
    @Query('version_b') versionB?: string,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const promptName = String(name ?? '').trim();
    if (!promptName) {
      throw new BadRequestException('name is required');
    }
    return this.aiSubservice.diffPromptVersions(promptName, {
      version_a: versionA ? String(versionA).trim() : undefined,
      version_b: versionB ? String(versionB).trim() : undefined,
    });
  }
}

@Controller('api/v1/ai/rag')
@UseGuards(JwtAuthGuard)
export class AiRagController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Post('testsets/generate')
  @AuditLog({ action: 'generate_rag_testset', resource: 'rag_testset' })
  generateTestset(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    return this.aiSubservice.generateRagTestset(body ?? {});
  }
}
