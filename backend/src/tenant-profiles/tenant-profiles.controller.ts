import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { RagBrainProfilesService } from './rag-brain-profiles.service';
import { EdgePersonaMasksService } from './edge-persona-masks.service';
import type {
  EdgePersonaMasksPatch,
  RagBrainProfilesPatch,
  TenantRegistryPatch,
  TenantRegistryRecord,
} from './tenant-profiles.types';
import {
  RagCompetitiveIntelService,
  type CompetitiveIntelAnalyzeRequest,
} from './rag-competitive-intel.service';
import { TenantRegistryService } from './tenant-registry.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
    isAdmin?: boolean;
  };
};

@Controller('api/v1/tenant')
@UseGuards(JwtAuthGuard)
export class TenantProfilesController {
  constructor(
    private readonly ragBrainProfilesService: RagBrainProfilesService,
    private readonly edgePersonaMasksService: EdgePersonaMasksService,
    private readonly ragCompetitiveIntelService: RagCompetitiveIntelService,
    private readonly tenantRegistryService: TenantRegistryService,
  ) {}

  private requireTenantScope(req?: AuthedRequest): string {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    return tenantScope;
  }

  private assertTenantScope(tenantScope: string, targetTenantId?: string): string {
    const normalizedTarget = targetTenantId?.trim();
    if (!normalizedTarget) return tenantScope;
    if (normalizedTarget !== tenantScope) {
      throw new BadRequestException('tenantId must match tenant scope');
    }
    return normalizedTarget;
  }

  private ensureAdmin(req?: AuthedRequest): void {
    if (!req?.user?.isAdmin) {
      throw new ForbiddenException('Admin role is required');
    }
  }

