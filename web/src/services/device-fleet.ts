import { getFleetNodes } from './node.service';
import type { FleetDeviceRow, FleetMetrics } from '@/types/device-fleet';

function mapStatus(status: string): FleetDeviceRow['status'] {
  if (status === 'ONLINE' || status === 'BUSY') return 'RUNNING';
  if (status === 'OFFLINE') return 'OFFLINE';
  return 'IDLE';
}

export async function getFleetDevices(): Promise<FleetDeviceRow[]> {
  const nodes = await getFleetNodes();
  return nodes.map((node) => ({
    deviceId: node.nodeId,
    remark: node.clientName || node.clientId || node.nodeId,
    status: mapStatus(node.status),
    campaignName: null,
    campaignId: null,
    cpuPercent: Number(node.systemMetrics?.cpuPercent ?? 0),
    memoryPercent: Number(node.systemMetrics?.memoryPercent ?? 0),
  }));
}

export async function getFleetMetrics(): Promise<FleetMetrics> {
  const rows = await getFleetDevices();
  const totalCount = rows.length;
  const onlineCount = rows.filter((row) => row.status !== 'OFFLINE').length;
  const offlineAlertCount = rows.filter((row) => row.status === 'OFFLINE').length;
  const utilizationPercent =
    totalCount > 0
      ? Math.round(rows.reduce((sum, row) => sum + (row.cpuPercent || 0), 0) / totalCount)
      : 0;
  return {
    onlineCount,
    totalCount,
    utilizationPercent,
    offlineAlertCount,
  };
}

