/**
 * 行为评分引擎 — 多维度打分与综合分
 * Effectiveness / Human-likeness / Risk / Efficiency → total_score，支持动态权重
 */
import { Injectable } from '@nestjs/common';
import type {
  BehaviorLogEntry,
  BehaviorScore,
  ScoreWeights,
  EffectivenessMetrics,
  RiskFlags,
} from './behavior-scoring.types';
import { DEFAULT_SCORE_WEIGHTS } from './behavior-scoring.types';

/** 人类基线：平均步骤间隔（秒），用于拟人性对比 */
const HUMAN_DELAY_MEAN_SEC = 1.2;
const HUMAN_DELAY_STD_SEC = 0.6;

@Injectable()
export class ScoringEngineService {
  /**
   * 对单条行为日志计算多维度得分与综合分
   */
  score(entry: BehaviorLogEntry, weights: Partial<ScoreWeights> = {}): BehaviorScore {
    const w: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...weights };

    const effectiveness_score = this.effectivenessScore(entry.effectiveness);
    const human_score = this.humanLikenessScore(entry);
    const risk_score = this.riskScore(entry.risk_flags);
    const efficiency_score = this.efficiencyScore(entry);

    const total_score = Math.max(
      0,
      Math.min(
        1,
        w.effectiveness * effectiveness_score +
          w.human_likeness * human_score -
          w.risk * (1 - risk_score) +
          w.efficiency * efficiency_score,
      ),
    );

    return {
      effectiveness_score,
      human_score,
      risk_score,
      efficiency_score,
      total_score,
      weights: w,
      at: new Date().toISOString(),
    };
  }

  /** 行为效果：0.1*likes + 0.3*comments + 0.2*shares + 0.4*leads，归一化到 0–1 */
  private effectivenessScore(eff: EffectivenessMetrics): number {
    const raw =
      (eff.likes ?? 0) * 0.1 +
      (eff.comments ?? 0) * 0.3 +
      (eff.shares ?? 0) * 0.2 +
      (eff.leads ?? 0) * 0.4;
    return Math.min(1, raw);
  }

  /** 拟人性：步骤 delay 分布与人类基线接近程度 */
  private humanLikenessScore(entry: BehaviorLogEntry): number {
    const delays = entry.step_delays_sec ?? entry.path.steps.map((s) => s.delay ?? 1).filter((d): d is number => d != null);
    if (delays.length === 0) return 0.5;
    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    const diff = Math.abs(mean - HUMAN_DELAY_MEAN_SEC);
    return Math.max(0, 1 - diff / (HUMAN_DELAY_MEAN_SEC + HUMAN_DELAY_STD_SEC));
  }

  /** 风险：异常则降分，1 为无风险 */
  private riskScore(flags?: RiskFlags): number {
    if (!flags) return 1;
    let r = 1;
    if (flags.repeated_pattern) r -= 0.3;
    if (flags.too_fast) r -= 0.3;
    if (flags.sync_with_others) r -= 0.4;
    if (flags.anomaly_probability != null) r -= flags.anomaly_probability;
    return Math.max(0, r);
  }

  /** 成本效率：收益/耗时，归一化到 0–1 */
  private efficiencyScore(entry: BehaviorLogEntry): number {
    const leads = entry.effectiveness.leads ?? 0;
    const duration = Math.max(1, entry.duration_sec);
    const raw = leads > 0 ? leads / Math.log10(duration + 1) : 0;
    return Math.min(1, raw * 0.5);
  }

  getDefaultWeights(): ScoreWeights {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }

  updateWeights(overrides: Partial<ScoreWeights>): ScoreWeights {
    return { ...DEFAULT_SCORE_WEIGHTS, ...overrides };
  }
}
