/**
 * 事件驱动总线（与架构图「中间件 Event Bus」对应）
 * 承载：任务反馈、行为完成、回访触发等，供 FollowUp、统计、调度消费。
 */
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { ScoredBehavior } from './behavior-scoring.types';

export const BEHAVIOR_EVENTS = {
  HIGH_INTENT_LEAD: 'high_intent_lead',
  BEHAVIOR_COMPLETED: 'behavior_completed',
  /** 行为路径/会话已生成（Behavior Engine → EventBus，供调度/统计/审计消费） */
  BEHAVIOR_PATH_GENERATED: 'behavior_path_generated',
} as const;

export interface HighIntentLeadPayload {
  event: typeof BEHAVIOR_EVENTS.HIGH_INTENT_LEAD;
  user_id: string;
  lead_id?: string;
  confidence: number;
  tenant_id: string;
  trace_id?: string;
  contact_hint?: string;
  at: string;
}

export interface BehaviorCompletedPayload {
  event: typeof BEHAVIOR_EVENTS.BEHAVIOR_COMPLETED;
  scored: ScoredBehavior;
  at: string;
}

export interface BehaviorPathGeneratedPayload {
  event: typeof BEHAVIOR_EVENTS.BEHAVIOR_PATH_GENERATED;
  session_id: string;
  tenant_id?: string;
  campaign_id?: string;
  trace_id?: string;
  steps_count: number;
  at: string;
}

@Injectable()
export class BehaviorEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitHighIntentLead(payload: Omit<HighIntentLeadPayload, 'event' | 'at'>): void {
    this.emit(BEHAVIOR_EVENTS.HIGH_INTENT_LEAD, {
      ...payload,
      event: BEHAVIOR_EVENTS.HIGH_INTENT_LEAD,
      at: new Date().toISOString(),
    } as HighIntentLeadPayload);
  }

  onHighIntentLead(handler: (payload: HighIntentLeadPayload) => void): void {
    this.on(BEHAVIOR_EVENTS.HIGH_INTENT_LEAD, handler);
  }

  /** 边缘上报行为完成并打分入池后发出，供统计/调度等消费 */
  emitBehaviorCompleted(scored: ScoredBehavior): void {
    this.emit(BEHAVIOR_EVENTS.BEHAVIOR_COMPLETED, {
      event: BEHAVIOR_EVENTS.BEHAVIOR_COMPLETED,
      scored,
      at: new Date().toISOString(),
    } as BehaviorCompletedPayload);
  }

  onBehaviorCompleted(handler: (payload: BehaviorCompletedPayload) => void): void {
    this.on(BEHAVIOR_EVENTS.BEHAVIOR_COMPLETED, handler);
  }

  /** Behavior Engine 产出路径/会话时发出（图中 BehaviorEngine → EventBus） */
  emitBehaviorPathGenerated(payload: Omit<BehaviorPathGeneratedPayload, 'event' | 'at'>): void {
    this.emit(BEHAVIOR_EVENTS.BEHAVIOR_PATH_GENERATED, {
      ...payload,
      event: BEHAVIOR_EVENTS.BEHAVIOR_PATH_GENERATED,
      at: new Date().toISOString(),
    } as BehaviorPathGeneratedPayload);
  }

  onBehaviorPathGenerated(handler: (payload: BehaviorPathGeneratedPayload) => void): void {
    this.on(BEHAVIOR_EVENTS.BEHAVIOR_PATH_GENERATED, handler);
  }
}
