import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { GatewayModule } from './gateway/gateway.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AgentCoordinatorModule } from './agent-coordinator/agent-coordinator.module';
import { AutopilotModule } from './autopilot/autopilot.module';
import { VlmModule } from './vlm/vlm.module';
import { McpModule } from './mcp/mcp.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
      signOptions: { expiresIn: '30d' },
    }),
    DeviceAuthModule,
    GatewayModule,
    IntegrationsModule,
    AgentCoordinatorModule,
    AutopilotModule,
    VlmModule,
    McpModule,
    LlmModule,
  ],
})
export class AppModule {}
