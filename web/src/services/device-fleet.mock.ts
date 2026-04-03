/**
 * 设备池大盘 Mock — 无真实 C&C 数据时砌 UI
 */
import type { FleetDeviceRow, FleetMetrics } from '@/types/device-fleet';

export const MOCK_FLEET_METRICS: FleetMetrics = {
  onlineCount: 12,
  totalCount: 15,
  utilizationPercent: 85,
  offlineAlertCount: 3,
};

export const MOCK_FLEET_DEVICES: FleetDeviceRow[] = [
  {
    deviceId: 'MAC-POC-LOBSTER-001',
    remark: '深圳南山办公室-机器A',
    status: 'RUNNING',
    campaignName: '15秒故事带货 · 对标挖掘',
    campaignId: 'CAMP_17A9B3',
    cpuPercent: 62,
    memoryPercent: 74,
  },
  {
    deviceId: 'node-hz-002',
    remark: '华东副机',
    status: 'COOLING',
    campaignName: null,
    campaignId: null,
    cpuPercent: 18,
    memoryPercent: 42,
  },
  {
    deviceId: 'node-gz-001',
    remark: '华南矩阵号 B',
    status: 'RUNNING',
    campaignName: '10秒爆款短视频',
    campaignId: 'CAMP_28B2C4',
    cpuPercent: 88,
    memoryPercent: 81,
  },
  {
    deviceId: 'node-bj-001',
    remark: '华北单店 C',
    status: 'OFFLINE',
    campaignName: null,
    campaignId: null,
    cpuPercent: 0,
    memoryPercent: 0,
  },
  {
    deviceId: 'node-sh-001',
    remark: '上海直播基地 D',
    status: 'IDLE',
    campaignName: null,
    campaignId: null,
    cpuPercent: 12,
    memoryPercent: 35,
  },
];

export async function getFleetMetrics(): Promise<FleetMetrics> {
  return { ...MOCK_FLEET_METRICS };
}

export async function getFleetDevices(): Promise<FleetDeviceRow[]> {
  return MOCK_FLEET_DEVICES.map((d) => ({ ...d }));
}
