import { Module } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
import { GatewayModule } from '../gateway/gateway.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

@Module({
  imports: [GatewayModule],
  controllers: [FleetController],
  providers: [FleetService, JwtAuthGuard, AdminRoleGuard],
  exports: [FleetService],
})
export class FleetModule {}
