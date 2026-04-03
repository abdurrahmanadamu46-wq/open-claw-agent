/**
 * SuperHarbor 核心数据结构 — 与后端 API、燎原引擎架构对齐
 */

/** 战役创建 Payload（提交给统一业务网关 → 云端 AI 编排） */
export interface CampaignCreatePayload {
  /** 目标对标账号 URL（可多个，一行一个） */
  targetAccountUrls: string;
  /** 推广产品名称 */
  productName: string;
  /** 核心卖点（多行） */
  sellPoints: string;
  /** SOP 模版 ID */
  sopTemplateId: string;
  /** 租户/组织 ID（可选，由后端从 JWT 注入） */
  tenantId?: string;
}

/** SOP 模版选项 */
export interface SopTemplateOption {
  id: string;
  label: string;
  /** 分镜数 */
  clips: number;
}

/** 边缘节点状态 */
export type NodeStatus = 'online' | 'offline';

export interface EdgeNode {
  nodeId: string;
  status: NodeStatus;
  /** 可用 IP 数 / 设备标识 */
  ipOrDeviceId: string;
  /** 归属地 */
  region?: string;
  /** 当前负载 0-100 */
  loadPercent?: number;
  lastSeenAt?: string;
}

/** 任务状态（与任务队列与打包器、WSS 调度一致） */
export type TaskStatus = 'Pending' | 'Generating' | 'Dispatching' | 'Completed' | 'Failed';

export interface CampaignTask {
  campaignId: string;
  campaignName: string;
  status: TaskStatus;
  progress: number;
  totalSlots?: number;
  assignedNodeIds?: string[];
  createdAt: string;
  updatedAt?: string;
}

/** 线索（边缘节点抓取） */
export type LeadIntentLevel = 'hot' | 'warm' | 'cold';

export interface Lead {
  id: string;
  platform: string;
  userNickname: string;
  intentLevel: LeadIntentLevel;
  rawContent?: string;
  capturedAt: string;
  campaignId?: string;
}
