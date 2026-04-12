import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  listVoiceProfiles(@Req() req?: AuthedRequest) {
    return this.aiSubservice.listVoiceProfiles(req?.headers?.authorization);
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

  @Get('consents')
  listVoiceConsents(@Req() req?: AuthedRequest) {
    return this.aiSubservice.listVoiceConsents(req?.headers?.authorization);
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

  @Post('synthesize')
  @AuditLog({ action: 'synthesize_voice', resource: 'voice_job' })
  synthesizeVoice(@Req() req?: AuthedRequest, @Body() body?: Record<string, unknown>) {
    const text = String(body?.text ?? '').trim();
    if (!text) throw new BadRequestException('text is required');
    return this.aiSubservice.synthesizeVoice(body ?? {}, req?.headers?.authorization);
  }
}
