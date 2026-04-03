/**
 * 行为事件监听：high_intent_lead → 回访虾（FollowUp）触发
 * 当前为日志 + 占位；后续可在此调用 Open Realtime API / Twilio。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BehaviorEventBus, BEHAVIOR_EVENTS, type HighIntentLeadPayload } from './behavior-event.bus';

@Injectable()
export class BehaviorEventBusListener implements OnModuleInit {
  private readonly logger = new Logger(BehaviorEventBusListener.name);

  constructor(private readonly bus: BehaviorEventBus) {}

  onModuleInit() {
    this.bus.onHighIntentLead((payload: HighIntentLeadPayload) => {
      this.logger.log(
        `[${BEHAVIOR_EVENTS.HIGH_INTENT_LEAD}] user_id=${payload.user_id} lead_id=${payload.lead_id} confidence=${payload.confidence} tenant_id=${payload.tenant_id}`,
      );
      // TODO: 10 秒内调用 FollowUp 服务（Twilio / Open Realtime API）
    });
  }
}
