"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CIRCUIT_BREAKER_FAILURE_THRESHOLD = exports.DAILY_CONTENT_GENERATION_LIMIT = exports.AUTOPILOT_QUEUES = exports.LEAD_HARVEST_QUEUE = exports.MATRIX_DISPATCH_QUEUE = exports.CONTENT_FORGE_QUEUE = exports.RADAR_SNIFFING_QUEUE = void 0;
exports.RADAR_SNIFFING_QUEUE = 'radar_sniffing_queue';
exports.CONTENT_FORGE_QUEUE = 'content_forge_queue';
exports.MATRIX_DISPATCH_QUEUE = 'matrix_dispatch_queue';
exports.LEAD_HARVEST_QUEUE = 'lead_harvest_queue';
exports.AUTOPILOT_QUEUES = [
    exports.RADAR_SNIFFING_QUEUE,
    exports.CONTENT_FORGE_QUEUE,
    exports.MATRIX_DISPATCH_QUEUE,
    exports.LEAD_HARVEST_QUEUE,
];
exports.DAILY_CONTENT_GENERATION_LIMIT = 50;
exports.CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
//# sourceMappingURL=autopilot.constants.js.map