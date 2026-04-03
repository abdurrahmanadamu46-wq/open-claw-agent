import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

process.env.JWT_SECRET = process.env.JWT_SECRET?.trim() || 'openapi_generation_secret_123456';
process.env.REDIS_HOST = process.env.REDIS_HOST?.trim() || '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT?.trim() || '6379';

async function generateOpenApi() {
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('ClawCommerce Backend')
    .setDescription('OpenAPI schema for ai-subservice and control-plane routes')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const outputPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI schema generated: ${outputPath}`);
  process.exit(0);
}

generateOpenApi().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
