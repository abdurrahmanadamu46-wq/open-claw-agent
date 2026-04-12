import { Module } from '@nestjs/common';
import { DeviceAuthController } from './device-auth.controller';
import { DeviceAuthService } from './device-auth.service';
import { DeviceService } from '../device/device.service';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  controllers: [DeviceAuthController],
  providers: [
    DeviceAuthService,
    DeviceService,
    AgentCCGateway,
    JwtAuthGuard,
  ],
  exports: [DeviceAuthService],
})
export class DeviceAuthModule {}