  private applyTenantPatchPolicy(
    req: AuthedRequest | undefined,
    tenantId: string,
    patch: TenantRegistryPatch,
  ): TenantRegistryPatch {
    const tenantScope = this.requireTenantScope(req);
    const isAdmin = req?.user?.isAdmin === true;
    if (!isAdmin && tenantId !== tenantScope) {
      throw new ForbiddenException('tenant scope mismatch');
    }

    if (isAdmin) return patch;

    const allowed: TenantRegistryPatch = {};
    const allowedKeys: Array<keyof TenantRegistryPatch> = [
      'industryType',
      'industryCategoryTag',
      'businessKeywords',
      'leadScoringWords',
      'nodeWorkflowProgress',
      'name',
    ];
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        Object.assign(allowed, { [key]: patch[key] });
      }
    }
    return allowed;
  }

  @Get('registry')
  async listTenantRegistry(
    @Req() req: AuthedRequest,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const tenantScope = this.requireTenantScope(req);
    const isAdmin = req?.user?.isAdmin === true;
    const includeInactiveFlag = includeInactive === 'true';
    const items = await this.tenantRegistryService.listTenants({
      includeInactive: includeInactiveFlag,
      tenantScope,
      adminView: isAdmin,
    });
    return { code: 0, data: { items } };
  }

  @Post('registry')
  @UseGuards(AdminRoleGuard)
  async createTenantRegistry(
    @Body() body: (Partial<TenantRegistryRecord> & { id?: string }) | undefined,
  ) {
    const item = await this.tenantRegistryService.createTenant({
      id: body?.id,
      name: body?.name,
      quota: body?.quota,
      inactive: body?.inactive,
      industryType: body?.industryType,
      industryCategoryTag: body?.industryCategoryTag,
      businessKeywords: body?.businessKeywords,
      leadScoringWords: body?.leadScoringWords,
      nodeWorkflowProgress: body?.nodeWorkflowProgress,
      deploymentRegion: body?.deploymentRegion,
      storageRegion: body?.storageRegion,
      dataResidency: body?.dataResidency,
      icpFilingStatus: body?.icpFilingStatus,
    });
    return { code: 0, data: item };
  }

  @Patch('registry/:tenantId')
  async updateTenantRegistry(
    @Req() req: AuthedRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: TenantRegistryPatch | undefined,
  ) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) {
      throw new BadRequestException('tenantId is required');
    }
    const patch = this.applyTenantPatchPolicy(req, normalizedTenantId, body ?? {});
    const item = await this.tenantRegistryService.updateTenant(normalizedTenantId, patch);
    return { code: 0, data: item };
  }

  @Delete('registry/:tenantId')
  async archiveTenantRegistry(@Req() req: AuthedRequest, @Param('tenantId') tenantId: string) {
    this.ensureAdmin(req);
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) {
      throw new BadRequestException('tenantId is required');
    }
    const item = await this.tenantRegistryService.archiveTenant(normalizedTenantId);
    return { code: 0, data: item };
  }

  @Get('rag-brain-profiles')
  async getRagBrainProfiles(@Req() req: AuthedRequest) {
    const tenantId = this.requireTenantScope(req);
    const data = await this.ragBrainProfilesService.getProfiles(tenantId);
    return { code: 0, data };
  }

  @Patch('rag-brain-profiles')
  @UseGuards(AdminRoleGuard)
  async updateRagBrainProfiles(
    @Req() req: AuthedRequest,
    @Body() body: (RagBrainProfilesPatch & { tenantId?: string }) | undefined,
  ) {
    const tenantScope = this.requireTenantScope(req);
    const tenantId = this.assertTenantScope(tenantScope, body?.tenantId);
    const { tenantId: _ignored, ...patch } = body ?? {};
    const data = await this.ragBrainProfilesService.updateProfiles(tenantId, patch);
    return { code: 0, data };
  }

  @Get('rag-brain-profiles/competitive-intel')
  async getCompetitiveFormulaLibrary(
    @Req() req: AuthedRequest,
    @Query('category') category?: string,
    @Query('platform') platform?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = this.requireTenantScope(req);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const data = await this.ragBrainProfilesService.getCompetitiveFormulaLibrary(tenantId, {
      category,
      platform,
      tag,
      limit: parsedLimit,
    });
    return { code: 0, data };
  }

  @Post('rag-brain-profiles/competitive-intel/analyze')
  @UseGuards(AdminRoleGuard)
  async analyzeAndStoreCompetitiveIntel(
    @Req() req: AuthedRequest,
    @Body()
    body:
      | (CompetitiveIntelAnalyzeRequest & {
          tenantId?: string;
          upsertAsCorpus?: boolean;
          targetAgents?: string[];
          maxFormulaLibrary?: number;
        })
      | undefined,
  ) {
    const tenantScope = this.requireTenantScope(req);
    const tenantId = this.assertTenantScope(tenantScope, body?.tenantId);
    if (!body?.source?.platform) {
      throw new BadRequestException('source.platform is required');
    }
    if (!body?.sample || (!body.sample.title && !body.sample.hook && !body.sample.transcript)) {
      throw new BadRequestException('sample.title/sample.hook/sample.transcript is required');
    }

    const analysis = this.ragCompetitiveIntelService.analyze({
      source: body.source,
      classification: body.classification,
      sample: body.sample,
    });

    const stored = await this.ragBrainProfilesService.appendCompetitiveFormula(tenantId, analysis.formula, {
      upsertAsCorpus: body.upsertAsCorpus ?? true,
      targetAgents: body.targetAgents ?? analysis.recommendedAgentIds,
      maxFormulaLibrary: body.maxFormulaLibrary,
    });

    return {
      code: 0,
      data: {
        inserted: stored.inserted,
        corpusId: stored.corpusId,
        formula: stored.formula,
        profileUpdatedAt: stored.document.updatedAt,
      },
    };
  }

  @Get('edge-persona-masks')
  async getEdgePersonaMasks(@Req() req: AuthedRequest) {
    const tenantId = this.requireTenantScope(req);
    const data = await this.edgePersonaMasksService.getMasks(tenantId);
    return { code: 0, data };
  }

  @Patch('edge-persona-masks')
  @UseGuards(AdminRoleGuard)
  async updateEdgePersonaMasks(
    @Req() req: AuthedRequest,
    @Body() body: (EdgePersonaMasksPatch & { tenantId?: string }) | undefined,
  ) {
    const tenantScope = this.requireTenantScope(req);
    const tenantId = this.assertTenantScope(tenantScope, body?.tenantId);
    const { tenantId: _ignored, ...patch } = body ?? {};
    const data = await this.edgePersonaMasksService.updateMasks(tenantId, patch);
    return { code: 0, data };
  }
}
