/**
 * 雷达大脑 — 下发给龙虾节点的爬虫任务
 * 任务在客户电脑（龙虾节点）执行：静默滑动、截图、抓链接、点赞数等，云端只负责打包与下发。
 */

/** 支持的平台 */
export type CrawlerPlatform = 'douyin' | 'xiaohongshu' | 'kuaishou' | 'wechat-video' | 'tiktok';

/** 单次动作类型 */
export type CrawlerActionType =
  | 'silent_scroll'   // 静默滑动
  | 'screenshot'      // 截图
  | 'grab_links'      // 抓取当前页链接/视频链接
  | 'grab_metrics'    // 抓点赞/评论/转发数
  | 'grab_feed_list'; // 抓取列表页条目（标题、链接、封面）

export interface CrawlerAction {
  type: CrawlerActionType;
  /** 可选参数，如 scroll 次数、截图选择器 */
  params?: Record<string, unknown>;
}

/**
 * 监控对标账号 — 下发给龙虾的 OpenClaw Skill 形态任务
 * 龙虾节点按此 payload 执行，结果通过 client.lead.report 或专用事件回传
 */
export interface CompetitorMonitorTask {
  /** 任务唯一 ID，用于 Ack 与回调关联 */
  jobId: string;
  /** 活动/活动组 ID */
  campaignId?: string;
  /** 平台 */
  platform: CrawlerPlatform;
  /** 对标账号主页 URL 或账号 ID（由龙虾侧解析） */
  targetAccountUrl: string;
  /** 要执行的动作序列（按顺序执行） */
  actions: CrawlerAction[];
  /** 可选：最大执行时长（毫秒），超时则中断并上报已得数据 */
  timeoutMs?: number;
  /** 可选：是否需要无头/静默（不弹窗） */
  headless?: boolean;
}

/**
 * 构建「每日爆款拆解」标准任务：滑动 + 抓链接 + 抓点赞数 + 截图
 * 供总控侧调用，打包后通过 WebSocket 下发给龙虾
 */
export function buildCompetitorMonitorTask(payload: {
  jobId: string;
  campaignId?: string;
  platform: CrawlerPlatform;
  targetAccountUrl: string;
  timeoutMs?: number;
  headless?: boolean;
}): CompetitorMonitorTask {
  return {
    jobId: payload.jobId,
    campaignId: payload.campaignId,
    platform: payload.platform,
    targetAccountUrl: payload.targetAccountUrl,
    timeoutMs: payload.timeoutMs ?? 60_000,
    headless: payload.headless ?? true,
    actions: [
      { type: 'silent_scroll', params: { count: 3, delayMs: 800 } },
      { type: 'grab_feed_list', params: { limit: 20 } },
      { type: 'grab_metrics' },
      { type: 'screenshot', params: { name: 'feed_overview' } },
    ],
  };
}

/** 任务序列化为 JSON，用于 WebSocket / Redis 下发 */
export function serializeCrawlerTask(task: CompetitorMonitorTask): string {
  return JSON.stringify(task);
}

export function deserializeCrawlerTask(json: string): CompetitorMonitorTask {
  const parsed = JSON.parse(json) as CompetitorMonitorTask;
  if (!parsed.jobId || !parsed.platform || !parsed.targetAccountUrl || !Array.isArray(parsed.actions)) {
    throw new Error('Invalid CompetitorMonitorTask: missing jobId, platform, targetAccountUrl or actions');
  }
  return parsed;
}
