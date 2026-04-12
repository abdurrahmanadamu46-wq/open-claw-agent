import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { McpClientService } from './mcp-client.service';

@Module({
  imports: [GatewayModule],
  providers: [McpClientService],
  exports: [McpClientService],
})
export class McpModule {}
