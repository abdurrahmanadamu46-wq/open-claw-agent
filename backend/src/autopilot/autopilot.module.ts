import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  RADAR_SNIFFING_QUEUE,
  CONTENT_FORGE_QUEUE,
  MATRIX_DISPATCH_QUEUE,
  LEAD_HARVEST_QUEUE,
  RADAR_SNIFFING_DLQ,
  CONTENT_FORGE_DLQ,
  MATRIX_DISPATCH_DLQ,
  LEAD_HARVEST_DLQ,
} from './autopilot.constants';
import { AutopilotCoordinatorService } from './autopilot-coordinator.service';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import { AutopilotAlertGateway } from './autopilot-alert.gateway';
import { AutopilotAlertService } from './autopilot-alert.service';
import { AutopilotAlertRouterService } from './autopilot-alert-router.service';
import { AutopilotController } from './autopilot.controller';
import { RadarSniffingWorker } from './workers/radar-sniffing.worker';
import { ContentForgeWorker } from './workers/content-forge.worker';
import { MatrixDispatchWorker } from './workers/matrix-dispatch.worker';
import { LeadHarvestWorker } from './workers/lead-harvest.worker';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AutopilotIdempotencyService } from './autopilot-idempotency.service';
import { AutopilotDlqService } from './autopilot-dlq.service';
import { AutopilotTaskStateService } from './autopilot-task-state.service';
import { AutopilotRecoveryScannerService } from './autopilot-recovery-scanner.service';
import { AutopilotTaskControlService } from './autopilot-task-control.service';
import { AutopilotTraceService } from './autopilot-trace.service';
import { AutopilotMetricsService } from './autopilot-metrics.service';
import { AutopilotLogAuditService } from './autopilot-log-audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { GatewayModule } from '../gateway/gateway.module';
import { BehaviorModule } from '../behavior/behavior.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: RADAR_SNIFFING_QUEUE },
      { name: CONTENT_FORGE_QUEUE },
      { name: MATRIX_DISPATCH_QUEUE },
      { name: LEAD_HARVEST_QUEUE },
      { name: RADAR_SNIFFING_DLQ },
      { name: CONTENT_FORGE_DLQ },
      { name: MATRIX_DISPATCH_DLQ },
      { name: LEAD_HARVEST_DLQ },
    ),
    IntegrationsModule,
    GatewayModule,
    BehaviorModule,
  ],
  controllers: [AutopilotController],
  providers: [
    AutopilotCoordinatorService,
    AutopilotCircuitService,
    AutopilotAlertGateway,
    AutopilotAlertService,
    AutopilotAlertRouterService,
    RadarSniffingWorker,
    ContentForgeWorker,
    MatrixDispatchWorker,
    LeadHarvestWorker,
    AutopilotIdempotencyService,
    AutopilotDlqService,
    AutopilotTaskStateService,
    AutopilotRecoveryScannerService,
    AutopilotTaskControlService,
    AutopilotTraceService,
    AutopilotMetricsService,
    AutopilotLogAuditService,
    JwtAuthGuard,
    AdminRoleGuard,
  ],
  exports: [AutopilotCoordinatorService, AutopilotCircuitService],
})
export class AutopilotModule {}
