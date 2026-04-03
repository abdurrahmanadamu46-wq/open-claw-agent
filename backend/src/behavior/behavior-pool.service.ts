/**
 * 行为经验池 — 高分行为模板存储与检索
 * 供 Behavior Engine 学习：生成路径时优先参考高分模板，实现自动进化
 */
import { Injectable } from '@nestjs/common';
import type { ScoredBehavior, BehaviorLogEntry } from './behavior-scoring.types';
import type { BehaviorPath, BehaviorStep } from './types/behavior.types';

const MAX_POOL_SIZE = 500;
const MIN_SCORE_TO_ENTER = 0.5;

@Injectable()
export class BehaviorPoolService {
  private pool: ScoredBehavior[] = [];

  /**
   * 将带评分的行为加入经验池；仅高分保留，超出容量时淘汰最低分
   */
  add(scored: ScoredBehavior): void {
    if (scored.score.total_score < MIN_SCORE_TO_ENTER) return;
    this.pool.push(scored);
    this.pool.sort((a, b) => b.score.total_score - a.score.total_score);
    if (this.pool.length > MAX_POOL_SIZE) this.pool = this.pool.slice(0, MAX_POOL_SIZE);
  }

  /**
   * 获取高分模板（用于 Behavior Engine 参考或变异）
   */
  getTemplates(limit = 10, minScore = 0.6): BehaviorPath[] {
    return this.pool
      .filter((s) => s.score.total_score >= minScore)
      .slice(0, limit)
      .map((s) => s.log.path);
  }

  /**
   * 获取带评分的 Top N，用于调度/策略决策
   */
  getTopScored(limit = 20): ScoredBehavior[] {
    return this.pool.slice(0, limit);
  }

  /**
   * 随机取一条高分路径并做轻量变异（用于自动进化）
   * 变异：随机调整部分 step 的 delay ±20%
   */
  sampleAndMutate(seed?: string): BehaviorPath | null {
    const templates = this.getTemplates(5, 0.55);
    if (templates.length === 0) return null;
    const rnd = seed ? seededRnd(seed) : Math.random;
    const template = templates[Math.floor(rnd() * templates.length)];
    const session_id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const steps: BehaviorStep[] = template.steps.map((step) => {
      const delay = step.delay ?? 1;
      const mutatedDelay = Math.round(delay * (0.8 + rnd() * 0.4) * 100) / 100;
      return { ...step, delay: mutatedDelay };
    });
    return { session_id, steps };
  }

  getPoolSize(): number {
    return this.pool.length;
  }
}

function seededRnd(seed: string): () => number {
  let h = seed.split('').reduce((a, c) => (Math.imul(31, a) + c.charCodeAt(0)) | 0, 0);
  return () => {
    h = (Math.imul(48271, h) + 0) >>> 0;
    return h / 4294967296;
  };
}
