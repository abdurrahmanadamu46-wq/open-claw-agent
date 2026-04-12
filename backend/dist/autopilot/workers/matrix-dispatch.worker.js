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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var MatrixDispatchWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatrixDispatchWorker = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("@nestjs/bullmq");
const bullmq_3 = require("bullmq");
const common_1 = require("@nestjs/common");
const autopilot_constants_1 = require("../autopilot.constants");
const autopilot_circuit_service_1 = require("../autopilot-circuit.service");
let MatrixDispatchWorker = MatrixDispatchWorker_1 = class MatrixDispatchWorker extends bullmq_1.WorkerHost {
    constructor(leadHarvestQueue, circuit) {
        super();
        this.leadHarvestQueue = leadHarvestQueue;
        this.circuit = circuit;
        this.logger = new common_1.Logger(MatrixDispatchWorker_1.name);
    }
    async process(job) {
        const { tenantId, videoUrl, script, nodeIds, scheduledAt, jobId } = job.data;
        this.logger.log(`[MatrixDispatch] Processing job ${job.id} tenant=${tenantId} nodes=${nodeIds.length}`);
        try {
            await this.dispatchToNodes(nodeIds, { videoUrl, script, scheduledAt });
            this.circuit.recordSuccess(autopilot_constants_1.MATRIX_DISPATCH_QUEUE);
            const campaignId = `CAMP_${Date.now()}`;
            const nextPayload = {
                tenantId,
                campaignId,
                publishedAt: new Date().toISOString(),
                jobId,
            };
            await this.leadHarvestQueue.add('harvest', nextPayload, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
            });
            this.logger.log(`[MatrixDispatch] Job ${job.id} done, enqueued lead_harvest`);
            return nextPayload;
        }
        catch (err) {
            this.logger.warn(`[MatrixDispatch] Job ${job.id} failed`, err);
            this.circuit.recordFailure(autopilot_constants_1.MATRIX_DISPATCH_QUEUE);
            throw err;
        }
    }
    async dispatchToNodes(nodeIds, payload) {
        await new Promise((r) => setTimeout(r, 300));
        this.logger.log(`[MatrixDispatch] Dispatched to ${nodeIds.join(', ')}: ${payload.videoUrl}`);
    }
};
exports.MatrixDispatchWorker = MatrixDispatchWorker;
exports.MatrixDispatchWorker = MatrixDispatchWorker = MatrixDispatchWorker_1 = __decorate([
    (0, bullmq_1.Processor)(autopilot_constants_1.MATRIX_DISPATCH_QUEUE),
    __param(0, (0, bullmq_2.InjectQueue)(autopilot_constants_1.LEAD_HARVEST_QUEUE)),
    __metadata("design:paramtypes", [bullmq_3.Queue,
        autopilot_circuit_service_1.AutopilotCircuitService])
], MatrixDispatchWorker);
//# sourceMappingURL=matrix-dispatch.worker.js.map