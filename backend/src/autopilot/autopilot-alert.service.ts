import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { AutopilotMetricsService } from './autopilot-metrics.service';
import { AutopilotAlertGateway } from './autopilot-alert.gateway';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import { emitStructuredLog } from '../common/structured-log';
import { AutopilotAlertRouterService } from './autopilot-alert-router.service';

export type AutopilotAlertSeverity = 'P1' | 'P2' | 'P3';
export type AutopilotAlertState = 'fired' | 'ok';

export interface AutopilotAlertSignal {
  ruleKey: string;
  severity: AutopilotAlertSeverity;
  state: AutopilotAlertState;
  message: string;
  value: number;
  threshold: number;
  windowMinutes: number;
  sourceQueue?: string;
}

const ALERT_STATE_KEY_PREFIX = 'autopilot:alerts:state:';
const ALERT_SUPPRESS_KEY_PREFIX = 'autopilot:alerts:suppress:';

@Injectable()
export class AutopilotAlertService {
  private readonly logger = new Logger(AutopilotAlertService.name);

  constructor(
    private readonly metricsService: AutopilotMetricsService,
    private readonly alertGateway: AutopilotAlertGateway,
    private readonly redisService: RedisService,
    private readonly alertRouterService: AutopilotAlertRouterService,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private stateKey(tenantId: string, ruleKey: string, sourceQueue?: string): string {
    return `${ALERT_STATE_KEY_PREFIX}${tenantId}:${ruleKey}:${sourceQueue?.trim() || 'all'}`;
  }

  private suppressionKey(tenantId: string, signal: AutopilotAlertSignal): string {
    return `${ALERT_SUPPRESS_KEY_PREFIX}${tenantId}:${signal.severity}:${signal.ruleKey}:${signal.sourceQueue?.trim() || 'all'}`;
  }

  private getSuppressionSeconds(severity: AutopilotAlertSeverity): number {
    const bySeverity = process.env[`AUTOPILOT_ALERT_SUPPRESSION_SECONDS_${severity}`];
    const fallback = process.env.AUTOPILOT_ALERT_SUPPRESSION_SECONDS_DEFAULT ?? '300';
    const parsed = Number.parseInt(bySeverity ?? fallback, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
  }

  async evaluate(tenantId: string, query: {
    windowMinutes?: number;
    from?: Date;
    to?: Date;
    sourceQueue?: string;
    emit?: boolean;
  }): Promise<{
    tenantId: string;
    query: { windowMinutes: number; from?: string; to?: string; sourceQueue?: string };
    signals: AutopilotAlertSignal[];
  }> {
    const metrics = await this.metricsService.getDashboardMetrics(tenantId, {
      windowMinutes: query.windowMinutes,
      from: query.from,
      to: query.to,
      sourceQueue: query.sourceQueue,
    });

    const windowMinutes = metrics.windowMinutes;
    const signals: AutopilotAlertSignal[] = [];

    const queueFailThreshold = Number.parseInt(process.env.AUTOPILOT_ALERT_QUEUE_FAIL_THRESHOLD ?? '10', 10);
    const dlqGrowthThreshold = Number.parseInt(process.env.AUTOPILOT_ALERT_DLQ_GROWTH_THRESHOLD ?? '6', 10);
    const replayMinAttempts = Number.parseInt(process.env.AUTOPILOT_ALERT_REPLAY_MIN_ATTEMPTS ?? '3', 10);
    const replaySuccessRateThreshold = Number.parseFloat(process.env.AUTOPILOT_ALERT_REPLAY_SUCCESS_RATE_THRESHOLD ?? '0.8');

    signals.push({
      ruleKey: 'queue.process.fail.spike',
      severity: 'P1',
      state: metrics.totals.queueProcessFail >= queueFailThreshold ? 'fired' : 'ok',
      message:
        metrics.totals.queueProcessFail >= queueFailThreshold
          ? `queue.process.fail reached ${metrics.totals.queueProcessFail} in ${windowMinutes}m`
          : `queue.process.fail healthy (${metrics.totals.queueProcessFail}/${queueFailThreshold})`,
      value: metrics.totals.queueProcessFail,
      threshold: queueFailThreshold,
      windowMinutes,
      sourceQueue: metrics.query.sourceQueue,
    });

    signals.push({
      ruleKey: 'dlq.enqueue.growth',
      severity: 'P1',
      state: metrics.totals.dlqEnqueue >= dlqGrowthThreshold ? 'fired' : 'ok',
      message:
        metrics.totals.dlqEnqueue >= dlqGrowthThreshold
          ? `DLQ growth reached ${metrics.totals.dlqEnqueue} in ${windowMinutes}m`
          : `DLQ growth healthy (${metrics.totals.dlqEnqueue}/${dlqGrowthThreshold})`,
      value: metrics.totals.dlqEnqueue,
      threshold: dlqGrowthThreshold,
      windowMinutes,
      sourceQueue: metrics.query.sourceQueue,
    });

    const replayRate = metrics.totals.replaySuccessRate;
    const replayRatePercent = Number((replayRate * 100).toFixed(2));
    const replayRateThresholdPercent = Number((replaySuccessRateThreshold * 100).toFixed(2));
    const replayRateFired =
      metrics.totals.replayAttempt >= replayMinAttempts && replayRate < replaySuccessRateThreshold;

    signals.push({
      ruleKey: 'replay.success.rate',
      severity: 'P2',
      state: replayRateFired ? 'fired' : 'ok',
      message: replayRateFired
        ? `Replay success rate dropped to ${replayRatePercent}% with attempts=${metrics.totals.replayAttempt}`
        : `Replay success rate healthy (${replayRatePercent}% / threshold ${replayRateThresholdPercent}%)`,
      value: replayRate,
      threshold: replaySuccessRateThreshold,
      windowMinutes,
      sourceQueue: metrics.query.sourceQueue,
    });

    if (query.emit) {
      await this.emitStateChanges(tenantId, signals);
    }

    return {
      tenantId,
      query: {
        windowMinutes,
        from: metrics.query.from,
        to: metrics.query.to,
        sourceQueue: metrics.query.sourceQueue,
      },
      signals,
    };
  }

  private async emitStateChanges(tenantId: string, signals: AutopilotAlertSignal[]): Promise<void> {
    for (const signal of signals) {
      const stateKey = this.stateKey(tenantId, signal.ruleKey, signal.sourceQueue);
      const prevState = await redisReadWithFallback(
        this.logger,
        `alert state get key=${stateKey}`,
        async () => this.redis.get(stateKey),
        null as string | null,
      );
      if (prevState === signal.state) continue;

      await redisWriteOrBlock(
        this.logger,
        `alert state set key=${stateKey}`,
        async () => this.redis.set(stateKey, signal.state, 'EX', 24 * 60 * 60),
      );

      const suppressSeconds = this.getSuppressionSeconds(signal.severity);
      if (suppressSeconds > 0) {
        const suppressKey = this.suppressionKey(tenantId, signal);
        const suppressAcquired = await redisWriteOrBlock(
          this.logger,
          `alert suppression lock key=${suppressKey}`,
          async () => this.redis.set(suppressKey, signal.state, 'EX', suppressSeconds, 'NX'),
        );
        if (suppressAcquired !== 'OK') {
          emitStructuredLog(this.logger, 'log', {
            service: AutopilotAlertService.name,
            eventType: 'alert.suppressed',
            message: `alert suppressed by window severity=${signal.severity} rule=${signal.ruleKey}`,
            tenantId,
            campaignId: signal.ruleKey,
            nodeId: 'cloud',
            taskId: `alert:${signal.ruleKey}`,
            severity: signal.severity,
            state: signal.state,
            sourceQueue: signal.sourceQueue,
            suppressSeconds,
          });
          continue;
        }
      }

      const message = `[${signal.severity}] ${signal.ruleKey} ${signal.state.toUpperCase()} tenant=${tenantId} ${signal.message}`;
      this.alertGateway.emitAutopilotAlert(message, {
        tenantId,
        severity: signal.severity,
        ruleKey: signal.ruleKey,
        state: signal.state,
        value: signal.value,
        threshold: signal.threshold,
        windowMinutes: signal.windowMinutes,
        sourceQueue: signal.sourceQueue,
      });
      await this.alertRouterService.routeSignal({
        tenantId,
        signal,
        message,
      });
      emitStructuredLog(this.logger, signal.state === 'fired' ? 'warn' : 'log', {
        service: AutopilotAlertService.name,
        eventType: 'alert.state.change',
        message,
        tenantId,
        campaignId: signal.ruleKey,
        nodeId: 'cloud',
        taskId: `alert:${signal.ruleKey}`,
        severity: signal.severity,
        state: signal.state,
        value: signal.value,
        threshold: signal.threshold,
        sourceQueue: signal.sourceQueue,
      });
    }
  }
}
