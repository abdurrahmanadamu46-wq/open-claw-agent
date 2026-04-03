/**
 * ClawCommerce Agent - Central type definitions
 * All interfaces for NodeStatus, AllocationRule, Campaign, and related entities.
 * 与 PM v1.3 数据字典对齐：NodeStatusEnum、ICampaignConfig 见 shared/contracts.ts
 * @module agent/types
 */

import { NodeStatusEnum } from '../shared/contracts.js';

export { NodeStatusEnum } from '../shared/contracts.js';

/** OpenClaw node lifecycle states（内部用）；对外上报使用 NodeStatusEnum */
export type NodeState =
  | 'idle'
  | 'allocated'
  | 'busy'
  | 'degraded'
  | 'unhealthy'
  | 'releasing'
  | 'maintenance'
  | 'cooling'   // 风控冷却
  | 'banned';   // 封禁

/** Health verdict from CDP/Playwright checks */
export type HealthVerdict = 'ok' | 'degraded' | 'unhealthy' | 'unknown';

/** Platform identifiers for multi-platform support */
export type PlatformId =
  | 'douyin' | 'xiaohongshu' | 'kuaishou'
  | 'instagram' | 'tiktok';

export interface NodeStatus {
  nodeId: string;
  state: NodeState;
  /** PM v1.3 约定：与后端一致的工作流状态，上报/心跳用 */
  workflowState?: NodeStatusEnum;
  health: HealthVerdict;
  /** CDP/WebSocket endpoint (e.g. ws://127.0.0.1:9222) */
  cdpEndpoint?: string;
  /** Playwright browser state: connected | disconnected | unknown */
  playwrightState?: 'connected' | 'disconnected' | 'unknown';
  /** Last successful heartbeat ISO timestamp */
  lastHeartbeatAt?: string;
  /** CPU usage 0-100 (from host/container) */
  cpuUsagePercent?: number;
  /** Memory usage MB */
  memoryUsageMb?: number;
  /** Assigned campaign ID if allocated */
  campaignId?: string;
  /** Assigned phone number ID if allocated */
  phoneNumberId?: string;
  /** When this node was allocated (ISO) */
  allocatedAt?: string;
  /** Idle since (ISO); used for auto-release after 30min */
  idleSince?: string;
  /** Container/host identifier for scaling */
  containerId?: string;
  /** 专属网络配置：每个龙虾独立代理/出口，避免关联 */
  networkConfig?: NodeNetworkConfig;
  /** 指纹浏览器配置：设备指纹、UA、反检测策略 */
  fingerprintProfile?: NodeFingerprintProfile;
  /** Metadata for audit */
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

/** 每个节点专属网络（代理/出口） */
export interface NodeNetworkConfig {
  /** 代理地址，如 http://user:pass@host:port 或 socks5://... */
  proxyUrl?: string;
  /** 出口地域/机房标签，便于区分 */
  region?: string;
  /** 显示用名称 */
  label?: string;
}

/** 每个节点指纹浏览器配置 */
export interface NodeFingerprintProfile {
  /** 指纹池/浏览器配置文件 ID */
  profileId?: string;
  /** 策略：random 每次随机 | pool 从池中选 | fixed 固定 */
  strategy?: 'random' | 'pool' | 'fixed';
  /** 设备指纹池 ID（与 anti-detection deviceFingerprintPool 对应） */
  poolId?: string;
}

/** Rule for allocating a node to a campaign */
export interface AllocationRule {
  /** Industry or vertical (e.g. "beauty", "fitness") */
  industry: string;
  /** Up to 20 benchmark account IDs or handles to mirror */
  benchmarkAccountIds: string[];
  /** Preferred platforms for this campaign */
  platforms: PlatformId[];
  /** Max nodes per campaign (default 1) */
  maxNodesPerCampaign?: number;
  /** Require phone number bound to node */
  requirePhone?: boolean;
}

/** Merchant campaign configuration (from PM/backend) */
export interface CampaignConfig {
  campaignId: string;
  merchantId: string;
  rule: AllocationRule;
  /** Optional: specific node ID if reusing */
  preferredNodeId?: string;
  /** Optional: TTL in minutes before auto-release (default 30) */
  idleReleaseMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

/** Allocation result returned to caller */
export interface AllocationResult {
  nodeId: string;
  nodeStatus: NodeStatus;
  phoneNumberId?: string;
  phoneNumber?: string; // Masked or full per config
  expiresAt: string;    // ISO; for idle release
}

/** Phone number provider enum */
export type PhoneProviderId = 'sms-activate' | '5sim' | 'tigersms';

/** Phone number slot from pool */
export interface PhoneSlot {
  id: string;
  provider: PhoneProviderId;
  number: string;       // E.164 or national
  countryCode: string;
  /** Order/activation ID from provider */
  externalId: string;
  /** When acquired (ISO) */
  acquiredAt: string;
  /** When to release (ISO); auto-renew or release */
  expiresAt: string;
  /** Bound to nodeId if allocated */
  nodeId?: string;
  status: 'available' | 'allocated' | 'released' | 'expired';
}

/** Health check payload (internal) */
export interface HealthCheckResult {
  nodeId: string;
  verdict: HealthVerdict;
  cdpReachable: boolean;
  playwrightConnected: boolean;
  cpuUsagePercent?: number;
  memoryUsageMb?: number;
  message?: string;
  checkedAt: string;
}

/** Event for WebSocket / internal events */
export interface NodePoolEvent {
  type: 'node_allocated' | 'node_released' | 'node_unhealthy' | 'node_recovered' | 'node_heartbeat';
  nodeId: string;
  payload: Partial<NodeStatus>;
  at: string;
}

/** Dashboard API response: nodes status */
export interface NodesStatusResponse {
  nodes: NodeStatus[];
  total: number;
  idle: number;
  allocated: number;
  unhealthy: number;
  at: string;
}

/** Environment/config for node manager (validated by Zod) */
export interface NodeManagerEnv {
  REDIS_URL: string;
  MONGODB_URI?: string;
  MAX_NODES: number;
  IDLE_RELEASE_MINUTES: number;
  HEARTBEAT_INTERVAL_MS: number;
  NODE_CPD_PORT_RANGE_START?: number;
  NODE_CPD_PORT_RANGE_END?: number;
}
