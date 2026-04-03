import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { GatewayModule } from './gateway/gateway.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AgentCoordinatorModule } from './agent-coordinator/agent-coordinator.module';
import { AutopilotModule } from './autopilot/autopilot.module';
import { FleetModule } from './fleet/fleet.module';
import { CampaignModule } from './campaign/campaign.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { VlmModule } from './vlm/vlm.module';
import { McpModule } from './mcp/mcp.module';
import { LlmModule } from './llm/llm.module';
import { BehaviorModule } from './behavior/behavior.module';
import { MemoryModule } from './memory/memory.module';
import { TenantProfilesModule } from './tenant-profiles/tenant-profiles.module';
import { getNumberEnv, getRequiredEnv } from './config/env';
import { SessionAuthModule } from './auth/session-auth.module';
import { LeadModule } from './lead/lead.module';
import { ClientUpdateModule } from './client-update/client-update.module';
import { AiSubserviceModule } from './ai-subservice/ai-subservice.module';
import { AotoCutModule } from './subprojects/aoto-cut.module';
import { RsaDecryptMiddleware } from './common/middleware/rsa-decrypt.middleware';
import { SecurityModule } from './common/security.module';
import { SecurityAuditModule } from './security-audit/security-audit.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: getNumberEnv('REDIS_PORT', 6379),
      },
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: getNumberEnv('REDIS_PORT', 6379),
      },
    }),
    JwtModule.register({
      global: true,
      secret: getRequiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '30d' },
    }),
    DeviceAuthModule,
    SessionAuthModule,
    GatewayModule,
    IntegrationsModule,
    AgentCoordinatorModule,
    AutopilotModule,
    FleetModule,
    CampaignModule,
    DashboardModule,
    VlmModule,
    McpModule,
    LlmModule,
    BehaviorModule,
    MemoryModule,
    TenantProfilesModule,
    LeadModule,
    ClientUpdateModule,
    AiSubserviceModule,
    AotoCutModule,
    SecurityModule,
    SecurityAuditModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RsaDecryptMiddleware)
      .forRoutes(
        { path: '*', method: RequestMethod.POST },
        { path: '*', method: RequestMethod.PUT },
        { path: '*', method: RequestMethod.PATCH },
      );
  }
}
