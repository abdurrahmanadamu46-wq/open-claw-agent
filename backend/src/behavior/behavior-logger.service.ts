/**
 * 行为日志收集与评分闭环
 * 边缘上报 → 打分 → 入经验池 → 供 Behavior Engine 进化
 */
import { Injectable, Logger } from '@nestjs/common';
import type { BehaviorLogEntry, ScoredBehavior } from './behavior-scoring.types';
import { ScoringEngineService } from './scoring-engine.service';
import { BehaviorPoolService } from './behavior-pool.service';
import { BehaviorEventBus } from './behavior-event.bus';

@Injectable()
export class BehaviorLoggerService {
  private readonly logger = new Logger(BehaviorLoggerService.name);

  constructor(
    private readonly scoring: ScoringEngineService,
    private readonly pool: BehaviorPoolService,
    private readonly eventBus: BehaviorEventBus,
  ) {}

  /**
   * 记录一条行为并完成：打分 → 入经验池 → 发 EventBus（行为完成）
   */
  log(entry: BehaviorLogEntry): ScoredBehavior {
    const score = this.scoring.score(entry);
    const scored: ScoredBehavior = { log: entry, score };
    this.pool.add(scored);
    this.eventBus.emitBehaviorCompleted(scored);
    this.logger.log(
      `[BehaviorScoring] session=${entry.session_id} total=${score.total_score.toFixed(2)} eff=${score.effectiveness_score.toFixed(2)} human=${score.human_score.toFixed(2)} risk=${score.risk_score.toFixed(2)} poolSize=${this.pool.getPoolSize()}`,
    );
    return scored;
  }
}
