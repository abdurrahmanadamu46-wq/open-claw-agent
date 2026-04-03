/**
 * 全域任务总控 — 任务 + 内容 + 账号环境 + AI 排期 四维组装
 */

import type { EnvironmentPlatform, FingerprintEngine } from './environment';
import { ENVIRONMENT_PLATFORM_LABELS, FINGERPRINT_ENGINE_LABELS } from './environment';

export type CampaignTaskType = 'video_distribute' | 'comment_patrol' | 'competitor_crawl';

export type ScheduleMode = 'immediate' | 'scheduled' | 'ai_smart';

/** 环境 + 节点绑定（龙虾点兵列表项） */
export interface EnvWithNode {
  id: string;
  envName: string;
  platform: EnvironmentPlatform;
  nodeId: string | null;
  nodeOnline: boolean;
  fingerprintEngine: FingerprintEngine;
}

export const TASK_TYPE_LABELS: Record<CampaignTaskType, string> = {
  video_distribute: '全域视频分发',
  comment_patrol: '评论区截流巡逻',
  competitor_crawl: '竞品对标抓取',
};

export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  immediate: '立即并发执行',
  scheduled: '定时同步发布',
  ai_smart: 'AI 智能错峰排期',
};

export function getPlatformLabel(p: EnvironmentPlatform): string {
  return ENVIRONMENT_PLATFORM_LABELS[p];
}

export function getFingerprintLabel(f: FingerprintEngine): string {
  return FINGERPRINT_ENGINE_LABELS[f];
}
