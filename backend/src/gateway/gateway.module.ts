import { Module } from '@nestjs/common';
import { LobsterGateway } from './lobster.gateway';
import { FleetWebSocketGateway } from './fleet-websocket.gateway';
import { ActivationCodeService } from './activation-code.service';
import { LeadModule } from '../lead/lead.module';
import { ActivationCodeController } from './activation-code.controller';
import { TerminalGateway } from '../terminal/terminal.gateway';
import { TerminalSessionRegistry } from '../terminal/terminal-session.registry';
import { SecurityAuditRepository } from '../security-audit/security-audit.repository';

@Module({
  imports: [LeadModule],
  controllers: [ActivationCodeController],
  providers: [ActivationCodeService, LobsterGateway, FleetWebSocketGateway, TerminalGateway, TerminalSessionRegistry, SecurityAuditRepository],
  exports: [LobsterGateway, FleetWebSocketGateway, TerminalSessionRegistry, SecurityAuditRepository],
})
export class GatewayModule {}
