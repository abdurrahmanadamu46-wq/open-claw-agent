import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AgentCoordinatorService } from './agent-coordinator.service';

@Module({
  imports: [IntegrationsModule],
  providers: [AgentCoordinatorService],
  exports: [AgentCoordinatorService],
})
export class AgentCoordinatorModule {}
