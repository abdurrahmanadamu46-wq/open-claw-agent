import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  RADAR_SNIFFING_QUEUE,
  CONTENT_FORGE_QUEUE,
  MATRIX_DISPATCH_QUEUE,
  LEAD_HARVEST_QUEUE,
} from './autopilot.constants';
import { AutopilotCoordinatorService } from './autopilot-coordinator.service';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import { AutopilotAlertGateway } from './autopilot-alert.gateway';
import { AutopilotController } from './autopilot.controller';
import { RadarSniffingWorker } from './workers/radar-sniffing.worker';
import { ContentForgeWorker } from './workers/content-forge.worker';
import { MatrixDispatchWorker } from './workers/matrix-dispatch.worker';
import { LeadHarvestWorker } from './workers/lead-harvest.worker';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: RADAR_SNIFFING_QUEUE },
      { name: CONTENT_FORGE_QUEUE },
      { name: MATRIX_DISPATCH_QUEUE },
      { name: LEAD_HARVEST_QUEUE },
    ),
    IntegrationsModule,
  ],
  controllers: [AutopilotController],
  providers: [
    AutopilotCoordinatorService,
    AutopilotCircuitService,
    AutopilotAlertGateway,
    RadarSniffingWorker,
    ContentForgeWorker,
    MatrixDispatchWorker,
    LeadHarvestWorker,
  ],
  exports: [AutopilotCoordinatorService, AutopilotCircuitService],
})
export class AutopilotModule {}
