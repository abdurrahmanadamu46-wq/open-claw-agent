/**
 * Operations calendar types.
 * Used by the scheduling cockpit and campaign task layout views.
 */

export type CalendarPlatform = 'douyin' | 'xiaohongshu';

export type PublishStatus = 'sent' | 'queued' | 'offline';

export interface CalendarTask {
  id: string;
  platform: CalendarPlatform;
  accountName: string;
  publishDate: string;
  publishTime: string;
  status: PublishStatus;
  nodeId: string;
  thumbnail?: string;
  title?: string;
  /** Parent campaign ID, used to link with orchestrator-level workflows. */
  campaignId?: string;
  /** Short campaign label, shown inside task cards. */
  campaignName?: string;
}

/** Parent campaign issued by the orchestration layer. */
export interface Campaign {
  id: string;
  name: string;
  totalTickets: number;
  createdAt: string;
}

export const PLATFORM_LABELS: Record<CalendarPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
};

export const PLATFORM_COLORS: Record<CalendarPlatform, string> = {
  douyin: '#000000',
  xiaohongshu: '#FE2C55',
};

export const STATUS_LABELS: Record<PublishStatus, string> = {
  sent: '已发',
  queued: '队列中',
  offline: '节点离线',
};

export function getStatusDot(status: PublishStatus): string {
  switch (status) {
    case 'sent':
      return '●';
    case 'queued':
      return '◐';
    case 'offline':
      return '○';
    default:
      return '•';
  }
}
