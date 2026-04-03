import { Injectable } from '@nestjs/common';
import {
  AUTOPILOT_QUEUES,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from './autopilot.constants';
import { AutopilotAlertGateway } from './autopilot-alert.gateway';

type QueueName = (typeof AUTOPILOT_QUEUES)[number];

/**
 * 熔断与防暴走 — 连续失败计数 + 熔断状态
 * 任一队列连续失败 >= 3 次即触发熔断，并通过 WebSocket 告警
 */
@Injectable()
export class AutopilotCircuitService {
  private readonly consecutiveFailures = new Map<QueueName, number>();
  private circuitOpen = false;

  constructor(private readonly alertGateway: AutopilotAlertGateway) {}

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /** 任务成功时重置该队列的连续失败计数 */
  recordSuccess(queueName: QueueName): void {
    this.consecutiveFailures.set(queueName, 0);
  }

  /**
   * 任务失败时累加；若达到阈值则熔断并推送告警
   * @returns true 表示已熔断，调用方应不再入队
   */
  recordFailure(queueName: QueueName): boolean {
    const prev = this.consecutiveFailures.get(queueName) ?? 0;
    const next = prev + 1;
    this.consecutiveFailures.set(queueName, next);

    if (next >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.circuitOpen = true;
      this.alertGateway.emitAutopilotAlert(
        '🔴 Autopilot 暂停：请检查大模型 API Key 余额或节点掉线情况。',
        { queueName, consecutiveFailures: next },
      );
      return true;
    }
    return false;
  }

  /** 人工恢复时调用 */
  resetCircuit(): void {
    this.circuitOpen = false;
    this.consecutiveFailures.clear();
  }
}
