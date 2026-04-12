import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT ?? 38789;
  await app.listen(port);
  console.log(`C&C backend listening on http://localhost:${port}`);
  console.log(`WebSocket 龙虾网关: ws://localhost:${port}/lobster (激活码鉴权)`);
}
bootstrap();
