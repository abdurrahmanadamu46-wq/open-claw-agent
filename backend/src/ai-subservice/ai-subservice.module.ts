import { Module } from '@nestjs/common';
import { AiSubserviceController } from './ai-subservice.controller';
import { AiSubserviceService } from './ai-subservice.service';
import { AnalyticsController } from './analytics.controller';
import { SurveysController } from './surveys.controller';
import { McpController } from './mcp.controller';
import { EdgeGroupsController, LobsterMetricsHistoryController, LobsterTriggerRulesController } from './openremote.controller';
import { FleetModule } from '../fleet/fleet.module';
import { FeatureFlagsController, PromptExperimentsController, AiExperimentsController, AiPromptsController, AiRagController } from './feature-flags.controller';
import { RbacController } from './rbac.controller';
import { AuditEventsController } from './audit-events.controller';
import { WhiteLabelController } from './white-label.controller';
import { SearchController } from './search.controller';
import { LobsterConfigController } from './lobster-config.controller';
import { LobstersController } from './lobsters.controller';
import { FeedbackController } from './feedback.controller';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { WidgetController } from './widget.controller';
import { WorkflowsController } from './workflows.controller';
import { WorkflowTemplatesController } from './workflow-templates.controller';
import { ConcurrencyController } from './concurrency.controller';
import { ObservabilityController } from './observability.controller';
import { AlertsController } from './alerts.controller';
import { SeatBillingController } from './seat-billing.controller';
import { PartnerController } from './partner.controller';
import { AdminCrudController } from './admin-crud.controller';
import { LeadsController } from './leads.controller';
import { ActivitiesController } from './activities.controller';
import { TasksController } from './tasks.controller';
import { CostController } from './cost.controller';
import { PoliciesController } from './policies.controller';
import { GraphController } from './graph.controller';
import { MobileController } from './mobile.controller';
import { PromptsController } from './prompts.controller';
import { ModulesController } from './modules.controller';
import { FilesController } from './files.controller';
import { MindMapController } from './mind-map.controller';

@Module({
  imports: [FleetModule],
  controllers: [
    AnalyticsController,
    SurveysController,
    AiSubserviceController,
    McpController,
    EdgeGroupsController,
    LobsterTriggerRulesController,
    LobsterMetricsHistoryController,
    FeatureFlagsController,
    PromptExperimentsController,
    AiExperimentsController,
    AiPromptsController,
    AiRagController,
    RbacController,
    AuditEventsController,
    WhiteLabelController,
    SearchController,
    LobsterConfigController,
    LobstersController,
    FeedbackController,
    KnowledgeBaseController,
    SeatBillingController,
    PartnerController,
    AdminCrudController,
    LeadsController,
    ActivitiesController,
    TasksController,
    CostController,
    PoliciesController,
    GraphController,
    MobileController,
    PromptsController,
    ModulesController,
    FilesController,
    MindMapController,
    WorkflowsController,
    WorkflowTemplatesController,
    ConcurrencyController,
    ObservabilityController,
    AlertsController,
    WidgetController,
  ],
  providers: [AiSubserviceService],
  exports: [AiSubserviceService],
})
export class AiSubserviceModule {}
