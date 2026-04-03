/**
 * 标准线索推送数据契约 — Webhook 分发枢纽
 * 客户在 n8n / Zapier 中解析此结构，零开发对接飞书、钉钉、企业微信、CRM
 */

/** 来源平台 */
export type LeadSourcePlatform = 'douyin' | 'xiaohongshu' | 'kuaishou';

/** 线索详情（便于 n8n 节点直接映射） */
export interface LeadDetails {
  /** 客户昵称 */
  username: string;
  /** 主页链接 */
  profileUrl: string;
  /** 评论/私信内容 */
  content: string;
  /** 来源视频链接 */
  sourceVideoUrl: string;
}

/**
 * 标准线索推送 Payload — 所有 Webhook 统一格式
 * - eventId: 防重、幂等
 * - timestamp: ISO 8601，便于客户过滤与统计
 */
export interface StandardLeadPayload {
  /** 唯一事件 ID (UUID)，用于防重 */
  eventId: string;
  /** 抓取时间 (ISO 8601) */
  timestamp: string;
  /** 租户标识 */
  tenantId: string;
  /** 来源平台 */
  source: LeadSourcePlatform;
  /** 线索详情 */
  leadDetails: LeadDetails;
}
