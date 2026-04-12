import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { AiSubserviceService } from './ai-subservice.service';

type AuthedRequest = {
  headers?: {
    authorization?: string;
  };
  user?: {
    roles?: string[];
    isAdmin?: boolean;
  };
};

function isAdmin(req?: AuthedRequest): boolean {
  if (req?.user?.isAdmin) return true;
  const roles = req?.user?.roles ?? [];
  return roles.map((item) => String(item).toLowerCase()).includes('admin');
}

@Controller('api/v1/voice')
@UseGuards(JwtAuthGuard)
export class VoiceController {
  constructor(private readonly aiSubservice: AiSubserviceService) {}

  @Get('health')
  getVoiceHealth(@Req() req?: AuthedRequest) {
    return this.aiSubservice.getVoiceHealth(req?.headers?.authorization);
  }

  @Get('profiles')
  listVoiceProfiles(
    @Req() req?: AuthedRequest,
    @Query('status') status?: string,
    @Query('owner_type') ownerType?: string,
    @Query('clone_enabled') cloneEnabled?: string,
  ) {
    return this.aiSubservice.listVoiceProfiles(
      {
        status: status ? String(status).trim() : undefined,
        owner_type: ownerType ? String(ownerType).trim() : undefined,
        clone_enabled: typeof cloneEnabled === 'string' ? ['1', 'true', 'yes', 'on'].includes(cloneEnabled.trim().toLowerCase()) : undefined,
      },
      req?.headers?.authorization,
    );
  }

  @Post('profiles')
  @AuditLog({ action: 'create_voice_profile', resource: 'voice_profile' })
  createVoiceProfile(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    return this.aiSubservice.createVoiceProfile(body ?? {}, req?.headers?.authorization);
  }

  @Get('profiles/:profileId')
  getVoiceProfile(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string) {
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    return this.aiSubservice.getVoiceProfile(normalized, req?.headers?.authorization);
  }

  @Post('profiles/:profileId/disable')
  @AuditLog({ action: 'disable_voice_profile', resource: 'voice_profile' })
  disableVoiceProfile(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string) {
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    return this.aiSubservice.disableVoiceProfile(normalized, req?.headers?.authorization);
  }

