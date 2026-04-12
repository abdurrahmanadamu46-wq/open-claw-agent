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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutopilotController = void 0;
const common_1 = require("@nestjs/common");
const autopilot_coordinator_service_1 = require("./autopilot-coordinator.service");
const autopilot_circuit_service_1 = require("./autopilot-circuit.service");
let AutopilotController = class AutopilotController {
    constructor(coordinator, circuit) {
        this.coordinator = coordinator;
        this.circuit = circuit;
    }
    status() {
        return { circuitOpen: this.circuit.isCircuitOpen() };
    }
    async triggerProbe(body) {
        const jobId = await this.coordinator.triggerProbe(body);
        return { jobId };
    }
    resetCircuit() {
        this.coordinator.resetCircuit();
        return { ok: true };
    }
};
exports.AutopilotController = AutopilotController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AutopilotController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('trigger-probe'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AutopilotController.prototype, "triggerProbe", null);
__decorate([
    (0, common_1.Post)('reset-circuit'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AutopilotController.prototype, "resetCircuit", null);
exports.AutopilotController = AutopilotController = __decorate([
    (0, common_1.Controller)('autopilot'),
    __metadata("design:paramtypes", [autopilot_coordinator_service_1.AutopilotCoordinatorService,
        autopilot_circuit_service_1.AutopilotCircuitService])
], AutopilotController);
//# sourceMappingURL=autopilot.controller.js.map