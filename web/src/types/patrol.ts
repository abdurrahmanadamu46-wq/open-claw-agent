/**
 * 自动巡检策略：用于 24h 评论区拦截、私信巡检和线索嗅探。
 */

export type PatrolStatus = 'running' | 'paused';

export interface PatrolRule {
  id: string;
  name: string;
  targetCount: number;
  targetPlatform: string;
  status: PatrolStatus;
  /** 命中后的引导脚本要求 */
  guideScript: string;
  /** 单次巡检间隔（分钟） */
  intervalMinutes: number;
  /** 触发概率阈值 0-100 */
  triggerPercent: number;
  createdAt: string;
}

export interface PatrolLogLine {
  id: string;
  time: string;
  node: string;
  message: string;
  type: 'scan' | 'hit' | 'webhook' | 'info';
}
