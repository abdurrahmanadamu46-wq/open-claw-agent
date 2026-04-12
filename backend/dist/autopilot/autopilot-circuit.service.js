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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutopilotCircuitService = void 0;
const common_1 = require("@nestjs/common");
const autopilot_constants_1 = require("./autopilot.constants");
const autopilot_alert_gateway_1 = require("./autopilot-alert.gateway");
let AutopilotCircuitService = class AutopilotCircuitService {
    constructor(alertGateway) {
        this.alertGateway = alertGateway;
        this.consecutiveFailures = new Map();
        this.circuitOpen = false;
    }
    isCircuitOpen() {
        return this.circuitOpen;
    }
    recordSuccess(queueName) {
        this.consecutiveFailures.set(queueName, 0);
    }
    recordFailure(queueName) {
        const prev = this.consecutiveFailures.get(queueName) ?? 0;
        const next = prev + 1;
        this.consecutiveFailures.set(queueName, next);
        if (next >= autopilot_constants_1.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
            this.circuitOpen = true;
            this.alertGateway.emitAutopilotAlert('🔴 Autopilot 暂停：请检查大模型 API Key 余额或节点掉线情况。', { queueName, consecutiveFailures: next });
            return true;
        }
        return false;
    }
    resetCircuit() {
        this.circuitOpen = false;
        this.consecutiveFailures.clear();
    }
};
exports.AutopilotCircuitService = AutopilotCircuitService;
exports.AutopilotCircuitService = AutopilotCircuitService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [autopilot_alert_gateway_1.AutopilotAlertGateway])
], AutopilotCircuitService);
//# sourceMappingURL=autopilot-circuit.service.js.map