import { Module } from '@nestjs/common';
import { AiSubserviceModule } from '../ai-subservice/ai-subservice.module';
import { TenantProfilesModule } from '../tenant-profiles/tenant-profiles.module';
import { SessionAuthController } from './session-auth.controller';
import { SessionAuthService } from './session-auth.service';

@Module({
  imports: [AiSubserviceModule, TenantProfilesModule],
  controllers: [SessionAuthController],
  providers: [SessionAuthService],
})
export class SessionAuthModule {}
