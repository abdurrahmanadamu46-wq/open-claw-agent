/**
 * 全自动无人值守引擎 — BullMQ 队列名与生命周期契约
 * 流转顺序：radar_sniffing -> content_forge -> matrix_dispatch -> lead_harvest
 */

export const RADAR_SNIFFING_QUEUE = 'radar_sniffing_queue';
export const CONTENT_FORGE_QUEUE = 'content_forge_queue';
export const MATRIX_DISPATCH_QUEUE = 'matrix_dispatch_queue';
export const LEAD_HARVEST_QUEUE = 'lead_harvest_queue';

export const AUTOPILOT_QUEUES = [
  RADAR_SNIFFING_QUEUE,
  CONTENT_FORGE_QUEUE,
  MATRIX_DISPATCH_QUEUE,
  LEAD_HARVEST_QUEUE,
] as const;

/** 每日内容生成上限（content_forge 熔断前检查） */
export const DAILY_CONTENT_GENERATION_LIMIT = 50;

/** 连续失败多少次触发熔断 */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
