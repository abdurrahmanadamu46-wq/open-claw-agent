import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { ClientUpdateService } from './client-update.service';
import type { ClientReleaseRollout, ClientUpdateChannel } from './client-update.types';

type AuthedRequest = {
  user?: {
    tenantId?: string;
  };
};

@Controller('api/v1/client-updates')
export class ClientUpdateController {
  constructor(private readonly service: ClientUpdateService) {}

  @Get('latest')
  async latest(
    @Query('platform') platform?: string,
    @Query('channel') channel?: string,
    @Query('currentVersion') currentVersion?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const normalizedPlatform = platform?.trim();
    if (!normalizedPlatform) {
      throw new BadRequestException('platform is required');
    }
    const normalizedChannel = (channel?.trim().toLowerCase() || 'stable') as ClientUpdateChannel;
    if (!['stable', 'beta', 'canary'].includes(normalizedChannel)) {
      throw new BadRequestException('channel must be stable/beta/canary');
    }
    const result = await this.service.getLatest(normalizedPlatform, normalizedChannel, currentVersion, tenantId);
    return { code: 0, data: result };
  }

  @Post('release')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async publish(
    @Req() req?: AuthedRequest,
    @Body()
    body?: {
      platform: string;
      channel?: ClientUpdateChannel;
      version: string;
      downloadUrl: string;
      notes?: string;
      sha256: string;
      signature?: string;
      signatureAlgorithm?: 'RSA-SHA256';
      signatureKeyId?: string;
      minRequiredVersion?: string;
      rollout?: ClientReleaseRollout;
    },
  ) {
    if (!body?.platform || !body.version || !body.downloadUrl || !body.sha256) {
      throw new BadRequestException('platform, version, downloadUrl and sha256 are required');
    }
    const record = await this.service.publishRelease({
      platform: body.platform,
      channel: body.channel ?? 'stable',
      version: body.version,
      downloadUrl: body.downloadUrl,
      notes: body.notes,
      sha256: body.sha256,
      signature: body.signature,
      signatureAlgorithm: body.signatureAlgorithm,
      signatureKeyId: body.signatureKeyId,
      minRequiredVersion: body.minRequiredVersion,
      rollout: body.rollout,
      publishedBy: req?.user?.tenantId,
    });
    return { code: 0, data: record };
  }
}
