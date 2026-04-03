/**
 * 行为评分系统 — 日志与评分数据结构
 * 多维度：Effectiveness / Human-likeness / Risk / Efficiency → 综合分 + 反馈闭环
 */
import type { BehaviorPath, BehaviorStep } from './types/behavior.types';

/** 行为效果指标（业务结果） */
export interface EffectivenessMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  leads?: number;
}

/** 节点健康/资源（执行时） */
export interface NodeHealth {
  cpu_percent?: number;
  memory_percent?: number;
  latency_ms?: number;
  duration_sec?: number;
}

/** 风险标记（规则或模型检测） */
export interface RiskFlags {
  repeated_pattern?: boolean;
  too_fast?: boolean;
  sync_with_others?: boolean;
  anomaly_probability?: number;
}

/** 行为日志条目（边缘上报或云端汇总） */
export interface BehaviorLogEntry {
  persona_id: string;
  session_id: string;
  tenant_id?: string;
  node_id?: string;
  trace_id?: string;
  /** 执行的行为路径 */
  path: BehaviorPath;
  /** 各步实际 delay（秒），用于拟人性计算 */
  step_delays_sec?: number[];
  /** 总耗时（秒） */
  duration_sec: number;
  effectiveness: EffectivenessMetrics;
  node_health?: NodeHealth;
  risk_flags?: RiskFlags;
  created_at: string;
}

/** 评分权重（可动态调节） */
export interface ScoreWeights {
  effectiveness: number;
  human_likeness: number;
  risk: number;
  efficiency: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  effectiveness: 0.4,
  human_likeness: 0.3,
  risk: 0.2,
  efficiency: 0.1,
};

/** 单维度得分 0–1 */
export interface BehaviorScore {
  effectiveness_score: number;
  human_score: number;
  risk_score: number;
  efficiency_score: number;
  total_score: number;
  weights: ScoreWeights;
  at: string;
}

/** 带评分的完整记录（入经验池） */
export interface ScoredBehavior {
  log: BehaviorLogEntry;
  score: BehaviorScore;
}
