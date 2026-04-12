import { Module } from '@nestjs/common';
import { LobsterGateway } from './lobster.gateway';
import { FleetWebSocketGateway } from './fleet-websocket.gateway';

@Module({
  providers: [LobsterGateway, FleetWebSocketGateway],
  exports: [LobsterGateway, FleetWebSocketGateway],
})
export class GatewayModule {}
