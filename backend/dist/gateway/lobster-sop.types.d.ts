export type LobsterActionType = 'LOGIN' | 'LOGOUT' | 'INPUT_TEXT' | 'CLICK_SELECTOR' | 'UPLOAD_MEDIA' | 'UPLOAD_VIDEO' | 'NAVIGATE' | 'WAIT' | 'SCROLL' | 'SCREENSHOT' | 'SYNC_CONFIG' | 'START_CAMPAIGN' | 'STOP_CAMPAIGN';
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
    createdAt?: string;
}
export interface NodePingPayload {
    nodeId: string;
    status: 'IDLE' | 'BUSY';
    currentTaskId?: string;
    version?: string;
}
export interface TaskProgressPayload {
    taskId: string;
    nodeId: string;
    progress: number;
    message?: string;
    step?: string;
}
export interface TaskCompletedPayload {
    taskId: string;
    nodeId: string;
    success: boolean;
    result?: Record<string, unknown>;
    error?: string;
    completedAt: string;
}
