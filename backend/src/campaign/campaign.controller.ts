import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { CampaignService } from './campaign.service';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/campaigns')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  async listCampaigns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{ code: number; data: { total: number; list: unknown[] } }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const parsedPage = page ? Number.parseInt(page, 10) : 1;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 10;
    if (!Number.isFinite(parsedPage) || parsedPage <= 0) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const result = await this.campaignService.list(tenantScope, {
      page: parsedPage,
      limit: parsedLimit,
      status: status?.trim() || undefined,
    });
    return { code: 0, data: result };
  }

  @Post()
  async createCampaign(
    @Body()
    body: {
      industry_template_id: string;
      target_urls: string[];
      publish_strategy?: { daily_limit?: number };
    },
    @Req() req?: AuthedRequest,
  ): Promise<{ code: number; data: { campaign_id: string; status: string } }> {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!body?.industry_template_id || !Array.isArray(body.target_urls)) {
      throw new BadRequestException('industry_template_id and target_urls are required');
    }
    const created = await this.campaignService.create(tenantScope, {
      industry_template_id: body.industry_template_id,
      target_urls: body.target_urls,
      publish_strategy: body.publish_strategy,
    });
    return { code: 0, data: created };
  }

  @Post(':campaignId/terminate')
  async terminateCampaign(
    @Param('campaignId') campaignId?: string,
    @Req() req?: AuthedRequest,
  ): Promise<{ code: number; data: { ok: boolean } }> {
    const tenantScope = req?.user?.tenantId?.trim();
    const normalized = campaignId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    if (!normalized) {
      throw new BadRequestException('campaignId is required');
    }
    const result = await this.campaignService.terminate(tenantScope, normalized);
    return { code: 0, data: result };
  }
}

