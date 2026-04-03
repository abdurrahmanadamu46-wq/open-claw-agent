import { NestFactory } from '@nestjs/core';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getNumberEnv, validateBackendStartupEnv } from './config/env';
import { HttpTraceMiddleware } from './common/http-trace.middleware';
import { HttpTraceInterceptor } from './common/http-trace.interceptor';
import { LeadService } from './lead/lead.service';

async function maybeSeedFleetNode(
  app: Awaited<ReturnType<typeof NestFactory.create>>,
  tenantId: string | undefined,
) {
  if (process.env.E2E_SEED_FLEET_NODE !== 'true' || !tenantId?.trim()) return;
  const redisService = app.get(RedisService, { strict: false });
  if (!redisService) return;
  const redis = redisService.getOrThrow();
  const nodeKey = 'fleet:node:node-e2e-seed-001';
  await redis.hset(nodeKey, {
    tenant_id: tenantId,
    client_id: tenantId,
    client_name: 'E2E 种子节点',
    status: 'ONLINE',
    last_seen: String(Date.now()),
    cpu_percent: '18',
    memory_percent: '41',
    platforms: 'wechat,douyin',
    current_account_summary: 'E2E regression seed',
  });
}

async function maybeSeedLead(
  app: Awaited<ReturnType<typeof NestFactory.create>>,
  tenantId: string | undefined,
) {
  if (process.env.E2E_SEED_FLEET_NODE !== 'true' || !tenantId?.trim()) return;
  const leadService = app.get(LeadService, { strict: false });
  if (!leadService) return;
  await leadService.seedDemoLead({
    tenant_id: tenantId.trim(),
    campaign_id: 'CAMP_E2E_SEED',
    contact_info: '13800138000',
    intention_score: 92,
    source_platform: 'douyin',
    user_message: '我想了解一下价格和活动',
    webhook_status: 'PENDING',
  });
}

async function bootstrap() {
  validateBackendStartupEnv();
  const app = await NestFactory.create(AppModule);
  const traceMiddleware = new HttpTraceMiddleware();
  app.use(traceMiddleware.use.bind(traceMiddleware));
  app.useGlobalInterceptors(new HttpTraceInterceptor());
  app.enableCors({ origin: true, credentials: true });
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ClawCommerce Backend')
    .setDescription('AI subservice and control-plane OpenAPI schema')
    .setVersion('1.0.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);
  const adapter = app.getHttpAdapter();
  adapter.get('/api-json', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json(swaggerDocument);
  });

  const port = getNumberEnv('PORT', 38789);
  await maybeSeedFleetNode(app, process.env.E2E_SEED_TENANT_ID);
  await maybeSeedLead(app, process.env.E2E_SEED_TENANT_ID);

  await app.listen(port);
  console.log(`C&C backend listening on http://localhost:${port}`);
  console.log(`WebSocket 龙虾网关: ws://localhost:${port}/lobster (激活码鉴权)`);
}

bootstrap();
