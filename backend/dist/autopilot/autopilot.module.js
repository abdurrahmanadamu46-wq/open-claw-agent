"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutopilotModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const autopilot_constants_1 = require("./autopilot.constants");
const autopilot_coordinator_service_1 = require("./autopilot-coordinator.service");
const autopilot_circuit_service_1 = require("./autopilot-circuit.service");
const autopilot_alert_gateway_1 = require("./autopilot-alert.gateway");
const autopilot_controller_1 = require("./autopilot.controller");
const radar_sniffing_worker_1 = require("./workers/radar-sniffing.worker");
const content_forge_worker_1 = require("./workers/content-forge.worker");
const matrix_dispatch_worker_1 = require("./workers/matrix-dispatch.worker");
const lead_harvest_worker_1 = require("./workers/lead-harvest.worker");
const integrations_module_1 = require("../integrations/integrations.module");
let AutopilotModule = class AutopilotModule {
};
exports.AutopilotModule = AutopilotModule;
exports.AutopilotModule = AutopilotModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({ name: autopilot_constants_1.RADAR_SNIFFING_QUEUE }, { name: autopilot_constants_1.CONTENT_FORGE_QUEUE }, { name: autopilot_constants_1.MATRIX_DISPATCH_QUEUE }, { name: autopilot_constants_1.LEAD_HARVEST_QUEUE }),
            integrations_module_1.IntegrationsModule,
        ],
        controllers: [autopilot_controller_1.AutopilotController],
        providers: [
            autopilot_coordinator_service_1.AutopilotCoordinatorService,
            autopilot_circuit_service_1.AutopilotCircuitService,
            autopilot_alert_gateway_1.AutopilotAlertGateway,
            radar_sniffing_worker_1.RadarSniffingWorker,
            content_forge_worker_1.ContentForgeWorker,
            matrix_dispatch_worker_1.MatrixDispatchWorker,
            lead_harvest_worker_1.LeadHarvestWorker,
        ],
        exports: [autopilot_coordinator_service_1.AutopilotCoordinatorService, autopilot_circuit_service_1.AutopilotCircuitService],
    })
], AutopilotModule);
//# sourceMappingURL=autopilot.module.js.map