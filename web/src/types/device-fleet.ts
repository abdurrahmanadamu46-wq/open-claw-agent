/**
 * 设备与算力中心 — 列表与探针 UI 用类型（可与 ClientDevice / RemoteNode 后续对齐）
 */

export type FleetDeviceStatus = 'RUNNING' | 'IDLE' | 'COOLING' | 'OFFLINE';

export interface FleetDeviceRow {
  /** 设备唯一 ID / machine_code */
  deviceId: string;
  /** 商家自定义备注，如「深圳南山办公室-机器A」 */
  remark: string;
  status: FleetDeviceStatus;
  /** 当前 Campaign 名称 */
  campaignName: string | null;
  /** 跳转运营任务详情 */
  campaignId: string | null;
  cpuPercent: number;
  memoryPercent: number;
}

export interface FleetMetrics {
  onlineCount: number;
  totalCount: number;
  /** 今日算力利用率 0–100 */
  utilizationPercent: number;
  offlineAlertCount: number;
}
