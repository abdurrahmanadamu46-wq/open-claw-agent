import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module';
import { SecurityAuditController } from './security-audit.controller';
import { SecurityAuditRepository } from './security-audit.repository';

@Module({
  imports: [FleetModule],
  controllers: [SecurityAuditController],
  providers: [SecurityAuditRepository],
  exports: [SecurityAuditRepository],
})
export class SecurityAuditModule {}