  @Post('profiles/:profileId/approve')
  @AuditLog({ action: 'approve_voice_profile', resource: 'voice_profile' })
  approveVoiceProfile(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    return this.aiSubservice.approveVoiceProfile(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Post('profiles/:profileId/reject')
  @AuditLog({ action: 'reject_voice_profile', resource: 'voice_profile' })
  rejectVoiceProfile(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    return this.aiSubservice.rejectVoiceProfile(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Post('profiles/:profileId/revoke')
  @AuditLog({ action: 'revoke_voice_profile', resource: 'voice_profile' })
  revokeVoiceProfile(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    return this.aiSubservice.revokeVoiceProfile(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Patch('profiles/:profileId/status')
  @AuditLog({ action: 'patch_voice_profile_status', resource: 'voice_profile' })
  patchVoiceProfileStatus(@Req() req?: AuthedRequest, @Param('profileId') profileId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(profileId ?? '').trim();
    if (!normalized) throw new BadRequestException('profileId is required');
    const status = String(body?.status ?? '').trim();
    if (!status) throw new BadRequestException('status is required');
    return this.aiSubservice.patchVoiceProfileStatus(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Get('consents')
  listVoiceConsents(
    @Req() req?: AuthedRequest,
    @Query('status') status?: string,
    @Query('owner_type') ownerType?: string,
  ) {
    return this.aiSubservice.listVoiceConsents(
      {
        status: status ? String(status).trim() : undefined,
        owner_type: ownerType ? String(ownerType).trim() : undefined,
      },
      req?.headers?.authorization,
    );
  }

  @Post('consents')
  @AuditLog({ action: 'create_voice_consent', resource: 'voice_consent' })
  createVoiceConsent(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    return this.aiSubservice.createVoiceConsent(body ?? {}, req?.headers?.authorization);
  }

  @Get('consents/:consentId')
  getVoiceConsent(@Req() req?: AuthedRequest, @Param('consentId') consentId?: string) {
    const normalized = String(consentId ?? '').trim();
    if (!normalized) throw new BadRequestException('consentId is required');
    return this.aiSubservice.getVoiceConsent(normalized, req?.headers?.authorization);
  }

  @Post('consents/:consentId/approve')
  @AuditLog({ action: 'approve_voice_consent', resource: 'voice_consent' })
  approveVoiceConsent(@Req() req?: AuthedRequest, @Param('consentId') consentId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(consentId ?? '').trim();
    if (!normalized) throw new BadRequestException('consentId is required');
    return this.aiSubservice.approveVoiceConsent(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Post('consents/:consentId/reject')
  @AuditLog({ action: 'reject_voice_consent', resource: 'voice_consent' })
  rejectVoiceConsent(@Req() req?: AuthedRequest, @Param('consentId') consentId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(consentId ?? '').trim();
    if (!normalized) throw new BadRequestException('consentId is required');
    return this.aiSubservice.rejectVoiceConsent(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Post('consents/:consentId/revoke')
  @AuditLog({ action: 'revoke_voice_consent', resource: 'voice_consent' })
  revokeVoiceConsent(@Req() req?: AuthedRequest, @Param('consentId') consentId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(consentId ?? '').trim();
    if (!normalized) throw new BadRequestException('consentId is required');
    return this.aiSubservice.revokeVoiceConsent(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Patch('consents/:consentId/status')
  @AuditLog({ action: 'patch_voice_consent_status', resource: 'voice_consent' })
  patchVoiceConsentStatus(@Req() req?: AuthedRequest, @Param('consentId') consentId?: string, @Body() body?: Record<string, unknown>) {
    if (!isAdmin(req)) throw new ForbiddenException('Admin role required');
    const normalized = String(consentId ?? '').trim();
    if (!normalized) throw new BadRequestException('consentId is required');
    const status = String(body?.status ?? '').trim();
    if (!status) throw new BadRequestException('status is required');
    return this.aiSubservice.patchVoiceConsentStatus(normalized, body ?? {}, req?.headers?.authorization);
  }

  @Post('synthesize')
  @AuditLog({ action: 'synthesize_voice', resource: 'voice_job' })
  synthesizeVoice(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    const text = String(body?.text ?? '').trim();
    if (!text) throw new BadRequestException('text is required');
    return this.aiSubservice.synthesizeVoice(body ?? {}, req?.headers?.authorization);
  }

  @Get('jobs')
  listVoiceJobs(
    @Req() req?: AuthedRequest,
    @Query('run_id') runId?: string,
    @Query('lobster_id') lobsterId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit ?? 50);
    return this.aiSubservice.listVoiceJobs(
      {
        run_id: runId ? String(runId).trim() : undefined,
        lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
        status: status ? String(status).trim() : undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      },
      req?.headers?.authorization,
    );
  }

  @Get('jobs/:jobId')
  getVoiceJob(@Req() req?: AuthedRequest, @Param('jobId') jobId?: string) {
    const normalized = String(jobId ?? '').trim();
    if (!normalized) throw new BadRequestException('jobId is required');
    return this.aiSubservice.getVoiceJob(normalized, req?.headers?.authorization);
  }

  @Get('artifacts')
  listVoiceArtifacts(
    @Req() req?: AuthedRequest,
    @Query('run_id') runId?: string,
    @Query('lobster_id') lobsterId?: string,
    @Query('artifact_type') artifactType?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit ?? 100);
    return this.aiSubservice.listVoiceArtifacts(
      {
        run_id: runId ? String(runId).trim() : undefined,
        lobster_id: lobsterId ? String(lobsterId).trim() : undefined,
        artifact_type: artifactType ? String(artifactType).trim() : undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
      },
      req?.headers?.authorization,
    );
  }
}
