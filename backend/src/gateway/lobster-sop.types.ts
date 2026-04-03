/**
 * Fleet/Lobster websocket protocol payload types.
 */

export type LobsterActionType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'INPUT_TEXT'
  | 'CLICK_SELECTOR'
  | 'UPLOAD_MEDIA'
  | 'UPLOAD_VIDEO'
  | 'NAVIGATE'
  | 'WAIT'
  | 'SCROLL'
  | 'SCREENSHOT'
  | 'SYNC_CONFIG'
  | 'START_CAMPAIGN'
  | 'STOP_CAMPAIGN';

export type LobsterPlatform = 'xiaohongshu' | 'douyin' | 'weibo' | 'other';

export interface AntiDetectConfig {
  proxy?: string;
  fingerprintId?: string;
  humanLikeInput?: boolean;
  delayBetweenActions?: [number, number];
}

export interface LobsterTaskParams {
  platform?: LobsterPlatform;
  cookie_id?: string;
  url?: string;
  selector?: string;
  text?: string;
  file_url?: string;
  title?: string;
  description?: string;
  delay_typing?: boolean;
  wait_ms?: number;
  [key: string]: unknown;
}

export interface LobsterTaskPayload {
  taskId: string;
  actionType: LobsterActionType;
  params: LobsterTaskParams;
  anti_detect_config?: AntiDetectConfig;
  campaignId?: string;
  traceId?: string;
  createdAt?: string;
}

export interface NodePingPayload {
  nodeId: string;
  status: 'IDLE' | 'BUSY';
  traceId?: string;
  tenantId?: string;
  clientId?: string;
  clientName?: string;
  currentAccountSummary?: string;
  circuitBreakerReason?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  platforms?: LobsterPlatform[] | string[];
  currentTaskId?: string;
  version?: string;
  lobsterConfigs?: Record<string, string>;
  skillVersions?: Record<string, string>;
  pendingTaskCount?: number;
  runningTaskCount?: number;
  maxConcurrentTasks?: number;
  logLevel?: string;
  metaCacheStatus?: string;
  edgeVersion?: string;
  reportedResourceVersion?: number;
  memoryUsageMb?: number;
  configVersionSummary?: string;
  skillVersionSummary?: string;
}

export interface TaskProgressPayload {
  taskId: string;
  nodeId: string;
  traceId?: string;
  progress: number;
  message?: string;
  step?: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  nodeId: string;
  traceId?: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  completedAt: string;
}

/** 行为会话下发 payload（点兵虾 → WSS → 边缘 Behavior Runtime） */
export interface BehaviorSessionDispatchPayload {
  session_id: string;
  tenant_id?: string;
  trace_id?: string;
  campaign_id?: string;
  /** 行为路径，边缘用 Behavior Runtime 解析执行 */
  behavior_path: { session_id: string; steps: Array<{ action: string; delay?: number; duration?: number; target?: string; content?: string }> };
  created_at?: string;
}
