"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var LeadHarvestWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadHarvestWorker = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const autopilot_constants_1 = require("../autopilot.constants");
const autopilot_circuit_service_1 = require("../autopilot-circuit.service");
let LeadHarvestWorker = LeadHarvestWorker_1 = class LeadHarvestWorker extends bullmq_1.WorkerHost {
    constructor(circuit) {
        super();
        this.circuit = circuit;
        this.logger = new common_1.Logger(LeadHarvestWorker_1.name);
    }
    async process(job) {
        const { tenantId, campaignId, publishedAt, jobId } = job.data;
        this.logger.log(`[LeadHarvest] Processing job ${job.id} tenant=${tenantId} campaign=${campaignId}`);
        try {
            await this.harvestLeads(tenantId, campaignId, publishedAt);
            this.circuit.recordSuccess(autopilot_constants_1.LEAD_HARVEST_QUEUE);
            this.logger.log(`[LeadHarvest] Job ${job.id} done`);
        }
        catch (err) {
            this.logger.warn(`[LeadHarvest] Job ${job.id} failed`, err);
            this.circuit.recordFailure(autopilot_constants_1.LEAD_HARVEST_QUEUE);
            throw err;
        }
    }
    async harvestLeads(tenantId, campaignId, publishedAt) {
        await new Promise((r) => setTimeout(r, 200));
        this.logger.log(`[LeadHarvest] Harvested campaign ${campaignId} at ${publishedAt}`);
    }
};
exports.LeadHarvestWorker = LeadHarvestWorker;
exports.LeadHarvestWorker = LeadHarvestWorker = LeadHarvestWorker_1 = __decorate([
    (0, bullmq_1.Processor)(autopilot_constants_1.LEAD_HARVEST_QUEUE),
    __metadata("design:paramtypes", [autopilot_circuit_service_1.AutopilotCircuitService])
], LeadHarvestWorker);
//# sourceMappingURL=lead-harvest.worker.js.map