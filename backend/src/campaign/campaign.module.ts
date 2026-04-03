import { Module } from '@nestjs/common';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

@Module({
  controllers: [CampaignController],
  providers: [CampaignService, JwtAuthGuard, AdminRoleGuard],
})
export class CampaignModule {}

